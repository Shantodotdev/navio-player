use super::*;

/// Retrieves the absolute file path pointing to the AppData database file.
pub fn get_db_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
  let app_data = app_handle
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to resolve AppData directory: {}", e))?;

  if !app_data.exists() {
    fs::create_dir_all(&app_data)
      .map_err(|e| format!("Failed to create AppData directory: {}", e))?;
  }

  Ok(app_data.join("library.json"))
}

/// Loads the local database file from disk.
/// Returns an empty `LibraryDb` structure if the file doesn't exist yet.
pub fn load_db(app_handle: &tauri::AppHandle) -> Result<LibraryDb, String> {
  let db_path = get_db_path(app_handle)?;
  if !db_path.exists() {
    return Ok(LibraryDb::default());
  }

  let file = fs::File::open(db_path).map_err(|e| format!("Failed to open database file: {}", e))?;
  let reader = std::io::BufReader::new(file);

  let mut db: LibraryDb =
    serde_json::from_reader(reader).map_err(|e| format!("Failed to parse database JSON: {}", e))?;

  for track in &mut db.tracks {
    if track.file_size_bytes == 0 {
      if let Ok(metadata) = fs::metadata(&track.path) {
        if metadata.is_file() {
          track.file_size_bytes = metadata.len();
        }
      }
    }
  }

  Ok(db)
}

/// Saves the current library catalog state to disk in a pretty-printed JSON format.
pub fn save_db(app_handle: &tauri::AppHandle, db: &LibraryDb) -> Result<(), String> {
  let db_path = get_db_path(app_handle)?;
  let file =
    fs::File::create(db_path).map_err(|e| format!("Failed to write database file: {}", e))?;
  let writer = std::io::BufWriter::new(file);

  serde_json::to_writer_pretty(writer, db)
    .map_err(|e| format!("Failed to serialize database: {}", e))?;

  Ok(())
}
