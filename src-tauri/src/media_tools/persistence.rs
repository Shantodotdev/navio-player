use super::*;

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
pub(super) fn is_path_allowed(path: &Path, allowed_directories: &HashSet<PathBuf>) -> bool {
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
pub(super) fn validate_media_path(
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
pub(super) fn media_fingerprint(path: &Path) -> Result<String, String> {
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
pub(super) fn now_ms() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_millis()
    .min(u128::from(u64::MAX)) as u64
}

/// Location of durable theater metadata and playback preferences.
pub(super) fn media_database_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
  app_handle
    .path()
    .app_data_dir()
    .map(|path| path.join("theater-media.json"))
    .map_err(|error| format!("Could not resolve the theater database: {}", error))
}

/// Reads a JSON file, treating a missing or malformed file as an empty store.
///
/// Cache corruption should cost a cache miss, not prevent media playback.
pub(super) async fn load_json_or_default<T>(path: &Path) -> T
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
pub(super) async fn save_json<T>(path: &Path, value: &T) -> Result<(), String>
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
  let temporary_path = path.with_file_name(format!(".{}.{}.tmp", file_name, uuid::Uuid::new_v4()));
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
pub(super) async fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
  use std::os::windows::ffi::OsStrExt;
  use windows_sys::Win32::Storage::FileSystem::{
    MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
  };

  let source = source
    .as_os_str()
    .encode_wide()
    .chain(Some(0))
    .collect::<Vec<_>>();
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
pub(super) async fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
  tokio::fs::rename(source, destination).await
}

#[cfg(windows)]
pub(super) async fn sync_parent_directory(_path: &Path) -> io::Result<()> {
  // MOVEFILE_WRITE_THROUGH flushes the replacement operation on Windows.
  Ok(())
}

#[cfg(not(windows))]
pub(super) async fn sync_parent_directory(path: &Path) -> io::Result<()> {
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
pub(super) fn prune_media_database(database: &mut MediaDatabase) {
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
