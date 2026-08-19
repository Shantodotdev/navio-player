//! Navio desktop application bootstrap, capability wiring, and shutdown hooks.
//!
//! Startup creates the local streaming server before the WebView loads, restores
//! filesystem authorization from persisted library data, starts the filesystem
//! watcher, and registers every Tauri command. Downloader recovery is part of
//! this bootstrap sequence: active records from an earlier process are marked
//! interrupted before the renderer can display them, while cancelled staging
//! directories are cleaned without touching completed media.
//!
//! Shutdown follows the inverse responsibility order. It first persists active
//! download records as interrupted, then signals the local stream server. A
//! forced OS termination may bypass this hook, which is why the downloader also
//! performs the same recovery check at the next startup.

use super::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  println!("[Navio App] Starting application");

  // Windows passes the selected file after the executable path when a user
  // chooses "Open with Navio Player". Keep those paths until the renderer is
  // ready to validate them and start playback.
  let pending_open_paths = std::env::args_os()
    .skip(1)
    .filter_map(|argument| argument.into_string().ok())
    .filter(|argument| !argument.starts_with('-'))
    .collect::<Vec<_>>();

  // Create shared directories registry
  let allowed_directories = Arc::new(Mutex::new(HashSet::new()));
  let stream_token = uuid::Uuid::new_v4().to_string();
  let control_token = uuid::Uuid::new_v4().to_string();
  let control_broker = control::ControlBroker::new(32);
  let connect_hub_slot = Arc::new(std::sync::RwLock::new(None));
  println!("[Navio Server] Generated per-run stream token");

  // Setup oneshot channel for server graceful shutdown
  let (shutdown_tx, shutdown_rx) = oneshot::channel();

  let server_state = server::ServerState {
    allowed_directories: allowed_directories.clone(),
    stream_token: stream_token.clone(),
    control_token: control_token.clone(),
    control_broker: control_broker.clone(),
    connect_hub: connect_hub_slot.clone(),
  };

  // Start the server and block until it binds to a dynamic port.
  // We block synchronously during application bootstrap so the port is immediately
  // available when the Tauri window loads and queries it.
  let port =
    tauri::async_runtime::block_on(async { server::start_server(server_state, shutdown_rx).await })
      .expect("Failed to initialize stream server");

  let connect_hub_ref = connect_hub_slot.clone();

  // Build the Tauri application context
  let app = tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .setup(move |app| {
      let app_handle = app.handle().clone();
      let download_manager = downloader::DownloadManager::load(&app_handle)?;
      let activity_store = activity::ActivityStore::load(&app_handle)?;
      let connect_hub = connect::ConnectHub::new(app_handle.clone(), port);
      let connect_client = connect::ConnectClientManager::new(app_handle.clone());
      *connect_hub_ref.write().unwrap() = Some(connect_hub.clone());

      // A process handle cannot survive a restart. Convert durable active jobs
      // before the renderer requests the queue so users can retry honestly.
      download_manager.recover_interrupted()?;
      // If the OS stopped Navio immediately after Cancel, this completes the
      // promised destructive cleanup before the job history is displayed.
      download_manager.cleanup_cancelled_staging(&app_handle)?;
      let app_state = AppState {
        download_manager,
        activity_store,
        library_scan: library::ScanCoordinator::default(),
        library_config_lock: tokio::sync::Mutex::new(()),
        allowed_directories: allowed_directories.clone(),
        stream_port: port,
        stream_token: stream_token.clone(),
        shutdown_tx: Mutex::new(Some(shutdown_tx)),
        watcher: Arc::new(Mutex::new(None)),
        media_cache: media_tools::MediaCache::default(),
        control_broker: control_broker.clone(),
        connect_hub: connect_hub.clone(),
        connect_client,
        pending_open_paths: Mutex::new(pending_open_paths),
      };
      if !app.manage(app_state) {
        return Err("Failed to register application state.".into());
      }
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
      let watcher =
        watcher::start_watcher(app_handle.clone()).expect("Failed to start directory watcher");
      *state.watcher.lock().unwrap() = Some(watcher);
      println!("[Navio Watcher] Watcher started");
      commands::start_background_library_reconcile(app_handle);

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::get_stream_port,
      commands::get_stream_config,
      commands::get_settings,
      commands::save_settings,
      commands::record_playback_milestone,
      commands::clear_download_history,
      commands::reset_databases,
      commands::inspect_video_tracks,
      commands::get_video_thumbnail,
      commands::extract_subtitle_track,
      commands::extract_audio_track,
      commands::cancel_media_preparation,
      commands::save_theater_state,
      commands::set_theater_fullscreen,
      commands::toggle_theater_fullscreen,
      commands::get_library,
      commands::get_library_scan_status,
      commands::cancel_library_scan,
      commands::rebuild_library_index,
      commands::wait_for_mcp_command,
      commands::complete_mcp_command,
      commands::inspect_authorized_media_file,
      commands::take_opened_media_paths,
      commands::inspect_opened_media_file,
      commands::save_library,
      commands::get_playlists,
      commands::save_playlists,
      commands::scan_folder,
      downloader::command::start_download,
      downloader::command::resume_download,
      downloader::command::pause_download,
      downloader::command::cancel_download,
      downloader::command::get_downloads,
      downloader::command::remove_download,
      downloader::inspection::inspect_download_url,
      commands::open_folder,
      connect::commands::connect_get_local_device,
      connect::commands::connect_get_discovered_peers,
      connect::commands::connect_get_paired_devices,
      connect::commands::connect_generate_pairing_pin,
      connect::commands::connect_get_active_pin,
      connect::commands::connect_update_device_permissions,
      connect::commands::connect_revoke_device,
      connect::commands::connect_broadcast_playback_state,
      connect::commands::connect_pair_with_peer,
      connect::commands::connect_connect_to_peer,
      connect::commands::connect_send_remote_command,
      connect::commands::connect_disconnect_remote,
      connect::commands::connect_get_active_remote_host,
    ])
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  let descriptor = control::RuntimeDescriptor::new(port, control_token);
  if let Err(error) = control::write_runtime_descriptor(&descriptor) {
    eprintln!("[Navio Control] failed to publish runtime descriptor: {error}");
  }

  // Run the event loop and monitor application lifecycle events
  app.run(|app_handle, event| {
    if let RunEvent::Exit = event {
      println!("[Navio App] Exit event received");
      // The application is exiting. Trigger the graceful shutdown of the Axum server
      // so it frees the dynamic port cleanly.
      let state = app_handle.state::<AppState>();
      if let Err(error) = state.download_manager.recover_interrupted() {
        // Persisting interruption is best-effort during shutdown; `kill_on_drop`
        // and the startup recovery path still cover forced process termination.
        eprintln!("[Navio Downloader] failed to persist interrupted downloads on exit: {error}");
      }
      let mut tx_opt = state.shutdown_tx.lock().unwrap();
      if let Some(tx) = tx_opt.take() {
        // Send empty tuple to oneshot trigger
        let _ = tx.send(());
      }
      state.connect_hub.shutdown();
      control::remove_runtime_descriptor(std::process::id());
    }
  });
}
