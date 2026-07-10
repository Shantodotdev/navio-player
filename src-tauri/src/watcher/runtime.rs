use super::*;

/**
 * Starts the file system watcher task in a background tokio pool.
 * Initializes directory watch points for all folders currently saved in the library catalog.
 *
 * @param app_handle The active Tauri application handle.
 * @returns The RecommendedWatcher instance to be preserved in the AppState.
 */
pub fn start_watcher(app_handle: tauri::AppHandle) -> Result<RecommendedWatcher, String> {
  println!("[Navio Watcher] Starting filesystem watcher");

  // Create an asynchronous channel to queue filesystem events
  let (tx, mut rx) = mpsc::channel::<notify::Event>(200);

  // Initialize the native OS recommended watcher
  let tx_clone = tx.clone();
  let mut watcher = notify::recommended_watcher(move |res: Result<notify::Event, _>| {
    if let Ok(event) = res {
      println!(
        "[Navio Watcher] Raw filesystem event queued | kind={:?} paths={}",
        event.kind,
        event.paths.len()
      );
      // Send events to the async processing queue
      let _ = tx_clone.blocking_send(event);
    } else if let Err(err) = res {
      eprintln!("[Navio Watcher] Filesystem watcher error: {}", err);
    }
  })
  .map_err(|e| format!("Failed to create watcher: {}", e))?;

  // Bootstrap watch paths from existing scanned directories
  if let Ok(db) = library::load_db(&app_handle) {
    for dir in db.scanned_directories {
      let path = PathBuf::from(dir);
      if path.exists() {
        let _ = watcher.watch(&path, RecursiveMode::Recursive);
        println!(
          "[Navio Watcher] Watching saved library directory: {:?}",
          path
        );
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
            println!(
              "[Navio Watcher] Processing filesystem event batch seed | kind={:?} paths={}",
              event.kind,
              event.paths.len()
            );
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
                    println!(
                      "[Navio Watcher] Debounced filesystem event | kind={:?} paths={}",
                      new_event.kind,
                      new_event.paths.len()
                    );
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
              println!(
                "[Navio Watcher] Processing changed paths | count={}",
                changed_paths.len()
              );
              if let Err(e) = process_changed_paths(&app_handle_clone, &changed_paths) {
                log::error!("Watcher sync error: {}", e);
              }
              changed_paths.clear();
            }
          } else {
            println!("[Navio Watcher] Event channel closed; watcher task stopping");
            break; // Channel closed, shutdown task
          }
        }
      }
    }
  });

  Ok(watcher)
}
