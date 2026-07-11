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

/// Returns a cached still image for an authorized library video.
#[tauri::command]
pub async fn get_video_thumbnail(
  path: String,
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, AppState>,
) -> Result<String, String> {
  media_tools::get_video_thumbnail(&app_handle, &state.allowed_directories, path).await
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

/// Retrieves a live media view assembled from the currently configured folders.
#[tauri::command]
pub async fn get_library(app_handle: tauri::AppHandle) -> Result<library::LibraryView, String> {
  let db = library::load_db(&app_handle)?;
  let cache_dir = app_handle
    .path()
    .app_cache_dir()
    .map_err(|e| e.to_string())?;
  let view = tokio::task::spawn_blocking(move || library::build_library_view(&db, &cache_dir))
    .await
    .map_err(|e| e.to_string())?;
  println!(
    "[Navio Command] get_library | tracks={} scanned_dirs={}",
    view.tracks.len(),
    view.scanned_directories.len()
  );
  Ok(view)
}

/// Retrieves the independent playlist catalog from AppData.
///
/// This command is separate from `get_library` so a library refresh cannot
/// accidentally replace playlist snapshots with library-derived records.
#[tauri::command]
pub fn get_playlists(app_handle: tauri::AppHandle) -> Result<playlists::PlaylistsDb, String> {
  let db = playlists::load_db(&app_handle)?;
  println!(
    "[Navio Command] get_playlists | playlists={} tracks={}",
    db.playlists.len(),
    db.playlists
      .iter()
      .map(|playlist| playlist.tracks.len())
      .sum::<usize>()
  );
  Ok(db)
}

/// Saves the independent playlist catalog and authorizes existing playlist
/// media directories.
///
/// Persistence is completed before the allowlist is updated. If validation or
/// writing fails, the in-memory stream boundary is left unchanged and the
/// frontend can keep its previous playlist state.
#[tauri::command]
pub fn save_playlists(
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, AppState>,
  db: playlists::PlaylistsDb,
) -> Result<(), String> {
  // `save_db` validates the complete replacement document before writing it.
  // The same validated document is then used to update stream authorization,
  // avoiding a mismatch between what is persisted and what can be streamed.
  playlists::save_db(&app_handle, &db)?;
  let authorized = playlists::authorize_stream_directories(&db, &state.allowed_directories);
  println!(
    "[Navio Command] save_playlists | playlists={} new_stream_dirs={}",
    db.playlists.len(),
    authorized
  );
  Ok(())
}

/// Tauri command to save the user's scanned-folder configuration.
#[tauri::command]
pub fn save_library(
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, AppState>,
  db: library::LibraryDb,
) -> Result<(), String> {
  println!(
    "[Navio Command] save_library | scanned_dirs={}",
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
  let playlist_directories = playlists::load_db(&app_handle)
    .ok()
    .map(|playlist_db| {
      playlist_db
        .playlists
        .iter()
        .flat_map(|playlist| playlist.tracks.iter())
        .filter_map(|track| PathBuf::from(&track.path).parent().map(PathBuf::from))
        .filter_map(|directory| directory.canonicalize().ok())
        .collect::<HashSet<_>>()
    })
    .unwrap_or_default();
  let app_cache_dir = app_handle.path().app_cache_dir().ok();
  {
    let mut allowed = state.allowed_directories.lock().unwrap();
    allowed.retain(|directory| {
      let is_library_directory = db
        .scanned_directories
        .iter()
        .map(PathBuf::from)
        .any(|configured| directory == &configured);
      let is_playlist_directory = playlist_directories.contains(directory);
      let is_app_cache = app_cache_dir
        .as_ref()
        .map(|cache| directory.starts_with(cache))
        .unwrap_or(false);

      is_library_directory || is_playlist_directory || is_app_cache
    });
    allowed.extend(db.scanned_directories.iter().map(PathBuf::from));
  }
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

/// Tauri command to add a local directory and return the complete live library view.
/// Runs the heavy I/O scan in a background thread pool to keep the UI fluid.
#[tauri::command]
pub async fn scan_folder(
  folder_path: String,
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, AppState>,
) -> Result<library::LibraryView, String> {
  println!("[Navio Command] scan_folder | folder={}", folder_path);

  let path = PathBuf::from(&folder_path);
  if !path.is_dir() {
    return Err("Selected folder does not exist.".to_string());
  }
  let canonical_path = path
    .canonicalize()
    .map_err(|e| format!("Could not resolve selected folder: {}", e))?;

  // Authorize this folder path in the streaming server's allowlist
  {
    let mut allowed = state.allowed_directories.lock().unwrap();
    allowed.insert(canonical_path.clone());
    println!(
      "[Navio Server] Allowed scanned directory for streaming: {:?}",
      canonical_path
    );
  }

  // Register path with directory watcher dynamically
  {
    let mut watcher_opt = state.watcher.lock().unwrap();
    if let Some(ref mut watcher) = *watcher_opt {
      use notify::Watcher;
      let _ = watcher.watch(&canonical_path, notify::RecursiveMode::Recursive);
      println!(
        "[Navio Watcher] Watching scanned directory: {:?}",
        canonical_path
      );
    }
  }

  // Load the current database state
  let mut db = library::load_db(&app_handle)?;

  // Add the path to the scanned directories catalog if not already present
  let canonical_path = canonical_path.to_string_lossy().to_string();
  if !db.scanned_directories.contains(&canonical_path) {
    db.scanned_directories.push(canonical_path);
  }

  // Persist only folder configuration; media membership is always derived from disk.
  library::save_db(&app_handle, &db)?;
  let cache_dir = app_handle
    .path()
    .app_cache_dir()
    .map_err(|e| e.to_string())?;
  let view = tokio::task::spawn_blocking(move || library::build_library_view(&db, &cache_dir))
    .await
    .map_err(|e| e.to_string())?;
  println!(
    "[Navio Command] scan_folder returned live view | tracks={} scanned_dirs={}",
    view.tracks.len(),
    view.scanned_directories.len()
  );

  Ok(view)
}

use super::*;
