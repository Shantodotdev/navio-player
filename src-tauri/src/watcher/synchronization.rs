use super::*;

/**
 * Surgically updates lofty tags for modified paths or deletes stale records.
 * Saves the library catalog and broadcasts the update event to the frontend.
 */
pub(super) fn process_changed_paths(
  app_handle: &tauri::AppHandle,
  paths: &HashSet<PathBuf>,
) -> Result<(), String> {
  println!(
    "[Navio Watcher] Syncing changed paths with library | count={}",
    paths.len()
  );

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
                println!("[Navio Watcher] Updated media item: {:?}", path);
                db.tracks[pos] = new_track;
              } else {
                println!("[Navio Watcher] Added media item: {:?}", path);
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
        println!("[Navio Watcher] Removed missing media item: {}", path_str);
        has_changes = true;
      }
    }
  }

  // Save the database and broadcast changes to the frontend if updates occurred
  if has_changes {
    library::save_db(app_handle, &db)?;
    println!("[Navio Event] emit library-updated | source=watcher");
    app_handle
      .emit("library-updated", ())
      .map_err(|e| e.to_string())?;
    println!("[Navio Watcher] Database synced and 'library-updated' broadcasted.");
  } else {
    println!("[Navio Watcher] No library changes found for filesystem batch");
  }

  Ok(())
}
