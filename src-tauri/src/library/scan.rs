use super::{display_path, is_excluded_descendant, path_key, IndexedMedia, LibraryIndex};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LibraryScanPhase {
  Discovering,
  Indexing,
  Cancelling,
  Completed,
  Cancelled,
  Failed,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct LibraryScanProgress {
  pub job_id: String,
  pub phase: LibraryScanPhase,
  pub root: String,
  pub discovered: usize,
  pub processed: usize,
  pub indexed: usize,
  pub skipped: usize,
  pub failed: usize,
  pub error: Option<String>,
}

#[derive(Clone)]
pub struct ScanJob {
  id: String,
  cancelled: Arc<AtomicBool>,
}

impl ScanJob {
  /// Returns the stable identifier exposed in progress events and cancellation.
  pub fn id(&self) -> &str {
    &self.id
  }

  /// Reports whether cancellation has been requested for this job.
  pub fn is_cancelled(&self) -> bool {
    self.cancelled.load(Ordering::Relaxed)
  }
}

#[derive(Clone)]
struct ActiveScan {
  job: ScanJob,
  progress: LibraryScanProgress,
}

#[derive(Clone, Default)]
pub struct ScanCoordinator {
  active: Arc<Mutex<HashMap<String, ActiveScan>>>,
}

impl ScanCoordinator {
  /// Starts one root-scoped scan unless that normalized root is already active.
  pub fn begin(&self, root: String) -> Result<ScanJob, String> {
    let mut active = self
      .active
      .lock()
      .map_err(|_| "Navio's library scan state is unavailable.".to_string())?;
    let root_key = path_key(Path::new(&root));
    if active
      .values()
      .any(|scan| path_key(Path::new(&scan.progress.root)) == root_key)
    {
      return Err("This folder is already being scanned.".to_string());
    }
    let job = ScanJob {
      id: uuid::Uuid::new_v4().to_string(),
      cancelled: Arc::new(AtomicBool::new(false)),
    };
    active.insert(
      job.id.clone(),
      ActiveScan {
        job: job.clone(),
        progress: LibraryScanProgress {
          job_id: job.id.clone(),
          phase: LibraryScanPhase::Discovering,
          root,
          discovered: 0,
          processed: 0,
          indexed: 0,
          skipped: 0,
          failed: 0,
          error: None,
        },
      },
    );
    Ok(job)
  }

  /// Requests cancellation of one scan without disturbing other roots.
  pub fn cancel(&self, job_id: &str) -> bool {
    let Ok(mut active) = self.active.lock() else {
      return false;
    };
    let Some(active) = active.get_mut(job_id) else {
      return false;
    };
    active.job.cancelled.store(true, Ordering::Relaxed);
    active.progress.phase = LibraryScanPhase::Cancelling;
    true
  }

  /// Returns every active scan snapshot in stable root order.
  pub fn statuses(&self) -> Vec<LibraryScanProgress> {
    let Ok(active) = self.active.lock() else {
      return Vec::new();
    };
    let mut statuses = active
      .values()
      .map(|scan| scan.progress.clone())
      .collect::<Vec<_>>();
    statuses.sort_by(|left, right| left.root.cmp(&right.root));
    statuses
  }

  /// Reports whether watcher synchronization should wait for root publication.
  pub fn has_active_jobs(&self) -> bool {
    self
      .active
      .lock()
      .map(|active| !active.is_empty())
      .unwrap_or(false)
  }

  /// Updates only the matching job in the concurrent registry.
  pub fn update(
    &self,
    job: &ScanJob,
    update: impl FnOnce(&mut LibraryScanProgress),
  ) -> Option<LibraryScanProgress> {
    let mut active = self.active.lock().ok()?;
    let scan = active.get_mut(&job.id)?;
    update(&mut scan.progress);
    Some(scan.progress.clone())
  }

  /// Clears a completed job without disturbing other roots.
  pub fn finish(&self, job: &ScanJob) {
    let Ok(mut active) = self.active.lock() else {
      return;
    };
    active.remove(&job.id);
  }
}

#[derive(Default)]
pub struct ScanOutcome {
  pub discovered: usize,
  pub processed: usize,
  pub indexed: usize,
  pub skipped: usize,
  pub failed: usize,
  pub cancelled: bool,
}

/// Iteratively discovers supported files while pruning excluded and linked directories.
pub fn discover_supported_files(
  root: &Path,
  excluded_names: &[String],
  cancelled: &AtomicBool,
  on_discovered: impl Fn(usize),
) -> Result<Vec<PathBuf>, String> {
  let mut files = Vec::new();
  let mut directories = vec![root.to_path_buf()];

  while let Some(directory) = directories.pop() {
    if cancelled.load(Ordering::Relaxed) {
      break;
    }
    let entries = match fs::read_dir(&directory) {
      Ok(entries) => entries,
      Err(error) if directory == root => {
        return Err(format!("Could not read selected folder: {error}"));
      }
      Err(_) => continue,
    };
    for entry in entries.flatten() {
      if cancelled.load(Ordering::Relaxed) {
        break;
      }
      let path = entry.path();
      let Ok(file_type) = entry.file_type() else {
        continue;
      };
      if file_type.is_symlink() {
        continue;
      }
      if file_type.is_dir() {
        if !is_excluded_descendant(root, &path, excluded_names) {
          directories.push(path);
        }
      } else if file_type.is_file() && super::scanner::is_supported_media_path(&path) {
        files.push(path);
        on_discovered(files.len());
      }
    }
  }

  files.sort_by_key(|path| path_key(path));
  Ok(files)
}

/// Reports whether a cached metadata row still matches the file fingerprint.
pub fn should_reuse_cached(
  cached_modified_ns: i64,
  cached_size: u64,
  modified_ns: i64,
  size: u64,
) -> bool {
  cached_modified_ns == modified_ns && cached_size == size
}

/// Publishes a root atomically unless cooperative cancellation was requested.
pub fn publish_root_if_active(
  index: &mut LibraryIndex,
  root_key: &str,
  entries: &[IndexedMedia],
  cancelled: &AtomicBool,
) -> Result<bool, String> {
  if cancelled.load(Ordering::Relaxed) {
    return Ok(false);
  }
  index.replace_root(root_key, entries)?;
  Ok(true)
}

/// Returns a nanosecond fingerprint suitable for cache invalidation.
pub fn modified_ns(metadata: &fs::Metadata) -> i64 {
  metadata
    .modified()
    .ok()
    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
    .map(|duration| duration.as_nanos().min(i64::MAX as u128) as i64)
    .unwrap_or(0)
}

/// Scans configured roots into SQLite while emitting bounded progress snapshots.
pub fn run_scan_roots(
  app_handle: &tauri::AppHandle,
  coordinator: &ScanCoordinator,
  job: &ScanJob,
  roots: &[PathBuf],
  excluded_names: &[String],
) -> Result<ScanOutcome, String> {
  let cache_dir = app_handle
    .path()
    .app_cache_dir()
    .map_err(|error| format!("Could not resolve media cache directory: {error}"))?;
  let mut index = LibraryIndex::open_for_app(app_handle)?;
  let mut cached = index.load_indexed()?;
  let mut outcome = ScanOutcome::default();

  for root in roots {
    if job.is_cancelled() {
      outcome.cancelled = true;
      break;
    }
    let root_key = path_key(root);
    let root_label = display_path(root);
    update_and_emit(app_handle, coordinator, job, |progress| {
      progress.phase = LibraryScanPhase::Discovering;
      progress.root = root_label.clone();
      progress.error = None;
    });
    let discovered_before = outcome.discovered;
    let files = discover_supported_files(root, excluded_names, &job.cancelled, |count| {
      if count == 1 || count % 100 == 0 {
        update_and_emit(app_handle, coordinator, job, |progress| {
          progress.discovered = discovered_before + count;
        });
      }
    })?;
    outcome.discovered += files.len();
    if job.is_cancelled() {
      outcome.cancelled = true;
      break;
    }

    update_and_emit(app_handle, coordinator, job, |progress| {
      progress.phase = LibraryScanPhase::Indexing;
      progress.discovered = outcome.discovered;
    });
    let processed = AtomicUsize::new(0);
    let indexed = AtomicUsize::new(0);
    let skipped = AtomicUsize::new(0);
    let failed = AtomicUsize::new(0);
    let processed_before = outcome.processed;
    let indexed_before = outcome.indexed;
    let skipped_before = outcome.skipped;
    let failed_before = outcome.failed;
    let counters = ParallelProgressCounters {
      processed: &processed,
      indexed: &indexed,
      skipped: &skipped,
      failed: &failed,
    };
    let baseline = ScanOutcome {
      processed: processed_before,
      indexed: indexed_before,
      skipped: skipped_before,
      failed: failed_before,
      ..ScanOutcome::default()
    };

    let entries = files
      .par_iter()
      .filter_map(|path| {
        if job.is_cancelled() {
          return None;
        }
        let metadata = match fs::metadata(path) {
          Ok(metadata) => metadata,
          Err(_) => {
            failed.fetch_add(1, Ordering::Relaxed);
            report_parallel_progress(app_handle, coordinator, job, &counters, &baseline);
            return None;
          }
        };
        let key = path_key(path);
        let fingerprint = modified_ns(&metadata);
        let size = metadata.len();
        let entry = cached.get(&key).and_then(|cached_entry| {
          should_reuse_cached(
            cached_entry.modified_ns,
            cached_entry.item.file_size_bytes,
            fingerprint,
            size,
          )
          .then(|| {
            let mut reused = cached_entry.clone();
            reused.root_key = root_key.clone();
            reused
          })
        });
        let resolved = match entry {
          Some(reused) => {
            skipped.fetch_add(1, Ordering::Relaxed);
            Some(reused)
          }
          None => super::scanner::process_media_file(path, &cache_dir).map(|mut item| {
            item.path = display_path(path);
            indexed.fetch_add(1, Ordering::Relaxed);
            IndexedMedia {
              path_key: key,
              root_key: root_key.clone(),
              modified_ns: fingerprint,
              item,
            }
          }),
        };
        if resolved.is_none() {
          failed.fetch_add(1, Ordering::Relaxed);
        }
        report_parallel_progress(app_handle, coordinator, job, &counters, &baseline);
        resolved
      })
      .collect::<Vec<_>>();

    let root_processed = processed.load(Ordering::Relaxed);
    let root_indexed = indexed.load(Ordering::Relaxed);
    let root_skipped = skipped.load(Ordering::Relaxed);
    let root_failed = failed.load(Ordering::Relaxed);
    outcome.processed += root_processed;
    outcome.indexed += root_indexed;
    outcome.skipped += root_skipped;
    outcome.failed += root_failed;
    if !publish_root_if_active(&mut index, &root_key, &entries, &job.cancelled)? {
      outcome.cancelled = true;
      break;
    }
    for entry in &entries {
      cached.insert(entry.path_key.clone(), entry.clone());
    }
    update_and_emit(app_handle, coordinator, job, |progress| {
      progress.discovered = outcome.discovered;
      progress.processed = outcome.processed;
      progress.indexed = outcome.indexed;
      progress.skipped = outcome.skipped;
      progress.failed = outcome.failed;
    });
  }

  Ok(outcome)
}

/// Emits one terminal scan state before the coordinator releases the job.
pub fn finish_scan(
  app_handle: &tauri::AppHandle,
  coordinator: &ScanCoordinator,
  job: &ScanJob,
  phase: LibraryScanPhase,
  error: Option<String>,
) {
  update_and_emit(app_handle, coordinator, job, |progress| {
    progress.phase = phase;
    progress.error = error;
  });
  coordinator.finish(job);
}

struct ParallelProgressCounters<'a> {
  processed: &'a AtomicUsize,
  indexed: &'a AtomicUsize,
  skipped: &'a AtomicUsize,
  failed: &'a AtomicUsize,
}

fn report_parallel_progress(
  app_handle: &tauri::AppHandle,
  coordinator: &ScanCoordinator,
  job: &ScanJob,
  counters: &ParallelProgressCounters<'_>,
  baseline: &ScanOutcome,
) {
  let processed_now = counters.processed.fetch_add(1, Ordering::Relaxed) + 1;
  if processed_now == 1 || processed_now % 25 == 0 {
    update_and_emit(app_handle, coordinator, job, |progress| {
      progress.processed = baseline.processed + processed_now;
      progress.indexed = baseline.indexed + counters.indexed.load(Ordering::Relaxed);
      progress.skipped = baseline.skipped + counters.skipped.load(Ordering::Relaxed);
      progress.failed = baseline.failed + counters.failed.load(Ordering::Relaxed);
    });
  }
}

fn update_and_emit(
  app_handle: &tauri::AppHandle,
  coordinator: &ScanCoordinator,
  job: &ScanJob,
  update: impl FnOnce(&mut LibraryScanProgress),
) {
  if let Some(progress) = coordinator.update(job, update) {
    if let Err(error) = app_handle.emit("library-scan-progress", progress) {
      log::warn!("Could not emit library scan progress: {error}");
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  /// Creates a unique scan fixture root.
  fn test_directory(name: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("navio-scan-{name}-{}", uuid::Uuid::new_v4()))
  }

  /// Creates a minimal record for cancellation publication tests.
  fn record(id: &str, path: &std::path::Path, root_key: &str) -> IndexedMedia {
    IndexedMedia {
      path_key: path_key(path),
      root_key: root_key.to_string(),
      modified_ns: 10,
      item: crate::library::MediaItem {
        id: id.to_string(),
        path: display_path(path),
        name: path
          .file_name()
          .expect("fixture file name")
          .to_string_lossy()
          .to_string(),
        title: None,
        duration_secs: 0.0,
        file_size_bytes: 3,
        media_type: "audio".to_string(),
        cover_cache_path: None,
      },
    }
  }

  #[test]
  fn discovery_prunes_excluded_generated_directories() {
    let root = test_directory("exclusions");
    let generated = root.join("node_modules").join("package");
    let media = root.join("Videos");
    std::fs::create_dir_all(&generated).expect("create excluded tree");
    std::fs::create_dir_all(&media).expect("create media tree");
    std::fs::write(generated.join("fixture.mp3"), b"bad").expect("write excluded media");
    std::fs::write(media.join("movie.mp4"), b"bad").expect("write included media");

    let files = discover_supported_files(
      &root,
      &["node_modules".to_string()],
      &std::sync::atomic::AtomicBool::new(false),
      |_| {},
    )
    .expect("discover files");

    assert_eq!(files, vec![media.join("movie.mp4")]);
    std::fs::remove_dir_all(root).expect("remove scan fixture");
  }

  #[test]
  fn matching_fingerprint_reuses_cached_metadata() {
    assert!(should_reuse_cached(42, 1024, 42, 1024));
    assert!(!should_reuse_cached(42, 1024, 43, 1024));
    assert!(!should_reuse_cached(42, 1024, 42, 2048));
  }

  #[test]
  fn cancellation_keeps_the_previously_published_root() {
    let root = test_directory("cancel");
    std::fs::create_dir_all(&root).expect("create cancellation fixture");
    let index_path = root.join("index.sqlite3");
    let mut index = LibraryIndex::open(&index_path).expect("open test index");
    let root_key = path_key(&root);
    let old_path = root.join("old.mp3");
    let next_path = root.join("next.mp3");
    let old = record("old", &old_path, &root_key);
    let next = record("next", &next_path, &root_key);
    index
      .replace_root(&root_key, std::slice::from_ref(&old))
      .expect("seed index");
    let cancelled = std::sync::atomic::AtomicBool::new(true);

    let published = publish_root_if_active(
      &mut index,
      &root_key,
      std::slice::from_ref(&next),
      &cancelled,
    )
    .expect("handle cancelled publication");

    assert!(!published);
    assert_eq!(index.load_all().expect("load retained index")[0].id, "old");
    drop(index);
    std::fs::remove_dir_all(root).expect("remove cancellation fixture");
  }

  #[test]
  fn coordinator_runs_different_roots_concurrently() {
    let coordinator = ScanCoordinator::default();
    let movies = coordinator
      .begin("F:/Movies".to_string())
      .expect("begin first scan");
    let music = coordinator
      .begin("F:/Music".to_string())
      .expect("begin second scan");

    assert_eq!(coordinator.statuses().len(), 2);
    assert!(coordinator.has_active_jobs());
    coordinator.finish(&movies);
    coordinator.finish(&music);
    assert!(!coordinator.has_active_jobs());
  }

  #[test]
  fn coordinator_rejects_a_duplicate_active_root() {
    let coordinator = ScanCoordinator::default();
    coordinator
      .begin("F:/Movies".to_string())
      .expect("begin first scan");

    assert!(coordinator.begin("f:/movies".to_string()).is_err());
  }

  #[test]
  fn coordinator_cancels_only_the_requested_job() {
    let coordinator = ScanCoordinator::default();
    let movies = coordinator
      .begin("F:/Movies".to_string())
      .expect("begin movies");
    let music = coordinator
      .begin("F:/Music".to_string())
      .expect("begin music");

    assert!(coordinator.cancel(&movies.id));
    assert!(movies.is_cancelled());
    assert!(!music.is_cancelled());
    assert_eq!(
      coordinator
        .statuses()
        .into_iter()
        .find(|status| status.job_id == movies.id)
        .expect("movies status")
        .phase,
      LibraryScanPhase::Cancelling
    );
  }
}
