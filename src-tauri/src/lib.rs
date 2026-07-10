mod downloader;
mod library;
mod media_tools;
mod server;
mod watcher;

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Manager, RunEvent};
use tokio::sync::oneshot;

/// Global state managed by the Tauri application.
/// Available to frontend commands via Tauri's State Manager.
pub struct AppState {
  /// Set of directories allowed for file streaming.
  /// Scanned folders are added here to authorize file accesses.
  pub allowed_directories: Arc<Mutex<HashSet<PathBuf>>>,

  /// The port on which our local media streaming server is running.
  pub stream_port: u16,

  /// Per-process token required by media stream URLs.
  pub stream_token: String,

  /// Trigger to gracefully terminate the streaming server when the application exits.
  pub shutdown_tx: Mutex<Option<oneshot::Sender<()>>>,

  /// Reference to the active recommended file watcher.
  pub watcher: Arc<Mutex<Option<notify::RecommendedWatcher>>>,
}

#[derive(serde::Serialize)]
struct StreamConfig {
  port: u16,
  token: String,
}

/// Tauri command to retrieve the active streaming server port.
#[tauri::command]
fn get_stream_port(state: tauri::State<'_, AppState>) -> u16 {
  println!(
    "[Navio Command] get_stream_port | port={}",
    state.stream_port
  );
  state.stream_port
}

/// Tauri command to retrieve the stream server connection config.
#[tauri::command]
fn get_stream_config(state: tauri::State<'_, AppState>) -> StreamConfig {
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
async fn inspect_video_tracks(
  path: String,
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, AppState>,
) -> Result<media_tools::VideoTrackInfo, String> {
  media_tools::inspect_video_tracks(&app_handle, &state.allowed_directories, path).await
}

#[tauri::command]
async fn extract_subtitle_track(
  path: String,
  stream_index: u32,
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, AppState>,
) -> Result<String, String> {
  media_tools::extract_subtitle_track(&app_handle, &state.allowed_directories, path, stream_index)
    .await
}

#[tauri::command]
async fn extract_audio_track(
  path: String,
  stream_index: u32,
  codec: String,
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, AppState>,
) -> Result<String, String> {
  media_tools::extract_audio_track(
    &app_handle,
    &state.allowed_directories,
    path,
    stream_index,
    codec,
  )
  .await
}

#[tauri::command]
fn set_theater_fullscreen(app_handle: tauri::AppHandle, fullscreen: bool) -> Result<bool, String> {
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
fn toggle_theater_fullscreen(app_handle: tauri::AppHandle) -> Result<bool, String> {
  let window = app_handle
    .get_webview_window("main")
    .ok_or_else(|| "Main window was not found.".to_string())?;
  let next_fullscreen = !window.is_fullscreen().map_err(|e| e.to_string())?;

  set_theater_fullscreen(app_handle, next_fullscreen)
}

/// Tauri command to retrieve the user's media library catalog.
#[tauri::command]
fn get_library(app_handle: tauri::AppHandle) -> Result<library::LibraryDb, String> {
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
fn save_library(
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
fn open_folder(app_handle: tauri::AppHandle) -> Result<(), String> {
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
async fn scan_folder(
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

/// Main entrypoint that boots the Tauri application shell.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  println!("[Navio App] Starting application");

  // Create shared directories registry
  let allowed_directories = Arc::new(Mutex::new(HashSet::new()));
  let stream_token = uuid::Uuid::new_v4().to_string();
  println!("[Navio Server] Generated per-run stream token");

  // Setup oneshot channel for server graceful shutdown
  let (shutdown_tx, shutdown_rx) = oneshot::channel();

  let server_state = server::ServerState {
    allowed_directories: allowed_directories.clone(),
    stream_token: stream_token.clone(),
  };

  // Start the server and block until it binds to a dynamic port.
  // We block synchronously during application bootstrap so the port is immediately
  // available when the Tauri window loads and queries it.
  let port =
    tauri::async_runtime::block_on(async { server::start_server(server_state, shutdown_rx).await })
      .expect("Failed to initialize stream server");

  let app_state = AppState {
    allowed_directories,
    stream_port: port,
    stream_token,
    shutdown_tx: Mutex::new(Some(shutdown_tx)),
    watcher: Arc::new(Mutex::new(None)),
  };

  // Build the Tauri application context
  let app = tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .manage(app_state)
    .setup(|app| {
      // In development environments, initialize the logger plugin
      if cfg!(debug_assertions) {
        println!("[Navio App] Installing debug logger plugin");
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Bootstrap Phase: Load previous catalog from disk and authorize directories for streaming.
      // This ensures that previously indexed music/video files are playable immediately on launch.
      let app_handle = app.handle().clone();
      let state = app.state::<AppState>();
      if let Ok(db) = library::load_db(&app_handle) {
        let mut allowed = state.allowed_directories.lock().unwrap();
        let mut restored_dirs = 0;
        for dir in db.scanned_directories {
          allowed.insert(PathBuf::from(dir));
          restored_dirs += 1;
        }
        println!(
          "[Navio App] Restored stream allowlist from library | dirs={}",
          restored_dirs
        );
      }

      // Initialize and start the background filesystem event watcher
      let watcher = watcher::start_watcher(app_handle).expect("Failed to start directory watcher");
      *state.watcher.lock().unwrap() = Some(watcher);
      println!("[Navio Watcher] Watcher started");

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      get_stream_port,
      get_stream_config,
      inspect_video_tracks,
      extract_subtitle_track,
      extract_audio_track,
      set_theater_fullscreen,
      toggle_theater_fullscreen,
      get_library,
      save_library,
      scan_folder,
      downloader::start_download,
      open_folder
    ])
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  // Run the event loop and monitor application lifecycle events
  app.run(|app_handle, event| {
    if let RunEvent::Exit = event {
      println!("[Navio App] Exit event received");
      // The application is exiting. Trigger the graceful shutdown of the Axum server
      // so it frees the dynamic port cleanly.
      let state = app_handle.state::<AppState>();
      let mut tx_opt = state.shutdown_tx.lock().unwrap();
      if let Some(tx) = tx_opt.take() {
        // Send empty tuple to oneshot trigger
        let _ = tx.send(());
      }
    }
  });
}
