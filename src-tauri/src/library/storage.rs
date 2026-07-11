use super::*;
use std::io::Write;

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

  let db: LibraryDb =
    serde_json::from_reader(reader).map_err(|e| format!("Failed to parse database JSON: {}", e))?;

  Ok(db)
}

/// Saves the folder configuration atomically in a pretty-printed JSON format.
pub fn save_db(app_handle: &tauri::AppHandle, db: &LibraryDb) -> Result<(), String> {
  let db_path = get_db_path(app_handle)?;
  let temporary_path = db_path.with_extension("json.tmp");
  let mut file = fs::File::create(&temporary_path)
    .map_err(|e| format!("Failed to create temporary database file: {}", e))?;

  serde_json::to_writer_pretty(&mut file, db)
    .map_err(|e| format!("Failed to serialize database: {}", e))?;
  file
    .flush()
    .map_err(|e| format!("Failed to flush database file: {}", e))?;
  drop(file);

  if let Err(error) = fs::rename(&temporary_path, &db_path) {
    if db_path.exists() {
      fs::remove_file(&db_path).map_err(|e| format!("Failed to replace database file: {}", e))?;
      fs::rename(&temporary_path, &db_path)
        .map_err(|e| format!("Failed to finalize database file: {}", e))?;
    } else {
      return Err(format!("Failed to save database file: {}", error));
    }
  }

  Ok(())
}
