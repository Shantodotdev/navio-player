mod library;
mod server;

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

  /// Trigger to gracefully terminate the streaming server when the application exits.
  pub shutdown_tx: Mutex<Option<oneshot::Sender<()>>>,
}

/// Tauri command to retrieve the active streaming server port.
#[tauri::command]
fn get_stream_port(state: tauri::State<'_, AppState>) -> u16 {
  state.stream_port
}

/// Tauri command to retrieve the user's media library catalog.
#[tauri::command]
fn get_library(app_handle: tauri::AppHandle) -> Result<library::LibraryDb, String> {
  library::load_db(&app_handle)
}

/// Tauri command to save user's media library catalog (tracks, scanned folders, playlists).
#[tauri::command]
fn save_library(app_handle: tauri::AppHandle, db: library::LibraryDb) -> Result<(), String> {
  library::save_db(&app_handle, &db)
}

/// Tauri command to recursively scan a local directory and merge it with the database.
/// Runs the heavy I/O scan in a background thread pool to keep the UI fluid.
#[tauri::command]
async fn scan_folder(
  folder_path: String,
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, AppState>,
) -> Result<library::LibraryDb, String> {
  let path = PathBuf::from(&folder_path);
  if !path.exists() {
    return Err("Selected folder does not exist.".to_string());
  }

  // 1. Authorize this folder path in the streaming server's allowlist
  {
    let mut allowed = state.allowed_directories.lock().unwrap();
    allowed.insert(path.clone());
  }

  // 2. Load the current database state
  let mut db = library::load_db(&app_handle)?;

  // Add the path to the scanned directories catalog if not already present
  let canonical_path = path.to_string_lossy().to_string();
  if !db.scanned_directories.contains(&canonical_path) {
    db.scanned_directories.push(canonical_path);
  }

  // 3. Scan the folder recursively in a blocking worker thread pool to keep UI responsive
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

  // 4. Merge scanned tracks (update metadata if path is already indexed, otherwise append)
  for new_item in scanned_items {
    if let Some(pos) = db.tracks.iter().position(|t| t.path == new_item.path) {
      db.tracks[pos] = new_item;
    } else {
      db.tracks.push(new_item);
    }
  }

  // 5. Write the updated catalog state to disk
  library::save_db(&app_handle, &db)?;

  Ok(db)
}

/// Main entrypoint that boots the Tauri application shell.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // Create shared directories registry
  let allowed_directories = Arc::new(Mutex::new(HashSet::new()));

  // Setup oneshot channel for server graceful shutdown
  let (shutdown_tx, shutdown_rx) = oneshot::channel();

  let server_state = server::ServerState {
    allowed_directories: allowed_directories.clone(),
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
    shutdown_tx: Mutex::new(Some(shutdown_tx)),
  };

  // Build the Tauri application context
  let app = tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .manage(app_state)
    .setup(|app| {
      // In development environments, initialize the logger plugin
      if cfg!(debug_assertions) {
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
        for dir in db.scanned_directories {
          allowed.insert(PathBuf::from(dir));
        }
      }

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      get_stream_port,
      get_library,
      save_library,
      scan_folder
    ])
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  // Run the event loop and monitor application lifecycle events
  app.run(|app_handle, event| {
    if let RunEvent::Exit = event {
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
