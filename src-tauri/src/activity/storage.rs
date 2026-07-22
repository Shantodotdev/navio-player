use super::models::{ActivityDatabase, TheaterDatabase, TheaterEntry};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Loads the activity database and preserves malformed data before recovering.
pub(super) fn load_database(path: &Path) -> Result<ActivityDatabase, String> {
  if !path.exists() {
    return Ok(ActivityDatabase::default());
  }

  let bytes = fs::read(path).map_err(|error| format!("Could not read activity data: {error}"))?;
  match serde_json::from_slice(&bytes) {
    Ok(database) => Ok(database),
    Err(error) => {
      let backup = corrupt_backup_path(path);
      fs::rename(path, &backup).map_err(|rename_error| {
        format!("Activity data was malformed ({error}) and could not be preserved: {rename_error}")
      })?;
      log::warn!("Preserved malformed activity data at {}", backup.display());
      Ok(ActivityDatabase::default())
    }
  }
}

/// Atomically replaces the versioned activity database on disk.
pub(super) fn save_database(path: &Path, database: &ActivityDatabase) -> Result<(), String> {
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent)
      .map_err(|error| format!("Could not create activity data directory: {error}"))?;
  }

  let temporary_path = temporary_path(path);
  let mut file = fs::OpenOptions::new()
    .write(true)
    .create_new(true)
    .open(&temporary_path)
    .map_err(|error| format!("Could not create temporary activity data: {error}"))?;
  serde_json::to_writer_pretty(&mut file, database)
    .map_err(|error| format!("Could not serialize activity data: {error}"))?;
  file
    .flush()
    .and_then(|_| file.sync_all())
    .map_err(|error| format!("Could not flush activity data: {error}"))?;
  drop(file);

  if path.exists() {
    fs::remove_file(path).map_err(|error| format!("Could not replace activity data: {error}"))?;
  }
  fs::rename(&temporary_path, path)
    .map_err(|error| format!("Could not publish activity data: {error}"))
}

/// Reads existing theater resume records without making playback depend on them.
pub(super) fn load_theater_entries(path: &Path) -> HashMap<String, TheaterEntry> {
  let Ok(bytes) = fs::read(path) else {
    return HashMap::new();
  };
  let database = serde_json::from_slice::<TheaterDatabase>(&bytes).unwrap_or_default();
  database
    .entries
    .into_values()
    .filter(|entry| !entry.path.trim().is_empty() && entry.resume_position_secs > 0.0)
    .map(|entry| (normalize_path(&entry.path), entry))
    .collect()
}

/// Normalizes host paths for case-insensitive activity reconciliation on Windows.
pub(super) fn normalize_path(path: &str) -> String {
  let normalized = path.replace('/', "\\");
  if cfg!(windows) {
    normalized.to_lowercase()
  } else {
    normalized
  }
}

fn temporary_path(path: &Path) -> PathBuf {
  let name = path
    .file_name()
    .and_then(|value| value.to_str())
    .unwrap_or("activity.json");
  path.with_file_name(format!(".{name}.{}.tmp", uuid::Uuid::new_v4()))
}

fn corrupt_backup_path(path: &Path) -> PathBuf {
  let timestamp = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_millis();
  path.with_file_name(format!("activity.corrupt-{timestamp}.json"))
}
