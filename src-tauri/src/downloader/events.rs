//! Best-effort Tauri notifications for already-persisted downloader changes.
//!
//! Events intentionally do not carry unique state that exists nowhere else.
//! `DownloadManager` commits the complete record before this module emits it,
//! allowing a renderer that opens late, misses an event, or reloads to hydrate
//! accurately through `get_downloads`. This keeps transient WebView lifetime
//! separate from durable local download state.

use super::*;

/// Broadcasts one complete durable job after its state has been committed to disk.
pub(super) fn emit_download_update(app_handle: &AppHandle, job: &DownloadJob) {
  // Events are notifications only. `DownloadManager` has already persisted the
  // full record, so a renderer that misses one can recover via `get_downloads`.
  if let Err(error) = app_handle.emit("download-updated", job) {
    eprintln!("[Navio Event] failed to emit download update: {error}");
  }
}

/// Broadcasts history deletion so every renderer removes the same job card.
pub(super) fn emit_download_removed(app_handle: &AppHandle, id: &str) {
  if let Err(error) = app_handle.emit("download-removed", id) {
    eprintln!("[Navio Event] failed to emit download removal: {error}");
  }
}
