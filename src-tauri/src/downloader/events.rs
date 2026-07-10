/// Payload struct representing a single download progress update broadcasted to the React frontend.
#[derive(serde::Serialize, Clone, Debug)]
pub struct DownloadPayload {
  /// Unique identifier of the active download item.
  pub id: String,
  /// Target stream URL being processed.
  pub url: String,
  /// Cleaned title (derived from the stream metadata or filename).
  pub title: String,
  /// Current progress percentage (0.0 to 100.0).
  pub progress: f32,
  /// Live download speed string (e.g. "4.5 MiB/s").
  pub speed: String,
  /// Estimated time remaining (e.g. "00:15").
  pub eta: String,
  /// Total file size being downloaded.
  pub size: String,
  /// Current execution state: "downloading" | "completed" | "failed".
  pub status: String,
}

use super::*;

pub(super) fn emit_download_progress(app_handle: &AppHandle, payload: DownloadPayload) {
  println!(
    "[Navio Event] emit download-progress | id={} status={} progress={:.1}% title=\"{}\" speed=\"{}\" eta=\"{}\" size=\"{}\"",
    payload.id,
    payload.status,
    payload.progress,
    payload.title,
    payload.speed,
    payload.eta,
    payload.size
  );

  if let Err(err) = app_handle.emit("download-progress", payload) {
    eprintln!("[Navio Event] failed to emit download-progress: {}", err);
  }
}
