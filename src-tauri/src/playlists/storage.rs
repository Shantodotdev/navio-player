use super::models::PlaylistsDb;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use tauri::Manager;

/// Resolves the separate playlist database path and ensures its parent exists.
///
/// Playlist persistence deliberately does not reuse the library path. A
/// library save can therefore never truncate, migrate, or otherwise alter the
/// user's independent playlist collection.
pub fn get_db_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
  let app_data = app_handle
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to resolve AppData directory: {}", e))?;

  if !app_data.exists() {
    fs::create_dir_all(&app_data)
      .map_err(|e| format!("Failed to create AppData directory: {}", e))?;
  }

  Ok(app_data.join("playlists.json"))
}

/// Loads playlists from disk, returning an empty database on first launch.
///
/// JSON and filesystem errors are returned to the Tauri command so the caller
/// can distinguish a missing first-run file from a damaged existing file.
pub fn load_db(app_handle: &tauri::AppHandle) -> Result<PlaylistsDb, String> {
  let db_path = get_db_path(app_handle)?;
  if !db_path.exists() {
    return Ok(PlaylistsDb::default());
  }

  let file =
    fs::File::open(db_path).map_err(|e| format!("Failed to open playlists file: {}", e))?;
  serde_json::from_reader(std::io::BufReader::new(file))
    .map_err(|e| format!("Failed to parse playlists JSON: {}", e))
}

/// Validates playlist records before they are persisted.
///
/// This is a backend boundary check, not just UI validation: Tauri commands can
/// be invoked by any renderer code, and malformed records must not be allowed
/// to enter the durable file or the stream allowlist. Missing media files are
/// intentionally permitted so deleting a source file does not erase playlist
/// history; only the snapshot's shape and path format are validated here.
pub fn validate_db(db: &PlaylistsDb) -> Result<(), String> {
  let mut ids = std::collections::HashSet::new();
  let mut names = std::collections::HashSet::new();

  for playlist in &db.playlists {
    // IDs are the mutation key used by the UI. Duplicate IDs could make a
    // rename or delete operation target more than one logical playlist.
    if playlist.id.trim().is_empty() {
      return Err("Playlist IDs cannot be empty.".to_string());
    }
    if !ids.insert(&playlist.id) {
      return Err(format!("Duplicate playlist ID: {}", playlist.id));
    }

    // Names are user-facing, so reject blank values and make uniqueness
    // case-insensitive to avoid confusing entries such as "Mix" and "mix".
    let normalized_name = playlist.name.trim().to_lowercase();
    if normalized_name.is_empty() {
      return Err("Playlist names cannot be empty.".to_string());
    }
    if !names.insert(normalized_name) {
      return Err(format!("Duplicate playlist name: {}", playlist.name));
    }

    for track in &playlist.tracks {
      // Playlist tracks are snapshots copied from the library. Validate the
      // fields required by the stream URL and player, but do not require the
      // path to exist because the snapshot must survive library removal and
      // temporary external-drive disconnects.
      if track.id.trim().is_empty() {
        return Err(format!(
          "Playlist '{}' contains a track without an ID.",
          playlist.name
        ));
      }
      if !std::path::Path::new(&track.path).is_absolute() {
        return Err(format!(
          "Playlist '{}' contains a track with a non-absolute path.",
          playlist.name
        ));
      }
      if !track.duration_secs.is_finite() || track.duration_secs < 0.0 {
        return Err(format!(
          "Playlist '{}' contains a track with an invalid duration.",
          playlist.name
        ));
      }
      if track.media_type != "audio" && track.media_type != "video" {
        return Err(format!(
          "Playlist '{}' contains a track with an invalid media type.",
          playlist.name
        ));
      }
    }
  }

  Ok(())
}

/// Saves playlists through a temporary file before replacing the database.
///
/// Serialization happens before the live file is replaced. This prevents a
/// serialization failure from leaving a partially written JSON document. The
/// remove-and-rename fallback is needed on Windows, where renaming over an
/// existing file is not consistently supported by the standard filesystem API.
pub fn save_db(app_handle: &tauri::AppHandle, db: &PlaylistsDb) -> Result<(), String> {
  validate_db(db)?;
  let db_path = get_db_path(app_handle)?;
  let temp_path = db_path.with_extension("json.tmp");
  let mut file = fs::File::create(&temp_path)
    .map_err(|e| format!("Failed to create temporary playlists file: {}", e))?;

  serde_json::to_writer_pretty(&mut file, db)
    .map_err(|e| format!("Failed to serialize playlists JSON: {}", e))?;
  file
    .flush()
    .map_err(|e| format!("Failed to flush temporary playlists file: {}", e))?;
  drop(file);

  // Rename only after the temporary document is fully flushed and closed so a
  // reader never observes the intermediate JSON contents.
  if let Err(error) = fs::rename(&temp_path, &db_path) {
    if db_path.exists() {
      // Windows may reject replacement of an existing destination. The
      // temporary file is still intact, so remove the old version and retry.
      fs::remove_file(&db_path).map_err(|e| format!("Failed to replace playlists file: {}", e))?;
      fs::rename(&temp_path, &db_path)
        .map_err(|e| format!("Failed to finalize playlists file: {}", e))?;
    } else {
      return Err(format!("Failed to save playlists file: {}", error));
    }
  }

  Ok(())
}
