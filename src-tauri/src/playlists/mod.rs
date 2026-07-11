//! Independent playlist snapshots, persistence, and stream authorization.
//!
//! This module intentionally sits beside `library`, rather than inside it.
//! Playlists are user-curated collections that must survive library folder
//! removal and therefore cannot be modeled as references into `library.json`.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

mod models;
mod storage;

pub use models::PlaylistsDb;
pub use storage::{load_db, save_db};

/// Adds existing playlist track directories to the streaming allowlist.
///
/// The media server authorizes directories, not individual files. For every
/// saved snapshot we therefore add its current parent directory when that
/// directory exists. Missing files are skipped without deleting their
/// snapshots; if the file returns later, the next playlist save or application
/// restart can authorize its directory again.
///
/// Returns the number of newly inserted directories, which is used only for
/// diagnostics and does not expose playlist contents in logs.
pub fn authorize_stream_directories(
  db: &PlaylistsDb,
  allowed_directories: &Arc<Mutex<HashSet<PathBuf>>>,
) -> usize {
  let mut allowed = allowed_directories.lock().unwrap();
  let before = allowed.len();

  for track in db.playlists.iter().flat_map(|playlist| &playlist.tracks) {
    // `validate_db` has already checked that paths are absolute. Keeping the
    // parent-directory lookup defensive makes this helper safe when it is
    // reused by startup code or future commands.
    let path = PathBuf::from(&track.path);
    if let Some(parent) = path.parent() {
      if parent.exists() && parent.is_dir() {
        allowed.insert(parent.to_path_buf());
      }
    }
  }

  allowed.len().saturating_sub(before)
}
