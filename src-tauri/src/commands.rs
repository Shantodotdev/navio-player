#[tauri::command]
pub fn get_stream_port(state: tauri::State<'_, AppState>) -> u16 {
  println!(
    "[Navio Command] get_stream_port | port={}",
    state.stream_port
  );
  state.stream_port
}

/// Tauri command to retrieve the stream server connection config.
#[tauri::command]
pub fn get_stream_config(state: tauri::State<'_, AppState>) -> StreamConfig {
  println!(
    "[Navio Command] get_stream_config | port={} token_present={}",
    state.stream_port,
    !state.stream_token.is_empty()
  );
  StreamConfig {
    port: state.stream_port,
    token: state.stream_token.clone(),
  }
}

#[tauri::command]
pub async fn inspect_video_tracks(
  path: String,
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, AppState>,
) -> Result<media_tools::TheaterMediaInfo, String> {
  media_tools::inspect_video_tracks(
    &app_handle,
    &state.allowed_directories,
    &state.media_cache,
    path,
  )
  .await
}

#[tauri::command]
pub async fn extract_subtitle_track(
  path: String,
  stream_index: u32,
  request_id: String,
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, AppState>,
) -> Result<String, String> {
  media_tools::extract_subtitle_track(
    &app_handle,
    &state.allowed_directories,
    &state.media_cache,
    path,
    stream_index,
    request_id,
  )
  .await
}

#[tauri::command]
pub async fn extract_audio_track(
  path: String,
  stream_index: u32,
  codec: String,
  request_id: String,
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, AppState>,
) -> Result<String, String> {
  media_tools::extract_audio_track(
    &app_handle,
    &state.allowed_directories,
    &state.media_cache,
    path,
    stream_index,
    codec,
    request_id,
  )
  .await
}

#[tauri::command]
pub async fn cancel_media_preparation(
  request_id: String,
  state: tauri::State<'_, AppState>,
) -> Result<(), String> {
  state.media_cache.cancel_request(&request_id).await;
  Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn save_theater_state(
  path: String,
  duration_secs: f64,
  position_secs: f64,
  audio_stream_index: Option<u32>,
  subtitle_stream_index: Option<u32>,
  subtitle_enabled: bool,
  save_preferences: bool,
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, AppState>,
) -> Result<(), String> {
  media_tools::save_theater_state(
    &app_handle,
    &state.allowed_directories,
    &state.media_cache,
    media_tools::TheaterStateUpdate {
      path,
      duration_secs,
      position_secs,
      audio_stream_index,
      subtitle_stream_index,
      subtitle_enabled,
      save_preferences,
    },
  )
  .await
}

#[tauri::command]
pub fn set_theater_fullscreen(
  app_handle: tauri::AppHandle,
  fullscreen: bool,
) -> Result<bool, String> {
  let window = app_handle
    .get_webview_window("main")
    .ok_or_else(|| "Main window was not found.".to_string())?;

  if fullscreen {
    window.set_decorations(false).map_err(|e| e.to_string())?;
    window.set_resizable(false).map_err(|e| e.to_string())?;
    window.set_fullscreen(true).map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
  } else {
    window.set_fullscreen(false).map_err(|e| e.to_string())?;
    window.set_resizable(true).map_err(|e| e.to_string())?;
    window.set_decorations(false).map_err(|e| e.to_string())?;
  }

  window.is_fullscreen().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_theater_fullscreen(app_handle: tauri::AppHandle) -> Result<bool, String> {
  let window = app_handle
    .get_webview_window("main")
    .ok_or_else(|| "Main window was not found.".to_string())?;
  let next_fullscreen = !window.is_fullscreen().map_err(|e| e.to_string())?;

  set_theater_fullscreen(app_handle, next_fullscreen)
}

/// Tauri command to retrieve the user's media library catalog.
#[tauri::command]
pub fn get_library(app_handle: tauri::AppHandle) -> Result<library::LibraryDb, String> {
  let db = library::load_db(&app_handle)?;
  println!(
    "[Navio Command] get_library | tracks={} playlists={} scanned_dirs={}",
    db.tracks.len(),
    db.playlists.len(),
    db.scanned_directories.len()
  );
  Ok(db)
}

/// Tauri command to save user's media library catalog (tracks, scanned folders, playlists).
#[tauri::command]
pub fn save_library(
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, AppState>,
  db: library::LibraryDb,
) -> Result<(), String> {
  println!(
    "[Navio Command] save_library | tracks={} playlists={} scanned_dirs={}",
    db.tracks.len(),
    db.playlists.len(),
    db.scanned_directories.len()
  );

  // Dynamically unwatch directories that were removed from the catalog
  if let Ok(old_db) = library::load_db(&app_handle) {
    let old_dirs: HashSet<String> = old_db.scanned_directories.into_iter().collect();
    let new_dirs: HashSet<String> = db.scanned_directories.iter().cloned().collect();

    let mut watcher_opt = state.watcher.lock().unwrap();
    if let Some(ref mut watcher) = *watcher_opt {
      use notify::Watcher;
      for dir in old_dirs.difference(&new_dirs) {
        let path = PathBuf::from(dir);
        let _ = watcher.unwatch(&path);
        println!(
          "[Navio Watcher] Unwatched removed library directory: {:?}",
          path
        );
      }
    }
  }

  library::save_db(&app_handle, &db)?;
  println!("[Navio Command] save_library completed");
  Ok(())
}

/// Tauri command to open the Downloads folder inside the system's native file explorer.
#[tauri::command]
pub fn open_folder(app_handle: tauri::AppHandle) -> Result<(), String> {
  println!("[Navio Command] open_folder");

  let download_dir = app_handle
    .path()
    .download_dir()
    .map_err(|e| e.to_string())?
    .join("Navio Player");

  if !download_dir.exists() {
    std::fs::create_dir_all(&download_dir)
      .map_err(|e| format!("Failed to create download folder: {}", e))?;
    println!(
      "[Navio Command] Created downloads folder: {:?}",
      download_dir
    );
  }

  #[cfg(target_os = "windows")]
  {
    std::process::Command::new("explorer")
      .arg(&download_dir)
      .spawn()
      .map_err(|e| e.to_string())?;
  }
  #[cfg(target_os = "macos")]
  {
    std::process::Command::new("open")
      .arg(&download_dir)
      .spawn()
      .map_err(|e| e.to_string())?;
  }
  #[cfg(target_os = "linux")]
  {
    std::process::Command::new("xdg-open")
      .arg(&download_dir)
      .spawn()
      .map_err(|e| e.to_string())?;
  }

  println!("[Navio Command] open_folder launched: {:?}", download_dir);
  Ok(())
}

/// Tauri command to recursively scan a local directory and merge it with the database.
/// Runs the heavy I/O scan in a background thread pool to keep the UI fluid.
#[tauri::command]
pub async fn scan_folder(
  folder_path: String,
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, AppState>,
) -> Result<library::LibraryDb, String> {
  println!("[Navio Command] scan_folder | folder={}", folder_path);

  let path = PathBuf::from(&folder_path);
  if !path.exists() {
    return Err("Selected folder does not exist.".to_string());
  }

  // Authorize this folder path in the streaming server's allowlist
  {
    let mut allowed = state.allowed_directories.lock().unwrap();
    allowed.insert(path.clone());
    println!(
      "[Navio Server] Allowed scanned directory for streaming: {:?}",
      path
    );
  }

  // Register path with directory watcher dynamically
  {
    let mut watcher_opt = state.watcher.lock().unwrap();
    if let Some(ref mut watcher) = *watcher_opt {
      use notify::Watcher;
      let _ = watcher.watch(&path, notify::RecursiveMode::Recursive);
      println!("[Navio Watcher] Watching scanned directory: {:?}", path);
    }
  }

  // Load the current database state
  let mut db = library::load_db(&app_handle)?;

  // Cleanup: Retain only existing tracks currently present on host disk (removes manually deleted files)
  db.tracks.retain(|t| {
    let p = std::path::Path::new(&t.path);
    p.exists()
  });

  // Add the path to the scanned directories catalog if not already present
  let canonical_path = path.to_string_lossy().to_string();
  if !db.scanned_directories.contains(&canonical_path) {
    db.scanned_directories.push(canonical_path);
  }

  // Scan the folder recursively in a blocking worker thread pool to keep UI responsive
  let cache_dir = app_handle
    .path()
    .app_cache_dir()
    .map_err(|e| e.to_string())?;
  let scanned_items = tokio::task::spawn_blocking(move || {
    let allowed_extensions = ["mp3", "m4a", "flac", "ogg", "wav", "mp4", "mkv", "webm"];
    library::scan_dir_recursive(&path, &cache_dir, &allowed_extensions)
  })
  .await
  .map_err(|e| e.to_string())?;
  println!(
    "[Navio Command] scan_folder completed filesystem scan | items={}",
    scanned_items.len()
  );

  // Merge scanned tracks (update metadata if path is already indexed, otherwise append)
  for new_item in scanned_items {
    if let Some(pos) = db.tracks.iter().position(|t| t.path == new_item.path) {
      db.tracks[pos] = new_item;
    } else {
      db.tracks.push(new_item);
    }
  }

  // Write the updated catalog state to disk
  library::save_db(&app_handle, &db)?;
  println!(
    "[Navio Command] scan_folder saved library | tracks={} scanned_dirs={}",
    db.tracks.len(),
    db.scanned_directories.len()
  );

  Ok(db)
}

use super::*;
