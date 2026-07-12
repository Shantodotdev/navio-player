//! Durable queue storage and in-memory process coordination for Navio downloads.
//!
//! `DownloadManager` has two intentionally separate responsibilities. Its
//! persistent half stores serializable job records in AppData using atomic JSON
//! replacement; this survives app restarts and is the frontend's source of
//! truth. Its ephemeral half maps active job IDs to `DownloadControl` handles,
//! which own the currently running Tokio child process and requested stop action.
//!
//! Process handles are never persisted because they cannot be restored safely.
//! On startup or clean exit, active durable states are therefore converted to
//! `interrupted` while their private staging directories remain available for a
//! later yt-dlp resume. Conversely, Cancel is destructive: the worker removes
//! only the staging directory derived from the manager-owned UUID, never a path
//! supplied by the renderer.

use super::{DownloadJob, DownloadRequest, DownloadStatus};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use tokio::process::Child;

const DOWNLOAD_DB_VERSION: u32 = 1;

/// Persistent local representation of Navio's download queue.
#[derive(Default, serde::Deserialize, serde::Serialize)]
struct DownloadDatabase {
  #[serde(default)]
  version: u32,
  #[serde(default)]
  jobs: Vec<DownloadJob>,
}

/// Shared owner of durable download records. Process controls are added separately.
#[derive(Clone)]
pub struct DownloadManager {
  // The durable queue is protected separately from process controls so a slow
  // child-process operation never blocks reads or atomic JSON persistence.
  inner: Arc<Mutex<DownloadManagerInner>>,
  // Controls are intentionally memory-only. After a crash there is no safe
  // process handle to restore, so startup converts active durable records to
  // `interrupted` instead of pretending the old process still exists.
  controls: Arc<Mutex<HashMap<String, DownloadControl>>>,
}

struct DownloadManagerInner {
  database_path: PathBuf,
  jobs: HashMap<String, DownloadJob>,
}

/// Reason a worker should stop rather than treating a killed child as an error.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StopAction {
  None = 0,
  Pause = 1,
  Cancel = 2,
  Exit = 3,
}

impl StopAction {
  /// Reads one action previously stored in an atomic process control.
  fn from_u8(value: u8) -> Self {
    match value {
      1 => Self::Pause,
      2 => Self::Cancel,
      3 => Self::Exit,
      _ => Self::None,
    }
  }
}

/// Handle shared between a Tauri command and one spawned yt-dlp worker.
#[derive(Clone)]
pub struct DownloadControl {
  // Atomic storage lets a Tauri command signal pause/cancel while the worker is
  // awaiting yt-dlp setup, stdout, stderr, or process termination.
  action: Arc<AtomicU8>,
  // Tokio's mutex allows the command and worker to coordinate a Child across
  // await points without holding the download database lock.
  child: Arc<tokio::sync::Mutex<Option<Child>>>,
}

impl DownloadControl {
  /// Creates an idle control before preparation begins, allowing immediate cancellation.
  fn new() -> Self {
    Self {
      action: Arc::new(AtomicU8::new(StopAction::None as u8)),
      child: Arc::new(tokio::sync::Mutex::new(None)),
    }
  }

  /// Returns the latest requested stop action.
  pub fn action(&self) -> StopAction {
    StopAction::from_u8(self.action.load(Ordering::SeqCst))
  }

  /// Records a stop action so setup and process phases agree on the result.
  fn request(&self, action: StopAction) {
    self.action.store(action as u8, Ordering::SeqCst);
  }

  /// Gives the control ownership of a spawned yt-dlp process.
  pub async fn attach_child(&self, child: Child) {
    *self.child.lock().await = Some(child);
  }

  /// Waits for the registered child to exit and removes it from this control.
  pub async fn wait_for_child(&self) -> Result<std::process::ExitStatus, String> {
    let mut child_guard = self.child.lock().await;
    let child = child_guard
      .as_mut()
      .ok_or_else(|| "Download process was not registered.".to_string())?;
    let status = child
      .wait()
      .await
      .map_err(|error| format!("Failed to wait for download process: {error}"))?;
    *child_guard = None;
    Ok(status)
  }

  /// Stops the tracked process, including descendants on Windows where FFmpeg is a child process.
  async fn stop_process(&self) {
    let process_id = self.child.lock().await.as_ref().and_then(Child::id);
    #[cfg(windows)]
    if let Some(process_id) = process_id {
      // yt-dlp can spawn FFmpeg for merging. Killing only the yt-dlp parent on
      // Windows would leave that descendant writing into the staging folder.
      let _ = tokio::process::Command::new("taskkill")
        .args(["/PID", &process_id.to_string(), "/T", "/F"])
        .status()
        .await;
    }
    let mut child = self.child.lock().await;
    if let Some(child) = child.as_mut() {
      let _ = child.start_kill();
    }
  }
}

impl DownloadManager {
  /// Loads the queue from AppData, creating its parent directory when necessary.
  pub fn load(app_handle: &AppHandle) -> Result<Self, String> {
    let app_data = app_handle
      .path()
      .app_data_dir()
      .map_err(|error| format!("Failed to resolve AppData directory: {error}"))?;
    Self::for_path(app_data.join("downloads.json"))
  }

  /// Builds a manager for one known database path; exposed for focused unit tests.
  pub fn for_path(database_path: PathBuf) -> Result<Self, String> {
    let parent = database_path
      .parent()
      .ok_or_else(|| "Download database path has no parent directory.".to_string())?;
    fs::create_dir_all(parent)
      .map_err(|error| format!("Failed to create Navio data directory: {error}"))?;

    let database = load_database(&database_path)?;
    let jobs = database
      .jobs
      .into_iter()
      .map(|job| (job.id.clone(), job))
      .collect();
    Ok(Self {
      inner: Arc::new(Mutex::new(DownloadManagerInner {
        database_path,
        jobs,
      })),
      controls: Arc::new(Mutex::new(HashMap::new())),
    })
  }

  /// Returns all records with newest updates first.
  pub fn list(&self) -> Vec<DownloadJob> {
    let inner = self.inner.lock().expect("download manager lock poisoned");
    let mut jobs = inner.jobs.values().cloned().collect::<Vec<_>>();
    jobs.sort_by_key(|job| std::cmp::Reverse(job.updated_at_ms));
    jobs
  }

  /// Returns one durable job by ID.
  pub fn get(&self, id: &str) -> Option<DownloadJob> {
    self
      .inner
      .lock()
      .expect("download manager lock poisoned")
      .jobs
      .get(id)
      .cloned()
  }

  /// Creates and durably stores a newly requested job.
  pub fn create(&self, id: String, request: DownloadRequest) -> Result<DownloadJob, String> {
    self.mutate(|jobs| {
      if jobs.contains_key(&id) {
        return Err("A download with this ID already exists.".to_string());
      }
      let job = DownloadJob::new(id.clone(), request);
      jobs.insert(id, job.clone());
      Ok(job)
    })
  }

  /// Applies one durable mutation to a job and returns the changed record.
  pub fn update<F>(&self, id: &str, update: F) -> Result<DownloadJob, String>
  where
    F: FnOnce(&mut DownloadJob) -> Result<(), String>,
  {
    self.mutate(|jobs| {
      let job = jobs
        .get_mut(id)
        .ok_or_else(|| "Download was not found.".to_string())?;
      update(job)?;
      job.touch();
      Ok(job.clone())
    })
  }

  /// Resets a paused, failed, or interrupted record before another yt-dlp attempt.
  pub fn prepare_retry(&self, id: &str) -> Result<DownloadJob, String> {
    if self
      .controls
      .lock()
      .expect("download controls lock poisoned")
      .contains_key(id)
    {
      // A pause command changes the visible state before the OS has confirmed
      // process exit. Refuse retry in this narrow window so two workers can
      // never write into the same resumable staging directory.
      return Err("Download is still stopping. Try again in a moment.".to_string());
    }
    self.update(id, |job| {
      if !job.status.can_resume() {
        return Err("Only paused, failed, or interrupted downloads can be resumed.".to_string());
      }
      job.status = DownloadStatus::Queued;
      job.progress = 0.0;
      job.speed = "Queued".to_string();
      job.eta = "—".to_string();
      job.size = "—".to_string();
      job.error = None;
      job.current_item = None;
      job.total_items = None;
      Ok(())
    })
  }

  /// Claims a queued job for a single worker and returns its process control.
  pub fn claim_attempt(&self, id: &str) -> Result<DownloadControl, String> {
    let job = self
      .get(id)
      .ok_or_else(|| "Download was not found.".to_string())?;
    if job.status != DownloadStatus::Queued {
      return Err("Download is not ready to start.".to_string());
    }
    let mut controls = self
      .controls
      .lock()
      .expect("download controls lock poisoned");
    if controls.contains_key(id) {
      return Err("Download is already running.".to_string());
    }
    let control = DownloadControl::new();
    controls.insert(id.to_string(), control.clone());
    Ok(control)
  }

  /// Releases a worker control after its final durable state has been stored.
  pub fn release_attempt(&self, id: &str) {
    self
      .controls
      .lock()
      .expect("download controls lock poisoned")
      .remove(id);
  }

  /// Applies a user pause or cancel request and terminates the live process when present.
  pub async fn request_stop(&self, id: &str, action: StopAction) -> Result<DownloadJob, String> {
    if !matches!(action, StopAction::Pause | StopAction::Cancel) {
      return Err("Unsupported download stop action.".to_string());
    }
    let job = self.update(id, |job| {
      if !job.status.is_active() {
        return Err("Only an active download can be paused or cancelled.".to_string());
      }
      match action {
        StopAction::Pause => {
          job.status = DownloadStatus::Paused;
          job.speed = "Paused".to_string();
          job.eta = "—".to_string();
        }
        StopAction::Cancel => {
          job.status = DownloadStatus::Cancelled;
          job.speed = "Cancelled".to_string();
          job.eta = "—".to_string();
          job.error = None;
        }
        _ => unreachable!(),
      }
      Ok(())
    })?;
    // Persist the user intent before asking the OS to stop the process. If the
    // app exits immediately afterwards, recovery still reports the requested
    // outcome instead of a misleading generic failure.
    let control = self
      .controls
      .lock()
      .expect("download controls lock poisoned")
      .get(id)
      .cloned()
      .ok_or_else(|| "Download worker is no longer available.".to_string())?;
    control.request(action);
    control.stop_process().await;
    Ok(job)
  }

  /// Marks active records interrupted after a clean exit or crash recovery.
  pub fn recover_interrupted(&self) -> Result<Vec<DownloadJob>, String> {
    self.mutate(|jobs| {
      let mut recovered = Vec::new();
      for job in jobs.values_mut() {
        if job.status.is_active() {
          // No process IDs are persisted: a saved `downloading` state can only
          // mean Navio stopped before it could write a terminal transition.
          job.status = DownloadStatus::Interrupted;
          job.speed = "Interrupted".to_string();
          job.eta = "—".to_string();
          job.error = Some("Navio was closed before this download finished.".to_string());
          job.touch();
          recovered.push(job.clone());
        }
      }
      Ok(recovered)
    })
  }

  /// Removes a terminal job from history without touching downloaded media.
  pub fn remove(&self, id: &str) -> Result<(), String> {
    self.mutate(|jobs| {
      let job = jobs
        .get(id)
        .ok_or_else(|| "Download was not found.".to_string())?;
      if job.status.is_active() || job.status == DownloadStatus::Paused {
        return Err("Stop the download before removing it from history.".to_string());
      }
      jobs.remove(id);
      Ok(())
    })
  }

  /// Locates the private staging directory for one job without accepting UI paths.
  pub fn staging_dir(&self, app_handle: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if self.get(id).is_none() {
      return Err("Download was not found.".to_string());
    }
    let app_data = app_handle
      .path()
      .app_data_dir()
      .map_err(|error| format!("Failed to resolve AppData directory: {error}"))?;
    Ok(app_data.join("download-work").join(id))
  }

  /// Removes abandoned private staging directories for jobs already marked cancelled.
  pub fn cleanup_cancelled_staging(&self, app_handle: &AppHandle) -> Result<(), String> {
    for job in self.list() {
      if job.status == DownloadStatus::Cancelled {
        let staging_dir = self.staging_dir(app_handle, &job.id)?;
        if staging_dir.exists() {
          fs::remove_dir_all(&staging_dir)
            .map_err(|error| format!("Failed to remove cancelled partial download: {error}"))?;
        }
      }
    }
    Ok(())
  }

  /// Runs a transaction, writes it atomically, and returns the caller result.
  fn mutate<T, F>(&self, mutation: F) -> Result<T, String>
  where
    F: FnOnce(&mut HashMap<String, DownloadJob>) -> Result<T, String>,
  {
    let mut inner = self.inner.lock().expect("download manager lock poisoned");
    let result = mutation(&mut inner.jobs)?;
    // The event emitter runs after this method returns, so UI observers never
    // receive a job state that has not already reached disk.
    save_database(&inner.database_path, inner.jobs.values())?;
    Ok(result)
  }
}

/// Reads a local queue, treating a missing file as an empty database.
fn load_database(path: &Path) -> Result<DownloadDatabase, String> {
  if !path.exists() {
    return Ok(DownloadDatabase::default());
  }
  let file =
    fs::File::open(path).map_err(|error| format!("Failed to open download database: {error}"))?;
  serde_json::from_reader(std::io::BufReader::new(file))
    .map_err(|error| format!("Failed to parse download database: {error}"))
}

/// Atomically writes every current record so an interrupted write never corrupts history.
fn save_database<'a>(
  path: &Path,
  jobs: impl Iterator<Item = &'a DownloadJob>,
) -> Result<(), String> {
  let database = DownloadDatabase {
    version: DOWNLOAD_DB_VERSION,
    jobs: jobs.cloned().collect(),
  };
  let temporary_path = path.with_extension("json.tmp");
  let mut file = fs::File::create(&temporary_path)
    .map_err(|error| format!("Failed to create temporary download database: {error}"))?;
  serde_json::to_writer_pretty(&mut file, &database)
    .map_err(|error| format!("Failed to serialize download database: {error}"))?;
  file
    .flush()
    .map_err(|error| format!("Failed to flush download database: {error}"))?;
  drop(file);
  // Rename is atomic on the normal local filesystem. Windows cannot replace an
  // existing destination directly, so the fallback removes only this manager's
  // database after its complete temporary replacement has been flushed.
  if let Err(error) = fs::rename(&temporary_path, path) {
    if path.exists() {
      fs::remove_file(path)
        .map_err(|remove_error| format!("Failed to replace download database: {remove_error}"))?;
      fs::rename(&temporary_path, path)
        .map_err(|rename_error| format!("Failed to finalize download database: {rename_error}"))?;
    } else {
      return Err(format!("Failed to save download database: {error}"));
    }
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  use uuid::Uuid;

  /// Creates an isolated database path without adding a test-only dependency.
  fn test_database_path() -> PathBuf {
    std::env::temp_dir().join(format!("navio-download-test-{}.json", Uuid::new_v4()))
  }

  #[test]
  fn recovery_marks_active_jobs_interrupted_but_preserves_paused_jobs() {
    let path = test_database_path();
    let manager = DownloadManager::for_path(path.clone()).expect("manager should load");
    let active = manager
      .create(
        "active".to_string(),
        DownloadRequest {
          url: "https://example.test/a".to_string(),
          format: "best".to_string(),
          no_playlist: true,
        },
      )
      .expect("job should persist");
    manager
      .update(&active.id, |job| {
        job.status = DownloadStatus::Downloading;
        Ok(())
      })
      .expect("active status should persist");
    let paused = manager
      .create(
        "paused".to_string(),
        DownloadRequest {
          url: "https://example.test/b".to_string(),
          format: "bestaudio".to_string(),
          no_playlist: true,
        },
      )
      .expect("paused job should persist");
    manager
      .update(&paused.id, |job| {
        job.status = DownloadStatus::Paused;
        Ok(())
      })
      .expect("paused status should persist");

    manager
      .recover_interrupted()
      .expect("recovery should persist");

    assert_eq!(
      manager.get("active").unwrap().status,
      DownloadStatus::Interrupted
    );
    assert_eq!(
      manager.get("paused").unwrap().status,
      DownloadStatus::Paused
    );
    let _ = fs::remove_file(path);
  }

  #[test]
  fn retry_resets_a_failed_job_without_changing_its_request() {
    let path = test_database_path();
    let manager = DownloadManager::for_path(path.clone()).expect("manager should load");
    let job = manager
      .create(
        "retry".to_string(),
        DownloadRequest {
          url: "https://example.test/retry".to_string(),
          format: "bestaudio".to_string(),
          no_playlist: false,
        },
      )
      .expect("job should persist");
    manager
      .update(&job.id, |job| {
        job.status = DownloadStatus::Failed;
        job.error = Some("network lost".to_string());
        job.progress = 42.0;
        Ok(())
      })
      .expect("failure should persist");

    let retried = manager
      .prepare_retry(&job.id)
      .expect("failed job should be retryable");

    assert_eq!(retried.status, DownloadStatus::Queued);
    assert_eq!(retried.progress, 0.0);
    assert!(retried.error.is_none());
    assert_eq!(retried.request.url, "https://example.test/retry");
    let _ = fs::remove_file(path);
  }
}
