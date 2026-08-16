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
pub async fn reset_databases(
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, AppState>,
) -> Result<(), String> {
  if state.library_scan.has_active_jobs() {
    return Err("Cancel active library scans before resetting Navio.".to_string());
  }
  state.download_manager.clear_history()?;
  settings::reset_databases(&app_handle)?;
  state.activity_store.reset().await?;
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
  let activity_path = PathBuf::from(&path)
    .canonicalize()
    .map_err(|error| format!("Could not resolve the selected video: {error}"))?;
  let activity_id = library::stable_media_id(&activity_path);
  let activity_path_string = activity_path.to_string_lossy().to_string();
  let retained_position = if duration_secs >= 10.0 * 60.0 {
    position_secs.max(0.0)
  } else {
    0.0
  };
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
  .await?;

  match state
    .activity_store
    .record_progress(
      &activity_id,
      &activity_path_string,
      retained_position,
      duration_secs,
    )
    .await
  {
    Ok(entry) => {
      if let Err(error) = app_handle.emit("activity-updated", entry) {
        log::warn!("Could not emit activity progress update: {error}");
      }
    }
    Err(error) => log::warn!("Could not persist activity progress: {error}"),
  }
  Ok(())
}

/// Enters or leaves native fullscreen while preserving each platform's window chrome.
///
/// TAO clamps maximized frameless windows to the taskbar-excluding work area.
/// A maximized window temporarily needs TAO's native decoration marker to
/// calculate against the complete monitor. Restored windows skip that workaround,
/// and the marker is removed before fullscreen exit so no titlebar frame is painted.
/// macOS and Linux keep their native decorations and do not need this workaround.
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
    #[cfg(windows)]
    {
      if window.is_maximized().map_err(|e| e.to_string())? {
        window.set_decorations(true).map_err(|e| e.to_string())?;
      }
    }
    window.set_fullscreen(true).map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
  } else {
    #[cfg(windows)]
    {
      window.set_decorations(false).map_err(|e| e.to_string())?;
    }
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

/// Live library data joined with the current activity snapshot.
#[derive(serde::Serialize)]
pub struct LibraryResponse {
  pub scanned_directories: Vec<String>,
  pub tracks: Vec<library::MediaItem>,
  pub activity: std::collections::HashMap<String, activity::ActivityEntry>,
}

/// Converts one live library track into the activity reconciliation contract.
fn activity_media_from_track(track: &library::MediaItem) -> activity::ActivityMedia {
  activity::ActivityMedia {
    id: track.id.clone(),
    path: track.path.clone(),
    duration_secs: track.duration_secs,
    media_type: track.media_type.clone(),
  }
}

/// Joins a scanned live library with its reconciled local activity records.
async fn join_library_activity(
  state: &AppState,
  view: library::LibraryView,
) -> Result<LibraryResponse, String> {
  let media = view
    .tracks
    .iter()
    .map(activity_media_from_track)
    .collect::<Vec<_>>();
  // A configured library can briefly have an empty cache during first index
  // migration. Do not mark that placeholder as the user's initial catalog or
  // every existing file would later appear as newly added.
  let activity = if view.tracks.is_empty() && !view.scanned_directories.is_empty() {
    state.activity_store.snapshot().await
  } else {
    state.activity_store.reconcile(&media).await?
  };
  Ok(LibraryResponse {
    scanned_directories: view.scanned_directories,
    tracks: view.tracks,
    activity,
  })
}

/// Builds a renderer view entirely from the persistent index.
fn cached_library_view(
  db: &library::LibraryDb,
  index: &library::LibraryIndex,
) -> Result<library::LibraryView, String> {
  Ok(library::LibraryView {
    scanned_directories: db.scanned_directories.clone(),
    tracks: index.load_all()?,
  })
}

/// Adds one normalized configured root unless its canonical identity already exists.
fn add_directory_if_missing(db: &mut library::LibraryDb, directory: &std::path::Path) -> bool {
  let key = library::path_key(directory);
  if db
    .scanned_directories
    .iter()
    .map(PathBuf::from)
    .any(|configured| library::path_key(&configured) == key)
  {
    return false;
  }
  db.scanned_directories
    .push(library::display_path(directory));
  true
}

/// Runs one exclusive scan job without blocking the async command runtime.
async fn run_index_scan(
  app_handle: &tauri::AppHandle,
  roots: Vec<PathBuf>,
) -> Result<bool, String> {
  if roots.is_empty() {
    return Ok(true);
  }
  let state = app_handle.state::<AppState>();
  let coordinator = state.library_scan.clone();
  let exclusions = settings::load_db(app_handle)?.library.excluded_folder_names;
  let label = if roots.len() == 1 {
    library::display_path(&roots[0])
  } else {
    "Library".to_string()
  };
  let job = coordinator.begin(label)?;
  if let Some(progress) = coordinator
    .statuses()
    .into_iter()
    .find(|progress| progress.job_id == job.id())
  {
    app_handle
      .emit("library-scan-progress", progress)
      .map_err(|error| error.to_string())?;
  }

  let scan_app = app_handle.clone();
  let scan_coordinator = coordinator.clone();
  let scan_job = job.clone();
  let result = tokio::task::spawn_blocking(move || {
    library::run_scan_roots(&scan_app, &scan_coordinator, &scan_job, &roots, &exclusions)
  })
  .await
  .map_err(|error| format!("Library scan task failed: {error}"));

  match result {
    Ok(Ok(outcome)) => {
      let cancelled = outcome.cancelled;
      library::finish_scan(
        app_handle,
        &coordinator,
        &job,
        if cancelled {
          library::LibraryScanPhase::Cancelled
        } else {
          library::LibraryScanPhase::Completed
        },
        None,
      );
      Ok(!cancelled)
    }
    Ok(Err(error)) => {
      library::finish_scan(
        app_handle,
        &coordinator,
        &job,
        library::LibraryScanPhase::Failed,
        Some(error.clone()),
      );
      Err(error)
    }
    Err(error) => {
      library::finish_scan(
        app_handle,
        &coordinator,
        &job,
        library::LibraryScanPhase::Failed,
        Some(error.clone()),
      );
      Err(error)
    }
  }
}

/// Runs independent root jobs concurrently while Rayon's global pool bounds probing.
async fn run_index_scans(
  app_handle: &tauri::AppHandle,
  roots: Vec<PathBuf>,
) -> Result<bool, String> {
  let mut jobs = tokio::task::JoinSet::new();
  for root in roots {
    let scan_app = app_handle.clone();
    jobs.spawn(async move { run_index_scan(&scan_app, vec![root]).await });
  }

  let mut all_completed = true;
  let mut first_error = None;
  while let Some(result) = jobs.join_next().await {
    match result {
      Ok(Ok(completed)) => all_completed &= completed,
      Ok(Err(error)) => {
        if first_error.is_none() {
          first_error = Some(error);
        }
      }
      Err(error) => {
        if first_error.is_none() {
          first_error = Some(format!("Library scan task failed: {error}"));
        }
      }
    }
  }
  first_error.map_or(Ok(all_completed), Err)
}

/// Starts a non-blocking startup reconciliation using the current cached index.
pub fn start_background_library_reconcile(app_handle: tauri::AppHandle) {
  tauri::async_runtime::spawn(async move {
    let roots = match library::load_db(&app_handle) {
      Ok(db) => db
        .scanned_directories
        .into_iter()
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
        .collect::<Vec<_>>(),
      Err(error) => {
        log::error!("Could not load folders for startup reconciliation: {error}");
        return;
      }
    };
    if roots.is_empty() {
      return;
    }
    match run_index_scans(&app_handle, roots).await {
      Ok(_) => {
        if let Err(error) = app_handle.emit("library-updated", ()) {
          log::error!("Could not publish reconciled library: {error}");
        }
      }
      Err(error) => log::error!("Background library reconciliation failed: {error}"),
    }
  });
}

/// Retrieves the cached media view without recursively scanning configured folders.
#[tauri::command]
pub async fn get_library(
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, AppState>,
) -> Result<LibraryResponse, String> {
  let db = library::load_db(&app_handle)?;
  let index = library::LibraryIndex::open_for_app(&app_handle)?;
  let view = cached_library_view(&db, &index)?;
  println!(
    "[Navio Command] get_library cached | tracks={} scanned_dirs={}",
    view.tracks.len(),
    view.scanned_directories.len()
  );
  join_library_activity(&state, view).await
}

/// Returns the active scan snapshot so a newly mounted renderer can reconcile state.
#[tauri::command]
pub fn get_library_scan_status(
  state: tauri::State<'_, AppState>,
) -> Vec<library::LibraryScanProgress> {
  state.library_scan.statuses()
}

/// Cooperatively cancels one folder or background reconciliation scan.
#[tauri::command]
pub fn cancel_library_scan(
  job_id: String,
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
  let cancelled = state.library_scan.cancel(&job_id);
  if cancelled {
    if let Some(progress) = state
      .library_scan
      .statuses()
      .into_iter()
      .find(|progress| progress.job_id == job_id)
    {
      app_handle
        .emit("library-scan-progress", progress)
        .map_err(|error| error.to_string())?;
    }
  }
  Ok(cancelled)
}

/// Reconciles every configured root using the current exclusion settings.
#[tauri::command]
pub async fn rebuild_library_index(
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, AppState>,
) -> Result<LibraryResponse, String> {
  let db = library::load_db(&app_handle)?;
  let roots = db
    .scanned_directories
    .iter()
    .map(PathBuf::from)
    .filter(|path| path.is_dir())
    .collect::<Vec<_>>();
  run_index_scans(&app_handle, roots).await?;
  app_handle
    .emit("library-updated", ())
    .map_err(|error| error.to_string())?;
  let index = library::LibraryIndex::open_for_app(&app_handle)?;
  join_library_activity(&state, cached_library_view(&db, &index)?).await
}

/// Records one validated meaningful-playback milestone and returns its new activity state.
#[tauri::command]
pub async fn record_playback_milestone(
  media_id: String,
  path: String,
  milestone: activity::PlaybackMilestone,
  state: tauri::State<'_, AppState>,
) -> Result<activity::ActivityEntry, String> {
  let media_path = PathBuf::from(path);
  if !media_path.is_file() {
    return Err("The selected media no longer exists.".to_string());
  }
  let canonical_path = media_path
    .canonicalize()
    .map_err(|error| format!("Could not resolve selected media: {error}"))?;
  let is_allowed = state
    .allowed_directories
    .lock()
    .unwrap()
    .iter()
    .any(|directory| {
      directory
        .canonicalize()
        .map(|allowed| canonical_path.starts_with(allowed))
        .unwrap_or(false)
    });
  if !is_allowed {
    return Err("The selected media is outside your Navio library.".to_string());
  }
  let stable_id = library::stable_media_id(&canonical_path);
  if stable_id != media_id {
    return Err("The media identity does not match its validated path.".to_string());
  }

  state
    .activity_store
    .record_milestone(
      &stable_id,
      canonical_path.to_string_lossy().as_ref(),
      milestone,
    )
    .await
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

/// Returns and clears media paths supplied by the operating system at launch.
///
/// The queue is consumed exactly once by the renderer so a reload does not
/// unexpectedly replay the file that started Navio.
#[tauri::command]
pub fn take_opened_media_paths(state: tauri::State<'_, AppState>) -> Vec<String> {
  state
    .pending_open_paths
    .lock()
    .map(|mut paths| std::mem::take(&mut *paths))
    .unwrap_or_default()
}

/// Validates one operating-system-opened media file and authorizes its parent
/// directory for the existing local streaming server.
///
/// Opening a file from Explorer is an explicit user action, so the file does
/// not need to already belong to a scanned library folder. The directory is
/// authorized only for this process and is not persisted as a library folder.
#[tauri::command]
pub fn inspect_opened_media_file(
  path: String,
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, AppState>,
) -> Result<library::MediaItem, String> {
  let requested = PathBuf::from(path);
  if !requested.is_file() {
    return Err("The selected media file does not exist.".to_string());
  }
  let canonical = requested
    .canonicalize()
    .map_err(|error| format!("Could not resolve the selected media file: {error}"))?;
  let cache_dir = app_handle
    .path()
    .app_cache_dir()
    .map_err(|error| error.to_string())?;
  let media = library::process_media_file(&canonical, &cache_dir)
    .ok_or_else(|| "File is not a supported Navio media type.".to_string())?;
  let parent = canonical
    .parent()
    .ok_or_else(|| "The selected media file has no parent directory.".to_string())?;
  state
    .allowed_directories
    .lock()
    .map_err(|_| "Navio's media authorization state is unavailable.".to_string())?
    .insert(parent.to_path_buf());
  Ok(media)
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
pub async fn save_library(
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, AppState>,
  mut db: library::LibraryDb,
) -> Result<(), String> {
  let _configuration_guard = state.library_config_lock.lock().await;
  db.normalize_directories();
  println!(
    "[Navio Command] save_library | scanned_dirs={}",
    db.scanned_directories.len()
  );

  // Dynamically unwatch directories that were removed from the catalog
  let old_db = library::load_db(&app_handle).unwrap_or_default();
  let old_dirs = old_db
    .scanned_directories
    .iter()
    .map(|directory| {
      (
        library::path_key(&PathBuf::from(directory)),
        directory.clone(),
      )
    })
    .collect::<std::collections::HashMap<_, _>>();
  let new_dir_keys = db
    .scanned_directories
    .iter()
    .map(|directory| library::path_key(&PathBuf::from(directory)))
    .collect::<HashSet<_>>();
  for progress in state.library_scan.statuses() {
    let root_key = library::path_key(&PathBuf::from(&progress.root));
    if old_dirs.contains_key(&root_key) && !new_dir_keys.contains(&root_key) {
      state.library_scan.cancel(&progress.job_id);
    }
  }

  {
    let mut watcher_opt = state.watcher.lock().unwrap();
    if let Some(ref mut watcher) = *watcher_opt {
      use notify::Watcher;
      for (key, dir) in &old_dirs {
        if new_dir_keys.contains(key) {
          continue;
        }
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
  let mut index = library::LibraryIndex::open_for_app(&app_handle)?;
  for key in old_dirs.keys() {
    if !new_dir_keys.contains(key) {
      index.remove_root(key)?;
    }
  }
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
        .any(|configured| library::path_key(directory) == library::path_key(&configured));
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

/// Scans only one selected root and publishes it to the persistent index.
#[tauri::command]
pub async fn scan_folder(
  folder_path: String,
  app_handle: tauri::AppHandle,
  state: tauri::State<'_, AppState>,
) -> Result<LibraryResponse, String> {
  println!("[Navio Command] scan_folder | folder={}", folder_path);

  let canonical_path =
    library::normalize_existing_directory(PathBuf::from(&folder_path).as_path())?;
  let db = {
    // Reload while holding the short configuration lock so simultaneous
    // selections merge instead of replacing one another's folder.
    let _configuration_guard = state.library_config_lock.lock().await;
    let mut db = library::load_db(&app_handle)?;
    if !add_directory_if_missing(&mut db, &canonical_path) {
      let index = library::LibraryIndex::open_for_app(&app_handle)?;
      return join_library_activity(&state, cached_library_view(&db, &index)?).await;
    }
    library::save_db(&app_handle, &db)?;
    db
  };
  state
    .allowed_directories
    .lock()
    .unwrap()
    .insert(canonical_path.clone());
  {
    let mut watcher = state.watcher.lock().unwrap();
    if let Some(watcher) = watcher.as_mut() {
      use notify::Watcher;
      watcher
        .watch(&canonical_path, notify::RecursiveMode::Recursive)
        .unwrap_or_else(|error| {
          log::warn!("Could not watch selected folder before indexing: {error}");
        });
    }
  }
  // Publish the configured row immediately; metadata continues independently.
  app_handle
    .emit("library-updated", ())
    .map_err(|error| error.to_string())?;

  if !run_index_scan(&app_handle, vec![canonical_path.clone()]).await? {
    let index = library::LibraryIndex::open_for_app(&app_handle)?;
    return join_library_activity(&state, cached_library_view(&db, &index)?).await;
  }
  app_handle
    .emit("library-updated", ())
    .map_err(|error| error.to_string())?;
  let index = library::LibraryIndex::open_for_app(&app_handle)?;
  let view = cached_library_view(&db, &index)?;
  println!(
    "[Navio Command] scan_folder indexed root | tracks={} scanned_dirs={}",
    view.tracks.len(),
    view.scanned_directories.len()
  );
  join_library_activity(&state, view).await
}

use super::*;
use tauri::Emitter;

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
  fn library_tracks_map_to_activity_reconciliation_inputs() {
    let track = library::MediaItem {
      id: "media-1".to_string(),
      path: r"C:\Media\movie.mp4".to_string(),
      name: "movie.mp4".to_string(),
      title: None,
      duration_secs: 600.0,
      file_size_bytes: 42,
      media_type: "video".to_string(),
      cover_cache_path: None,
    };

    let activity = activity_media_from_track(&track);

    assert_eq!(activity.id, track.id);
    assert_eq!(activity.path, track.path);
    assert_eq!(activity.duration_secs, 600.0);
    assert_eq!(activity.media_type, "video");
  }

  #[test]
  fn cached_library_view_does_not_require_live_filesystem_scanning() {
    let root = test_directory("cached-view");
    fs::create_dir_all(&root).expect("create cached-view fixture");
    let index_path = root.join("index.sqlite3");
    let mut index = library::LibraryIndex::open(&index_path).expect("open test index");
    let media_path = root.join("missing-now.mp4");
    let root_key = library::path_key(&root);
    let indexed = library::IndexedMedia {
      path_key: library::path_key(&media_path),
      root_key: root_key.clone(),
      modified_ns: 1,
      item: library::MediaItem {
        id: "cached".to_string(),
        path: library::display_path(&media_path),
        name: "missing-now.mp4".to_string(),
        title: None,
        duration_secs: 90.0,
        file_size_bytes: 12,
        media_type: "video".to_string(),
        cover_cache_path: None,
      },
    };
    index
      .replace_root(&root_key, &[indexed])
      .expect("seed cached index");
    let db = library::LibraryDb {
      scanned_directories: vec![library::display_path(&root)],
    };

    let view = cached_library_view(&db, &index).expect("build cached view");

    assert_eq!(view.tracks.len(), 1);
    assert_eq!(view.tracks[0].id, "cached");
    drop(index);
    fs::remove_dir_all(root).expect("remove cached-view fixture");
  }

  #[test]
  fn adding_a_canonical_duplicate_does_not_create_another_root() {
    let root = test_directory("duplicate-root");
    fs::create_dir_all(&root).expect("create duplicate-root fixture");
    let canonical = root.canonicalize().expect("canonicalize duplicate root");
    let mut db = library::LibraryDb {
      scanned_directories: vec![library::display_path(&root)],
    };

    assert!(!add_directory_if_missing(&mut db, &canonical));
    assert_eq!(db.scanned_directories.len(), 1);
    fs::remove_dir_all(root).expect("remove duplicate-root fixture");
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
