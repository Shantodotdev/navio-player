//! Theater-player media inspection, track preparation, and persistent caching.
//!
//! This module keeps expensive FFmpeg work away from the playback loop. It
//! fingerprints source files, stores reusable track metadata and playback
//! preferences, prepares browser-compatible subtitle/audio assets, and bounds
//! generated files with an LRU index. Concurrent requests for the same asset
//! share one FFmpeg process and can cancel it when no request still needs it.

use crate::downloader;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tokio::process::Command;
use tokio::sync::{oneshot, watch};
use tokio::io::AsyncWriteExt;

/// Maximum combined size of prepared alternate-audio files.
const MAX_AUDIO_CACHE_BYTES: u64 = 2 * 1024 * 1024 * 1024; // 2 GB
/// Maximum combined size of converted WebVTT subtitle files.
const MAX_SUBTITLE_CACHE_BYTES: u64 = 64 * 1024 * 1024; // 64 MB
/// Maximum number of source-file records retained in the persistent database.
const MAX_MEDIA_DATABASE_ENTRIES: usize = 2_000;
/// Partial outputs newer than this may still belong to an active FFmpeg job.
const STALE_PARTIAL_AGE_MS: u64 = 60 * 60 * 1_000;

/// Resolved paths to the media executables used by theater playback.
#[derive(Clone)]
pub struct MediaTools {
  /// FFmpeg is always available after [`ensure_media_tools`] succeeds.
  pub ffmpeg_path: PathBuf,
  /// FFprobe is optional because the bundled Windows package may omit it.
  pub ffprobe_path: Option<PathBuf>,
}

/// User-selectable audio or subtitle stream embedded in a video file.
#[derive(Clone, serde::Deserialize, serde::Serialize)]
pub struct EmbeddedTrack {
  /// Absolute stream index used by FFmpeg's `-map 0:<index>` syntax.
  pub stream_index: u32,
  /// Container-provided language code, usually ISO 639-2.
  pub language: Option<String>,
  /// Optional human-readable title stored in the container.
  pub title: Option<String>,
  /// Whether the container marks this stream as its default.
  pub is_default: bool,
  /// FFmpeg codec name, used to select remuxing or transcoding.
  pub codec: String,
}

/// Audio and subtitle streams discovered for one source video.
#[derive(Clone, serde::Deserialize, serde::Serialize)]
pub struct VideoTrackInfo {
  /// Selectable audio streams in container order.
  pub audio_tracks: Vec<EmbeddedTrack>,
  /// Selectable subtitle streams in container order.
  pub subtitle_tracks: Vec<EmbeddedTrack>,
}

/// Complete theater startup state returned to the React player.
///
/// Alongside track metadata, this restores the last watch position and the
/// user's language choices. `subtitle_preference_set` distinguishes an
/// explicit "subtitles off" choice from a file that has no saved preference.
#[derive(serde::Serialize)]
pub struct TheaterMediaInfo {
  /// Audio streams available in the current source file.
  pub audio_tracks: Vec<EmbeddedTrack>,
  /// Subtitle streams available in the current source file.
  pub subtitle_tracks: Vec<EmbeddedTrack>,
  /// Last persisted playback position, in seconds.
  pub resume_position_secs: f64,
  /// Audio stream explicitly selected by the user, if any.
  pub preferred_audio_stream_index: Option<u32>,
  /// Whether the user has made a subtitle choice, including choosing "off".
  pub subtitle_preference_set: bool,
  /// Preferred subtitle stream; `None` means off when preference is set.
  pub preferred_subtitle_stream_index: Option<u32>,
  /// Audio streams already prepared on disk and safe to restore immediately.
  pub cached_audio_stream_indexes: Vec<u32>,
}

/// Shared coordinator for persistent state, generated assets, and FFmpeg jobs.
///
/// Clones point to the same inner state, allowing every Tauri command to join
/// existing work and serialize JSON updates without holding global OS threads.
#[derive(Clone, Default)]
pub struct MediaCache {
  inner: Arc<MediaCacheInner>,
}

/// Locks independent resources separately so database writes do not block
/// cache cleanup or FFmpeg job registration.
#[derive(Default)]
struct MediaCacheInner {
  database_lock: tokio::sync::Mutex<()>,
  asset_index_lock: tokio::sync::Mutex<()>,
  jobs: tokio::sync::Mutex<JobState>,
}

/// Bidirectional lookup for active preparation requests.
///
/// `by_key` deduplicates work by source fingerprint and stream. `request_keys`
/// lets the UI cancel a request using only the request ID it created.
#[derive(Default)]
struct JobState {
  by_key: HashMap<String, InFlightJob>,
  request_keys: HashMap<String, String>,
}

/// One shared FFmpeg operation and all UI requests currently waiting for it.
struct InFlightJob {
  /// Publishes the final path or error to every request that joined the job.
  result: watch::Receiver<Option<Result<String, String>>>,
  /// Stops FFmpeg when the final interested request is cancelled.
  cancel: Option<oneshot::Sender<()>>,
  /// Request IDs that still depend on this shared operation.
  request_ids: HashSet<String>,
}

/// On-disk JSON database keyed by a source media fingerprint.
#[derive(Default, serde::Deserialize, serde::Serialize)]
struct MediaDatabase {
  #[serde(default)]
  entries: HashMap<String, MediaDatabaseEntry>,
}

/// Cached metadata and user playback state for one exact source-file version.
#[derive(Default, serde::Deserialize, serde::Serialize)]
struct MediaDatabaseEntry {
  /// Original path retained for diagnostics; the fingerprint is the real key.
  path: String,
  #[serde(default)]
  tracks: Option<VideoTrackInfo>,
  #[serde(default)]
  resume_position_secs: f64,
  #[serde(default)]
  preferred_audio_stream_index: Option<u32>,
  #[serde(default)]
  subtitle_preference_set: bool,
  #[serde(default)]
  preferred_subtitle_stream_index: Option<u32>,
  #[serde(default)]
  last_accessed_ms: u64,
}

/// Persistent LRU bookkeeping for generated files in the app cache directory.
#[derive(Default, serde::Deserialize, serde::Serialize)]
struct AssetIndex {
  #[serde(default)]
  entries: HashMap<String, AssetIndexEntry>,
}

/// Size and access time required to enforce a per-kind cache budget.
#[derive(serde::Deserialize, serde::Serialize)]
struct AssetIndexEntry {
  kind: AssetKind,
  size_bytes: u64,
  last_accessed_ms: u64,
}

/// Generated asset classes with independent storage limits.
#[derive(Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
enum AssetKind {
  Audio,
  Subtitle,
}

/// Minimal portion of FFprobe's JSON response used for track discovery.
#[derive(serde::Deserialize)]
struct FfprobeOutput {
  #[serde(default)]
  streams: Vec<FfprobeStream>,
}

#[derive(serde::Deserialize)]
struct FfprobeStream {
  index: u32,
  codec_type: String,
  codec_name: String,
  #[serde(default)]
  tags: FfprobeTags,
  #[serde(default)]
  disposition: FfprobeDisposition,
}

#[derive(Default, serde::Deserialize)]
struct FfprobeTags {
  language: Option<String>,
  title: Option<String>,
}

#[derive(Default, serde::Deserialize)]
struct FfprobeDisposition {
  #[serde(default)]
  default: i32,
}

/// Ensures FFmpeg is installed and resolves the optional sibling FFprobe tool.
///
/// The downloader owns installation and checksum verification. This function
/// only converts that installation into paths usable by media commands.
pub async fn ensure_media_tools(app_handle: &AppHandle) -> Result<MediaTools, String> {
  let ffmpeg_path = downloader::ensure_ffmpeg_installed(app_handle, "theater-tools").await?;
  let ffprobe_name = if cfg!(windows) {
    "ffprobe.exe"
  } else {
    "ffprobe"
  };
  let ffprobe_path = ffmpeg_path
    .parent()
    .ok_or_else(|| "Could not resolve the FFmpeg bin directory".to_string())?
    .join(ffprobe_name);

  Ok(MediaTools {
    ffmpeg_path,
    ffprobe_path: ffprobe_path.exists().then_some(ffprobe_path),
  })
}

/// Returns whether `path` is contained by one of the user's authorized media
/// directories after canonicalizing both sides.
fn is_path_allowed(path: &Path, allowed_directories: &HashSet<PathBuf>) -> bool {
  let Ok(canonical_path) = path.canonicalize() else {
    return false;
  };

  allowed_directories.iter().any(|directory| {
    directory
      .canonicalize()
      .map(|canonical_directory| canonical_path.starts_with(canonical_directory))
      .unwrap_or(false)
  })
}

/// Validates a command-supplied source path against existence and the stream
/// server allowlist, then returns one stable canonical path.
fn validate_media_path(
  path: String,
  allowed_directories: &Arc<Mutex<HashSet<PathBuf>>>,
) -> Result<PathBuf, String> {
  let media_path = PathBuf::from(path);
  if !media_path.is_file() {
    return Err("The selected video no longer exists.".to_string());
  }

  if !is_path_allowed(&media_path, &allowed_directories.lock().unwrap()) {
    return Err("The selected video is outside your media library.".to_string());
  }

  media_path
    .canonicalize()
    .map_err(|error| format!("Could not resolve the selected video: {}", error))
}

/// Builds a stable cache key for one exact version of a source file.
///
/// Hashing the canonical path, size, and modification timestamp avoids reading
/// a potentially multi-gigabyte video while still invalidating cached metadata
/// and generated tracks when the file is replaced or edited.
fn media_fingerprint(path: &Path) -> Result<String, String> {
  let metadata = path
    .metadata()
    .map_err(|error| format!("Could not read video metadata: {}", error))?;
  let modified = metadata
    .modified()
    .unwrap_or(UNIX_EPOCH)
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_nanos();
  let mut hasher = Sha256::new();
  // These inexpensive identity fields are sufficient for cache invalidation;
  // hashing the file contents would delay playback and consume disk bandwidth.
  hasher.update(path.to_string_lossy().as_bytes());
  hasher.update(metadata.len().to_le_bytes());
  hasher.update(modified.to_le_bytes());
  Ok(format!("{:x}", hasher.finalize()))
}

/// Current Unix time in milliseconds for persistent LRU ordering.
fn now_ms() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_millis()
    .min(u128::from(u64::MAX)) as u64
}

/// Location of durable theater metadata and playback preferences.
fn media_database_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
  app_handle
    .path()
    .app_data_dir()
    .map(|path| path.join("theater-media.json"))
    .map_err(|error| format!("Could not resolve the theater database: {}", error))
}

/// Reads a JSON file, treating a missing or malformed file as an empty store.
///
/// Cache corruption should cost a cache miss, not prevent media playback.
async fn load_json_or_default<T>(path: &Path) -> T
where
  T: serde::de::DeserializeOwned + Default,
{
  match tokio::fs::read(path).await {
    Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
    Err(_) => T::default(),
  }
}

/// Serializes a complete JSON store and atomically publishes it.
///
/// The bytes are flushed to a unique file in the same directory before that
/// file replaces the previous version. Readers therefore see either the old or
/// new complete document, never a partially truncated JSON payload.
async fn save_json<T>(path: &Path, value: &T) -> Result<(), String>
where
  T: serde::Serialize,
{
  if let Some(parent) = path.parent() {
    tokio::fs::create_dir_all(parent)
      .await
      .map_err(|error| format!("Could not create media data directory: {}", error))?;
  }
  let bytes = serde_json::to_vec(value)
    .map_err(|error| format!("Could not serialize media data: {}", error))?;

  let file_name = path
    .file_name()
    .and_then(|value| value.to_str())
    .unwrap_or("media.json");
  let temporary_path = path.with_file_name(format!(
    ".{}.{}.tmp",
    file_name,
    uuid::Uuid::new_v4()
  ));
  let write_result = async {
    let mut file = tokio::fs::OpenOptions::new()
      .write(true)
      .create_new(true)
      .open(&temporary_path)
      .await?;
    file.write_all(&bytes).await?;
    file.flush().await?;
    file.sync_all().await?;
    drop(file);
    replace_file(&temporary_path, path).await?;
    sync_parent_directory(path).await
  }
  .await;

  if let Err(error) = write_result {
    let _ = tokio::fs::remove_file(&temporary_path).await;
    return Err(format!("Could not save media data: {}", error));
  }
  Ok(())
}

#[cfg(windows)]
async fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
  use std::os::windows::ffi::OsStrExt;
  use windows_sys::Win32::Storage::FileSystem::{
    MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
  };

  let source = source.as_os_str().encode_wide().chain(Some(0)).collect::<Vec<_>>();
  let destination = destination
    .as_os_str()
    .encode_wide()
    .chain(Some(0))
    .collect::<Vec<_>>();
  tokio::task::spawn_blocking(move || {
    let result = unsafe {
      MoveFileExW(
        source.as_ptr(),
        destination.as_ptr(),
        MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
      )
    };
    if result == 0 {
      Err(io::Error::last_os_error())
    } else {
      Ok(())
    }
  })
  .await
  .map_err(io::Error::other)?
}

#[cfg(not(windows))]
async fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
  tokio::fs::rename(source, destination).await
}

#[cfg(windows)]
async fn sync_parent_directory(_path: &Path) -> io::Result<()> {
  // MOVEFILE_WRITE_THROUGH flushes the replacement operation on Windows.
  Ok(())
}

#[cfg(not(windows))]
async fn sync_parent_directory(path: &Path) -> io::Result<()> {
  let parent = path.parent().map(Path::to_path_buf);
  tokio::task::spawn_blocking(move || {
    if let Some(parent) = parent {
      std::fs::File::open(parent)?.sync_all()?;
    }
    Ok(())
  })
  .await
  .map_err(io::Error::other)?
}

/// Removes the least recently used source records until the database is within
/// its fixed entry budget.
fn prune_media_database(database: &mut MediaDatabase) {
  if database.entries.len() <= MAX_MEDIA_DATABASE_ENTRIES {
    return;
  }

  let mut oldest = database
    .entries
    .iter()
    .map(|(key, entry)| (key.clone(), entry.last_accessed_ms))
    .collect::<Vec<_>>();
  oldest.sort_unstable_by_key(|(_, accessed)| *accessed);
  for (key, _) in oldest
    .into_iter()
    .take(database.entries.len() - MAX_MEDIA_DATABASE_ENTRIES)
  {
    database.entries.remove(&key);
  }
}

impl MediaCache {
  /// Loads a cloned media record while serializing access to the JSON file.
  async fn load_media_entry(
    &self,
    app_handle: &AppHandle,
    fingerprint: &str,
  ) -> Result<Option<MediaDatabaseEntry>, String> {
    let _guard = self.inner.database_lock.lock().await;
    let database = load_json_or_default::<MediaDatabase>(&media_database_path(app_handle)?).await;
    Ok(
      database
        .entries
        .get(fingerprint)
        .map(|entry| MediaDatabaseEntry {
          path: entry.path.clone(),
          tracks: entry.tracks.clone(),
          resume_position_secs: entry.resume_position_secs,
          preferred_audio_stream_index: entry.preferred_audio_stream_index,
          subtitle_preference_set: entry.subtitle_preference_set,
          preferred_subtitle_stream_index: entry.preferred_subtitle_stream_index,
          last_accessed_ms: entry.last_accessed_ms,
        }),
    )
  }

  /// Applies one mutation to a media record and writes the bounded database.
  ///
  /// The callback keeps command-specific update logic close to its caller while
  /// this method owns locking, access timestamps, pruning, and persistence.
  async fn update_media_entry<F>(
    &self,
    app_handle: &AppHandle,
    fingerprint: &str,
    path: &Path,
    update: F,
  ) -> Result<(), String>
  where
    F: FnOnce(&mut MediaDatabaseEntry),
  {
    let _guard = self.inner.database_lock.lock().await;
    let database_path = media_database_path(app_handle)?;
    let mut database = load_json_or_default::<MediaDatabase>(&database_path).await;
    let entry = database.entries.entry(fingerprint.to_string()).or_default();
    entry.path = path.to_string_lossy().to_string();
    entry.last_accessed_ms = now_ms();
    update(entry);
    prune_media_database(&mut database);
    save_json(&database_path, &database).await
  }

  /// Joins an existing keyed operation or starts it once for all requesters.
  ///
  /// The returned watch receiver contains a cloneable result, allowing multiple
  /// Tauri invocations to await the same FFmpeg process without duplicate work.
  async fn join_or_start<F, Fut>(
    &self,
    key: String,
    request_id: String,
    operation: F,
  ) -> Result<String, String>
  where
    F: FnOnce(oneshot::Receiver<()>) -> Fut + Send + 'static,
    Fut: Future<Output = Result<String, String>> + Send + 'static,
  {
    let mut jobs = self.inner.jobs.lock().await;
    let receiver = if jobs.by_key.contains_key(&key) {
      // This asset is already being prepared. Register this request as another
      // consumer and subscribe to the same eventual result.
      let receiver = {
        let job = jobs.by_key.get_mut(&key).unwrap();
        job.request_ids.insert(request_id.clone());
        job.result.clone()
      };
      jobs.request_keys.insert(request_id, key);
      receiver
    } else {
      // The first request owns the operation. Later requests only subscribe to
      // `result_rx`, while the one-shot channel controls process cancellation.
      let (result_tx, result_rx) = watch::channel(None);
      let (cancel_tx, cancel_rx) = oneshot::channel();
      let mut request_ids = HashSet::new();
      request_ids.insert(request_id.clone());
      jobs.request_keys.insert(request_id, key.clone());
      jobs.by_key.insert(
        key.clone(),
        InFlightJob {
          result: result_rx.clone(),
          cancel: Some(cancel_tx),
          request_ids,
        },
      );

      let cache = self.clone();
      tokio::spawn(async move {
        let result = operation(cancel_rx).await;
        // Publish before removing registry entries so existing receivers always
        // observe a result even as the job disappears from the deduplication map.
        let _ = result_tx.send(Some(result));
        let mut jobs = cache.inner.jobs.lock().await;
        if let Some(job) = jobs.by_key.remove(&key) {
          for request_id in job.request_ids {
            jobs.request_keys.remove(&request_id);
          }
        }
      });
      result_rx
    };
    // Never hold the registry lock while waiting for FFmpeg; cancellation and
    // unrelated preparations must remain responsive.
    drop(jobs);

    let mut receiver = receiver;
    loop {
      if let Some(result) = receiver.borrow().clone() {
        return result;
      }
      receiver
        .changed()
        .await
        .map_err(|_| "Media preparation ended unexpectedly.".to_string())?;
    }
  }

  /// Removes a UI request from its active job and cancels the operation when no
  /// other request still depends on it.
  pub async fn cancel_request(&self, request_id: &str) {
    let mut jobs = self.inner.jobs.lock().await;
    let Some(key) = jobs.request_keys.remove(request_id) else {
      return;
    };
    let Some(job) = jobs.by_key.get_mut(&key) else {
      return;
    };
    job.request_ids.remove(request_id);
    // A shared extraction stays alive until its final consumer leaves.
    if job.request_ids.is_empty() {
      if let Some(cancel) = job.cancel.take() {
        let _ = cancel.send(());
      }
    }
  }

  /// Marks a generated file as recently used and enforces its cache budget.
  async fn record_asset(
    &self,
    app_handle: &AppHandle,
    path: &Path,
    kind: AssetKind,
  ) -> Result<(), String> {
    let _guard = self.inner.asset_index_lock.lock().await;
    let root = theater_cache_root(app_handle)?;
    let index_path = root.join("asset-index.json");
    let mut index = load_json_or_default::<AssetIndex>(&index_path).await;
    reconcile_asset_index(&root, &mut index).await?;
    let size_bytes = tokio::fs::metadata(path)
      .await
      .map_err(|error| format!("Could not inspect cached media: {}", error))?
      .len();
    index.entries.insert(
      path.to_string_lossy().to_string(),
      AssetIndexEntry {
        kind,
        size_bytes,
        last_accessed_ms: now_ms(),
      },
    );
    cleanup_assets(&mut index, kind, path).await;
    save_json(&index_path, &index).await
  }
}

/// Rebuilds LRU bookkeeping from the files that actually exist on disk.
///
/// This recovers from a missing or malformed index, includes assets produced by
/// the older UUID-based cache layout, and removes abandoned partial files once
/// they are old enough that no active FFmpeg job can reasonably own them.
async fn reconcile_asset_index(root: &Path, index: &mut AssetIndex) -> Result<(), String> {
  let app_cache = root
    .parent()
    .ok_or_else(|| "Could not resolve the application cache root.".to_string())?;
  let directories = [
    (root.join("audio"), AssetKind::Audio),
    (root.join("subtitles"), AssetKind::Subtitle),
    (app_cache.join("theater-audio"), AssetKind::Audio),
    (app_cache.join("theater-subtitles"), AssetKind::Subtitle),
  ];
  let mut discovered = HashSet::new();

  for (directory, kind) in directories {
    scan_asset_directory(&directory, kind, index, &mut discovered).await?;
  }

  // Anything not rediscovered was deleted externally or evicted previously.
  index.entries.retain(|path, _| discovered.contains(path));
  Ok(())
}

/// Adds regular generated files from one managed directory to the LRU index.
async fn scan_asset_directory(
  directory: &Path,
  kind: AssetKind,
  index: &mut AssetIndex,
  discovered: &mut HashSet<String>,
) -> Result<(), String> {
  let mut entries = match tokio::fs::read_dir(directory).await {
    Ok(entries) => entries,
    Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
    Err(error) => {
      return Err(format!(
        "Could not inspect theater cache directory {}: {}",
        directory.display(),
        error
      ))
    }
  };

  while let Some(entry) = entries
    .next_entry()
    .await
    .map_err(|error| format!("Could not read theater cache entry: {}", error))?
  {
    let metadata = entry
      .metadata()
      .await
      .map_err(|error| format!("Could not inspect theater cache entry: {}", error))?;
    if !metadata.is_file() {
      continue;
    }

    let path = entry.path();
    let path_key = path.to_string_lossy().to_string();
    let modified_ms = metadata
      .modified()
      .map(system_time_ms)
      .unwrap_or_else(|_| now_ms());
    let file_name = entry.file_name().to_string_lossy().to_string();
    if file_name.contains(".part.") || file_name.ends_with(".part") {
      // A recent partial file may belong to another concurrent extraction.
      if now_ms().saturating_sub(modified_ms) >= STALE_PARTIAL_AGE_MS {
        let _ = tokio::fs::remove_file(&path).await;
      }
      continue;
    }

    discovered.insert(path_key.clone());
    let previous_access = index
      .entries
      .get(&path_key)
      .map(|asset| asset.last_accessed_ms)
      .unwrap_or(modified_ms);
    index.entries.insert(
      path_key,
      AssetIndexEntry {
        kind,
        size_bytes: metadata.len(),
        last_accessed_ms: previous_access,
      },
    );
  }
  Ok(())
}

/// Converts a filesystem timestamp into the millisecond scale used by the LRU.
fn system_time_ms(time: SystemTime) -> u64 {
  time
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_millis()
    .min(u128::from(u64::MAX)) as u64
}

/// Evicts least recently used files of one kind until that kind is under its
/// byte limit. The file just produced or selected is protected from this pass.
async fn cleanup_assets(index: &mut AssetIndex, kind: AssetKind, protected_path: &Path) {
  let limit = match kind {
    AssetKind::Audio => MAX_AUDIO_CACHE_BYTES,
    AssetKind::Subtitle => MAX_SUBTITLE_CACHE_BYTES,
  };
  let mut total = index
    .entries
    .values()
    .filter(|entry| entry.kind == kind)
    .map(|entry| entry.size_bytes)
    .sum::<u64>();
  if total <= limit {
    return;
  }

  let protected = protected_path.to_string_lossy();
  let mut candidates = index
    .entries
    .iter()
    .filter(|(path, entry)| entry.kind == kind && path.as_str() != protected)
    .map(|(path, entry)| (path.clone(), entry.last_accessed_ms, entry.size_bytes))
    .collect::<Vec<_>>();
  candidates.sort_unstable_by_key(|(_, accessed, _)| *accessed);

  for (path, _, size) in candidates {
    if total <= limit {
      break;
    }
    if tokio::fs::remove_file(&path).await.is_ok() {
      index.entries.remove(&path);
      total = total.saturating_sub(size);
    }
  }
}

/// Root directory for disposable theater audio, subtitle, and LRU data.
fn theater_cache_root(app_handle: &AppHandle) -> Result<PathBuf, String> {
  app_handle
    .path()
    .app_cache_dir()
    .map(|path| path.join("theater-media"))
    .map_err(|error| format!("Could not resolve the theater cache: {}", error))
}

/// Returns the browser-friendly extension and whether FFmpeg can stream-copy
/// the codec without decoding and re-encoding it.
fn audio_output_details(codec: &str) -> (&'static str, bool) {
  match codec {
    "aac" => ("m4a", true),
    "opus" | "vorbis" => ("ogg", true),
    "mp3" => ("mp3", true),
    _ => ("ogg", false),
  }
}

/// Deterministic path for an audio stream prepared from a fingerprinted source.
fn audio_output_path(root: &Path, fingerprint: &str, stream_index: u32, codec: &str) -> PathBuf {
  let (extension, _) = audio_output_details(codec);
  root
    .join("audio")
    .join(format!("{}-{}.{}", fingerprint, stream_index, extension))
}

/// Creates a unique partial-file path while retaining the final extension.
///
/// FFmpeg uses the extension to infer its output container. A unique temporary
/// path prevents interrupted jobs from being mistaken for valid cache hits.
fn temporary_output_path(output_path: &Path) -> PathBuf {
  let stem = output_path
    .file_stem()
    .and_then(|value| value.to_str())
    .unwrap_or("media");
  let extension = output_path
    .extension()
    .and_then(|value| value.to_str())
    .unwrap_or("tmp");
  output_path.with_file_name(format!(
    "{}.{}.part.{}",
    stem,
    uuid::Uuid::new_v4(),
    extension
  ))
}

/// Returns embedded track metadata and saved theater state for a video.
///
/// Track metadata is read from the persistent fingerprint cache when possible.
/// On a miss, FFprobe is preferred and FFmpeg's diagnostic output is parsed as
/// a fallback for distributions that do not include FFprobe.
pub async fn inspect_video_tracks(
  app_handle: &AppHandle,
  allowed_directories: &Arc<Mutex<HashSet<PathBuf>>>,
  cache: &MediaCache,
  path: String,
) -> Result<TheaterMediaInfo, String> {
  let media_path = validate_media_path(path, allowed_directories)?;
  let fingerprint = media_fingerprint(&media_path)?;
  let cached_entry = cache.load_media_entry(app_handle, &fingerprint).await?;
  let tracks = if let Some(tracks) = cached_entry.as_ref().and_then(|entry| entry.tracks.clone()) {
    // The fingerprint already includes source size and mtime, so this metadata
    // belongs to the exact source-file version being opened.
    tracks
  } else {
    let tools = ensure_media_tools(app_handle).await?;
    let parsed = if let Some(ffprobe_path) = tools.ffprobe_path {
      let output = Command::new(ffprobe_path)
        .args([
          "-v",
          "error",
          "-show_entries",
          "stream=index,codec_type,codec_name:stream_tags=language,title:stream_disposition=default",
          "-of",
          "json",
        ])
        .arg(&media_path)
        .output()
        .await
        .map_err(|error| format!("Could not start ffprobe: {}", error))?;

      if !output.status.success() {
        return Err(format!(
          "ffprobe could not inspect this video: {}",
          String::from_utf8_lossy(&output.stderr).trim()
        ));
      }

      serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("ffprobe returned invalid metadata: {}", error))?
    } else {
      // Some pinned Windows FFmpeg archives contain ffmpeg.exe only.
      inspect_streams_with_ffmpeg(&tools.ffmpeg_path, &media_path).await?
    };
    let mut audio_tracks = Vec::new();
    let mut subtitle_tracks = Vec::new();

    for stream in parsed.streams {
      let track = EmbeddedTrack {
        stream_index: stream.index,
        language: stream.tags.language,
        title: stream.tags.title,
        is_default: stream.disposition.default != 0,
        codec: stream.codec_name,
      };

      match stream.codec_type.as_str() {
        "audio" => audio_tracks.push(track),
        "subtitle" => subtitle_tracks.push(track),
        _ => {}
      }
    }

    let tracks = VideoTrackInfo {
      audio_tracks,
      subtitle_tracks,
    };
    cache
      .update_media_entry(app_handle, &fingerprint, &media_path, |entry| {
        entry.tracks = Some(tracks.clone());
      })
      .await?;
    tracks
  };

  let entry = cache
    .load_media_entry(app_handle, &fingerprint)
    .await?
    .unwrap_or_default();
  let cache_root = theater_cache_root(app_handle)?;
  // The frontend uses this list to restore a transcoded preference only when
  // the expensive work has already been completed in an earlier session.
  let cached_audio_stream_indexes = tracks
    .audio_tracks
    .iter()
    .filter(|track| {
      audio_output_path(&cache_root, &fingerprint, track.stream_index, &track.codec).is_file()
    })
    .map(|track| track.stream_index)
    .collect();

  Ok(TheaterMediaInfo {
    audio_tracks: tracks.audio_tracks,
    subtitle_tracks: tracks.subtitle_tracks,
    resume_position_secs: entry.resume_position_secs,
    preferred_audio_stream_index: entry.preferred_audio_stream_index,
    subtitle_preference_set: entry.subtitle_preference_set,
    preferred_subtitle_stream_index: entry.preferred_subtitle_stream_index,
    cached_audio_stream_indexes,
  })
}

/// Discovers stream metadata by parsing FFmpeg's standard input summary.
///
/// FFmpeg exits unsuccessfully when invoked without an output, but its stderr
/// still contains the stream table needed here. Only audio and subtitle rows
/// are converted into the small FFprobe-compatible representation above.
async fn inspect_streams_with_ffmpeg(
  ffmpeg_path: &Path,
  media_path: &Path,
) -> Result<FfprobeOutput, String> {
  let output = Command::new(ffmpeg_path)
    .args(["-hide_banner", "-i"])
    .arg(media_path)
    .output()
    .await
    .map_err(|error| format!("Could not start FFmpeg: {}", error))?;
  let stderr = String::from_utf8_lossy(&output.stderr);
  let mut streams = Vec::new();

  for line in stderr.lines() {
    let trimmed = line.trim();
    let Some(stream_start) = trimmed.find("Stream #0:") else {
      continue;
    };
    let remainder = &trimmed[stream_start + "Stream #0:".len()..];
    let Some((index_part, description)) = remainder.split_once(": ") else {
      continue;
    };

    // Typical forms are `1(eng)` and `2`; keep the language optional because
    // not every container labels its streams.
    let (index_text, language) = match index_part.split_once('(') {
      Some((index, language_part)) => (index, language_part.strip_suffix(')')),
      None => (index_part, None),
    };
    let Ok(index) = index_text.parse::<u32>() else {
      continue;
    };

    let (codec_type, codec_description) =
      if let Some(description) = description.strip_prefix("Audio:") {
        ("audio", description)
      } else if let Some(description) = description.strip_prefix("Subtitle:") {
        ("subtitle", description)
      } else {
        continue;
      };

    let codec = codec_description
      .trim()
      .split([',', ' '])
      .next()
      .unwrap_or("unknown")
      .to_string();
    streams.push(FfprobeStream {
      index,
      codec_type: codec_type.to_string(),
      codec_name: codec,
      tags: FfprobeTags {
        language: language.map(str::to_string),
        title: None,
      },
      disposition: FfprobeDisposition {
        default: i32::from(description.contains("(default)")),
      },
    });
  }

  if streams.is_empty() {
    return Err(format!(
      "FFmpeg could not read stream metadata: {}",
      stderr.lines().last().unwrap_or("unknown error")
    ));
  }

  Ok(FfprobeOutput { streams })
}

/// Runs one FFmpeg process and races it against a cancellation signal.
///
/// `kill_on_drop` ensures cancellation terminates the child process rather than
/// merely abandoning its future. Failed and cancelled outputs are deleted so a
/// later request cannot consume a partial asset.
async fn run_ffmpeg(
  mut command: Command,
  mut cancel: oneshot::Receiver<()>,
  output_path: &Path,
) -> Result<(), String> {
  command.kill_on_drop(true);
  let child = command
    .spawn()
    .map_err(|error| format!("Could not start FFmpeg: {}", error))?;
  let output = tokio::select! {
    output = child.wait_with_output() => output
      .map_err(|error| format!("Could not wait for FFmpeg: {}", error))?,
    _ = &mut cancel => {
      let _ = tokio::fs::remove_file(output_path).await;
      return Err("Media preparation was cancelled.".to_string());
    }
  };

  if output.status.success() {
    Ok(())
  } else {
    let _ = tokio::fs::remove_file(output_path).await;
    Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
  }
}

/// Converts one embedded subtitle stream to a cached WebVTT file.
///
/// Requests for an existing deterministic output are immediate LRU hits.
/// Concurrent misses for the same source fingerprint and stream share one
/// cancellable FFmpeg job.
pub async fn extract_subtitle_track(
  app_handle: &AppHandle,
  allowed_directories: &Arc<Mutex<HashSet<PathBuf>>>,
  cache: &MediaCache,
  path: String,
  stream_index: u32,
  request_id: String,
) -> Result<String, String> {
  let media_path = validate_media_path(path, allowed_directories)?;
  let fingerprint = media_fingerprint(&media_path)?;
  let subtitle_directory = theater_cache_root(app_handle)?.join("subtitles");
  tokio::fs::create_dir_all(&subtitle_directory)
    .await
    .map_err(|error| format!("Could not create the subtitle cache: {}", error))?;
  let output_path = subtitle_directory.join(format!("{}-{}.vtt", fingerprint, stream_index));

  if output_path.is_file() {
    // Cache hits still refresh the LRU timestamp before returning.
    cache
      .record_asset(app_handle, &output_path, AssetKind::Subtitle)
      .await?;
    allowed_directories
      .lock()
      .unwrap()
      .insert(subtitle_directory);
    return Ok(output_path.to_string_lossy().to_string());
  }

  let key = format!("subtitle:{}:{}", fingerprint, stream_index);
  let app = app_handle.clone();
  let cache_for_job = cache.clone();
  let output_for_job = output_path.clone();
  let media_for_job = media_path.clone();
  let result = cache
    .join_or_start(key, request_id, move |cancel| async move {
      let tools = ensure_media_tools(&app).await?;
      let temporary_path = temporary_output_path(&output_for_job);
      let mut command = Command::new(tools.ffmpeg_path);
      command
        .args(["-y", "-i"])
        .arg(&media_for_job)
        .args(["-map", &format!("0:{}", stream_index), "-c:s", "webvtt"])
        .arg(&temporary_path);
      run_ffmpeg(command, cancel, &temporary_path)
        .await
        .map_err(|error| {
          format!(
            "This subtitle track cannot be converted to WebVTT: {}",
            error
          )
        })?;
      // Publish only a completed file under the deterministic cache name.
      tokio::fs::rename(&temporary_path, &output_for_job)
        .await
        .map_err(|error| format!("Could not finalize cached subtitles: {}", error))?;
      cache_for_job
        .record_asset(&app, &output_for_job, AssetKind::Subtitle)
        .await?;
      Ok(output_for_job.to_string_lossy().to_string())
    })
    .await?;

  allowed_directories
    .lock()
    .unwrap()
    .insert(subtitle_directory);
  Ok(result)
}

/// Prepares one embedded audio stream as a separately synchronized cached file.
///
/// AAC, MP3, Opus, and Vorbis streams are remuxed with `copy`, avoiding CPU
/// heavy transcoding. Other codecs are converted to Opus only after the user
/// explicitly requests that track. Work is deduplicated by source and stream.
pub async fn extract_audio_track(
  app_handle: &AppHandle,
  allowed_directories: &Arc<Mutex<HashSet<PathBuf>>>,
  cache: &MediaCache,
  path: String,
  stream_index: u32,
  codec: String,
  request_id: String,
) -> Result<String, String> {
  let media_path = validate_media_path(path, allowed_directories)?;
  let fingerprint = media_fingerprint(&media_path)?;
  let cache_root = theater_cache_root(app_handle)?;
  let audio_directory = cache_root.join("audio");
  tokio::fs::create_dir_all(&audio_directory)
    .await
    .map_err(|error| format!("Could not create the audio cache: {}", error))?;
  let output_path = audio_output_path(&cache_root, &fingerprint, stream_index, &codec);

  if output_path.is_file() {
    // Reusing the deterministic output avoids both source reads and codec work.
    cache
      .record_asset(app_handle, &output_path, AssetKind::Audio)
      .await?;
    allowed_directories.lock().unwrap().insert(audio_directory);
    return Ok(output_path.to_string_lossy().to_string());
  }

  let (extension, copy_audio) = audio_output_details(&codec);
  let key = format!("audio:{}:{}:{}", fingerprint, stream_index, extension);
  let app = app_handle.clone();
  let cache_for_job = cache.clone();
  let output_for_job = output_path.clone();
  let media_for_job = media_path.clone();
  let result = cache
    .join_or_start(key, request_id, move |cancel| async move {
      let tools = ensure_media_tools(&app).await?;
      let temporary_path = temporary_output_path(&output_for_job);
      let mut command = Command::new(tools.ffmpeg_path);
      command
        .args(["-y", "-i"])
        .arg(&media_for_job)
        .args(["-map", &format!("0:{}", stream_index), "-vn", "-c:a"])
        .arg(if copy_audio { "copy" } else { "libopus" })
        .arg(&temporary_path);
      run_ffmpeg(command, cancel, &temporary_path)
        .await
        .map_err(|error| {
          format!(
            "This audio track cannot be prepared for playback: {}",
            error
          )
        })?;
      // Renaming after success prevents partial files from becoming cache hits.
      tokio::fs::rename(&temporary_path, &output_for_job)
        .await
        .map_err(|error| format!("Could not finalize cached audio: {}", error))?;
      cache_for_job
        .record_asset(&app, &output_for_job, AssetKind::Audio)
        .await?;
      Ok(output_for_job.to_string_lossy().to_string())
    })
    .await?;

  allowed_directories.lock().unwrap().insert(audio_directory);
  Ok(result)
}

/// Persists resume progress and, when requested, audio/subtitle preferences.
///
/// Frequent playback checkpoints set `save_preferences` to false so they cannot
/// overwrite a newer explicit language selection with stale UI state. Passing
/// `subtitle_enabled = false` records an intentional "subtitles off" choice.
pub async fn save_theater_state(
  app_handle: &AppHandle,
  allowed_directories: &Arc<Mutex<HashSet<PathBuf>>>,
  cache: &MediaCache,
  path: String,
  position_secs: f64,
  audio_stream_index: Option<u32>,
  subtitle_stream_index: Option<u32>,
  subtitle_enabled: bool,
  save_preferences: bool,
) -> Result<(), String> {
  let media_path = validate_media_path(path, allowed_directories)?;
  let fingerprint = media_fingerprint(&media_path)?;
  cache
    .update_media_entry(app_handle, &fingerprint, &media_path, |entry| {
      entry.resume_position_secs = position_secs.max(0.0);
      if save_preferences {
        entry.preferred_audio_stream_index = audio_stream_index;
        entry.subtitle_preference_set = true;
        entry.preferred_subtitle_stream_index =
          subtitle_enabled.then_some(subtitle_stream_index).flatten();
      }
    })
    .await
}
