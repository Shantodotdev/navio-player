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

/// Returns the user's persisted application preferences.
#[tauri::command]
pub fn get_settings(app_handle: tauri::AppHandle) -> Result<settings::Settings, String> {
  settings::load_db(&app_handle)
}

/// Persists the complete validated settings document.
#[tauri::command]
pub fn save_settings(
  app_handle: tauri::AppHandle,
  settings: settings::Settings,
) -> Result<(), String> {
  settings::save_db(&app_handle, &settings)
}

/// Clears the download database and optionally removes only files recorded as completed downloads.
#[tauri::command]
pub fn clear_download_history(
  state: tauri::State<'_, AppState>,
  delete_files: bool,
) -> Result<(), String> {
  if delete_files {
    for job in state.download_manager.list() {
      for path in job.completed_paths {
        let file = std::path::PathBuf::from(path);
        if file.is_file() {
          std::fs::remove_file(file)
            .map_err(|e| format!("Failed to delete downloaded file: {e}"))?;
        }
      }
    }
  }
  state.download_manager.clear_history()
}

/// Resets Navio's databases and managed downloader tools while preserving media and downloads.
#[tauri::command]
pub fn reset_databases(
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, AppState>,
) -> Result<(), String> {
  state.download_manager.clear_history()?;
  settings::reset_databases(&app_handle)?;
  state.allowed_directories.lock().unwrap().clear();
  Ok(())
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

/// Enters or leaves native fullscreen with a single Windows window transition.
///
/// TAO clamps maximized frameless windows to the taskbar-excluding work area.
/// A maximized window temporarily needs TAO's native decoration marker to
/// calculate against the complete monitor. Restored windows skip that workaround,
/// and the marker is removed before fullscreen exit so no titlebar frame is painted.
#[tauri::command]
pub fn set_theater_fullscreen(
  app_handle: tauri::AppHandle,
  fullscreen: bool,
) -> Result<bool, String> {
  let window = app_handle
    .get_webview_window("main")
    .ok_or_else(|| "Main window was not found.".to_string())?;

  let is_fullscreen = window.is_fullscreen().map_err(|e| e.to_string())?;
  if fullscreen == is_fullscreen {
    return Ok(is_fullscreen);
  }

  if fullscreen {
    if window.is_maximized().map_err(|e| e.to_string())? {
      window.set_decorations(true).map_err(|e| e.to_string())?;
    }
    window.set_fullscreen(true).map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
  } else {
    window.set_decorations(false).map_err(|e| e.to_string())?;
    window.set_fullscreen(false).map_err(|e| e.to_string())?;
  }

  window.is_fullscreen().map_err(|e| e.to_string())
}

/// Toggles theater fullscreen using the same state-preserving transition.
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

/// Waits for the next authenticated MCP request assigned to the renderer.
///
/// This long-poll command is called by the root React control hook. The bounded
/// broker, rather than the WebView, owns ordering and correlation state.
#[tauri::command]
pub async fn wait_for_mcp_command(
  state: tauri::State<'_, AppState>,
) -> Result<control::PendingControlRequest, String> {
  state
    .control_broker
    .next()
    .await
    .ok_or_else(|| "Navio's agent control channel is closed.".to_string())
}

/// Completes one pending MCP request with the renderer-produced response envelope.
///
/// The textual request ID is parsed as a UUID before broker access. Unknown,
/// expired, and already-completed IDs fail instead of being silently discarded.
#[tauri::command]
pub async fn complete_mcp_command(
  id: String,
  success: bool,
  message: Option<String>,
  data: Option<serde_json::Value>,
  state: tauri::State<'_, AppState>,
) -> Result<(), String> {
  let id =
    uuid::Uuid::parse_str(&id).map_err(|_| "Agent control request ID is invalid.".to_string())?;
  let reply = control::ControlReply {
    success,
    message,
    data,
  };
  state.control_broker.complete(id, reply).await
}

/// Converts one completed download into media metadata after path authorization.
///
/// The renderer supplies a downloader-produced path, but Rust still canonicalizes
/// and checks it against Navio's streaming allowlist before reading metadata.
#[tauri::command]
pub fn inspect_authorized_media_file(
  path: String,
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, AppState>,
) -> Result<library::MediaItem, String> {
  let cache_dir = app_handle
    .path()
    .app_cache_dir()
    .map_err(|error| error.to_string())?;
  inspect_authorized_media_file_impl(&path, &cache_dir, &state.allowed_directories)
}

/// Canonicalizes and inspects one file without widening the streaming boundary.
///
/// Directory membership is checked using resolved paths, preventing `..`, links,
/// or sibling-prefix tricks from turning MCP autoplay into arbitrary file access.
/// Only extensions already supported by Navio's media scanner can be returned.
fn inspect_authorized_media_file_impl(
  path: &str,
  app_cache_dir: &std::path::Path,
  allowed_directories: &Arc<Mutex<HashSet<PathBuf>>>,
) -> Result<library::MediaItem, String> {
  let requested = PathBuf::from(path);
  if !requested.is_file() {
    return Err("Media file does not exist.".to_string());
  }
  let canonical = requested
    .canonicalize()
    .map_err(|_| "Media file could not be resolved.".to_string())?;
  let allowed = allowed_directories
    .lock()
    .map_err(|_| "Navio's media authorization state is unavailable.".to_string())?;
  let is_allowed = allowed.iter().any(|directory| {
    directory
      .canonicalize()
      .map(|resolved| canonical.starts_with(resolved))
      .unwrap_or(false)
  });
  drop(allowed);
  if !is_allowed {
    return Err("Media file is outside Navio's authorized directories.".to_string());
  }

  library::process_media_file(&canonical, app_cache_dir)
    .ok_or_else(|| "File is not a supported Navio media type.".to_string())
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

  let download_dir = settings::load_db(&app_handle)?
    .downloads
    .folder
    .map(std::path::PathBuf::from)
    .unwrap_or(
      app_handle
        .path()
        .download_dir()
        .map_err(|e| e.to_string())?
        .join("Navio Player"),
    );

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

#[cfg(test)]
mod mcp_control_tests {
  use super::*;
  use std::{
    collections::HashSet,
    fs,
    sync::{Arc, Mutex},
  };

  /// Creates an isolated temporary root for authorized-media boundary tests.
  fn test_directory(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("navio-control-{name}-{}", uuid::Uuid::new_v4()))
  }

  #[test]
  /// Verifies authorized media is inspectable while a sibling file is rejected.
  fn authorized_media_inspection_stays_inside_the_allowlist() {
    let root = test_directory("allowed");
    let allowed_dir = root.join("media");
    let cache_dir = root.join("cache");
    fs::create_dir_all(&allowed_dir).expect("create media directory");
    fs::create_dir_all(&cache_dir).expect("create cache directory");
    let allowed_file = allowed_dir.join("track.mp3");
    let sibling_file = root.join("outside.mp3");
    fs::write(&allowed_file, b"not-real-audio").expect("write allowed fixture");
    fs::write(&sibling_file, b"not-real-audio").expect("write sibling fixture");
    let allowed = Arc::new(Mutex::new(HashSet::from([allowed_dir
      .canonicalize()
      .expect("canonical allowed directory")])));

    let media = inspect_authorized_media_file_impl(
      allowed_file.to_string_lossy().as_ref(),
      &cache_dir,
      &allowed,
    )
    .expect("inspect allowed media");
    assert_eq!(media.media_type, "audio");
    assert_eq!(media.name, "track.mp3");

    assert_eq!(
      inspect_authorized_media_file_impl(
        sibling_file.to_string_lossy().as_ref(),
        &cache_dir,
        &allowed,
      )
      .expect_err("sibling path must be rejected"),
      "Media file is outside Navio's authorized directories."
    );
    fs::remove_dir_all(root).expect("cleanup fixture");
  }

  #[test]
  /// Verifies missing paths and unsupported extensions fail with stable messages.
  fn authorized_media_inspection_rejects_missing_and_unsupported_files() {
    let root = test_directory("invalid");
    let cache_dir = root.join("cache");
    fs::create_dir_all(&cache_dir).expect("create cache directory");
    let unsupported = root.join("notes.txt");
    fs::write(&unsupported, b"not media").expect("write unsupported fixture");
    let allowed = Arc::new(Mutex::new(HashSet::from([root
      .canonicalize()
      .expect("canonical root")])));

    assert_eq!(
      inspect_authorized_media_file_impl(
        root.join("missing.mp3").to_string_lossy().as_ref(),
        &cache_dir,
        &allowed,
      )
      .expect_err("missing path must fail"),
      "Media file does not exist."
    );
    assert_eq!(
      inspect_authorized_media_file_impl(
        unsupported.to_string_lossy().as_ref(),
        &cache_dir,
        &allowed,
      )
      .expect_err("unsupported path must fail"),
      "File is not a supported Navio media type."
    );
    fs::remove_dir_all(root).expect("cleanup fixture");
  }
}
