use super::*;

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
    media_cache: media_tools::MediaCache::default(),
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

      // Bootstrap phase: restore both independent catalogs before the first
      // renderer request. Library directories authorize indexed files, while
      // playlist directories authorize saved snapshots whose source folder may
      // no longer be part of the library.
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

      if let Ok(db) = playlists::load_db(&app_handle) {
        let restored_dirs =
          playlists::authorize_stream_directories(&db, &state.allowed_directories);
        println!(
          "[Navio App] Restored stream allowlist from playlists | new_dirs={}",
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
      commands::get_stream_port,
      commands::get_stream_config,
      commands::inspect_video_tracks,
      commands::get_video_thumbnail,
      commands::extract_subtitle_track,
      commands::extract_audio_track,
      commands::cancel_media_preparation,
      commands::save_theater_state,
      commands::set_theater_fullscreen,
      commands::toggle_theater_fullscreen,
      commands::get_library,
      commands::save_library,
      commands::get_playlists,
      commands::save_playlists,
      commands::scan_folder,
      downloader::command::start_download,
      downloader::command::check_url_type,
      commands::open_folder
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
