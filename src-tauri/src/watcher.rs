use crate::library;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashSet;
use std::path::PathBuf;
use tauri::{Emitter, Manager};
use tokio::sync::mpsc;

/**
 * Starts the file system watcher task in a background tokio pool.
 * Initializes directory watch points for all folders currently saved in the library catalog.
 *
 * @param app_handle The active Tauri application handle.
 * @returns The RecommendedWatcher instance to be preserved in the AppState.
 */
pub fn start_watcher(app_handle: tauri::AppHandle) -> Result<RecommendedWatcher, String> {
  // Create an asynchronous channel to queue filesystem events
  let (tx, mut rx) = mpsc::channel::<notify::Event>(200);

  // Initialize the native OS recommended watcher
  let tx_clone = tx.clone();
  let mut watcher = notify::recommended_watcher(move |res: Result<notify::Event, _>| {
    if let Ok(event) = res {
      // Send events to the async processing queue
      let _ = tx_clone.blocking_send(event);
    }
  })
  .map_err(|e| format!("Failed to create watcher: {}", e))?;

  // Bootstrap watch paths from existing scanned directories
  if let Ok(db) = library::load_db(&app_handle) {
    for dir in db.scanned_directories {
      let path = PathBuf::from(dir);
      if path.exists() {
        let _ = watcher.watch(&path, RecursiveMode::Recursive);
      }
    }
  }

  // Spawn the background event processor using Tauri's managed async runtime
  let app_handle_clone = app_handle.clone();
  tauri::async_runtime::spawn(async move {
    let mut changed_paths = HashSet::new();
    let debounce_duration = std::time::Duration::from_millis(500);

    loop {
      // Wait for the first filesystem event
      tokio::select! {
        event_opt = rx.recv() => {
          if let Some(event) = event_opt {
            // Add all affected paths to the batch list
            for path in event.paths {
              changed_paths.insert(path);
            }

            // Debounce Loop: Keep collecting paths while events occur within 500ms of each other
            loop {
              let sleep_timer = tokio::time::sleep(debounce_duration);
              tokio::select! {
                new_event_opt = rx.recv() => {
                  if let Some(new_event) = new_event_opt {
                    for path in new_event.paths {
                      changed_paths.insert(path);
                    }
                  } else {
                    break; // Channel closed
                  }
                }
                _ = sleep_timer => {
                  // Quiet period elapsed, break out of debounce collection
                  break;
                }
              }
            }

            // Process the batch of changed paths
            if !changed_paths.is_empty() {
              if let Err(e) = process_changed_paths(&app_handle_clone, &changed_paths) {
                log::error!("Watcher sync error: {}", e);
              }
              changed_paths.clear();
            }
          } else {
            break; // Channel closed, shutdown task
          }
        }
      }
    }
  });

  Ok(watcher)
}

/**
 * Surgically updates lofty tags for modified paths or deletes stale records.
 * Saves the library catalog and broadcasts the update event to the frontend.
 */
fn process_changed_paths(
  app_handle: &tauri::AppHandle,
  paths: &HashSet<PathBuf>,
) -> Result<(), String> {
  let mut db = library::load_db(app_handle)?;
  let cache_dir = app_handle
    .path()
    .app_cache_dir()
    .map_err(|e| e.to_string())?;
  let mut has_changes = false;

  let allowed_extensions = ["mp3", "m4a", "flac", "ogg", "wav", "mp4", "mkv", "webm"];

  for path in paths {
    if path.exists() {
      // File exists on disk: check if it's a supported media item and insert/update tags
      if path.is_file() {
        if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
          if allowed_extensions.contains(&ext.to_lowercase().as_str()) {
            if let Some(new_track) = library::process_media_file(path, &cache_dir) {
              if let Some(pos) = db.tracks.iter().position(|t| t.path == new_track.path) {
                db.tracks[pos] = new_track;
              } else {
                db.tracks.push(new_track);
              }
              has_changes = true;
            }
          }
        }
      }
    } else {
      // File was removed: remove it from the catalog
      let path_str = path.to_string_lossy().to_string();
      let old_len = db.tracks.len();
      db.tracks.retain(|t| t.path != path_str);

      if db.tracks.len() != old_len {
        has_changes = true;
      }
    }
  }

  // Save the database and broadcast changes to the frontend if updates occurred
  if has_changes {
    library::save_db(app_handle, &db)?;
    app_handle
      .emit("library-updated", ())
      .map_err(|e| e.to_string())?;
    println!("[Ardio Watcher] Database synced and 'library-updated' broadcasted.");
  }

  Ok(())
}
