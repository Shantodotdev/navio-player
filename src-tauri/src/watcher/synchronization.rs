use super::*;

/// Notifies the frontend that a live library view should be rebuilt from disk.
pub(super) fn process_changed_paths(
  app_handle: &tauri::AppHandle,
  paths: &HashSet<PathBuf>,
) -> Result<(), String> {
  println!(
    "[Navio Watcher] Refreshing live library view | count={}",
    paths.len()
  );

  if paths.is_empty() {
    return Ok(());
  }

  app_handle
    .emit("library-updated", ())
    .map_err(|e| e.to_string())?;
  println!("[Navio Watcher] Live library refresh event broadcasted.");

  Ok(())
}
