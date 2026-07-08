mod server;

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;
use tauri::{Manager, RunEvent};

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
///
/// # Arguments
/// * `state` - The managed application state.
///
/// # Returns
/// The TCP port number.
#[tauri::command]
fn get_stream_port(state: tauri::State<'_, AppState>) -> u16 {
  state.stream_port
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
  let port = tauri::async_runtime::block_on(async {
    server::start_server(server_state, shutdown_rx).await
  }).expect("Failed to initialize stream server");

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
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![get_stream_port])
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
