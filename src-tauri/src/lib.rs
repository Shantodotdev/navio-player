mod application;
mod commands;
mod downloader;
mod library;
mod media_tools;
mod playlists;
mod server;
mod watcher;

pub use application::run;

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Manager, RunEvent};
use tokio::sync::oneshot;

/// Global state managed by the Tauri application.
/// Available to frontend commands via Tauri's State Manager.
pub struct AppState {
  /// Set of directories allowed for file streaming.
  /// Scanned folders are added here to authorize file accesses.
  pub allowed_directories: Arc<Mutex<HashSet<PathBuf>>>,

  /// The port on which our local media streaming server is running.
  pub stream_port: u16,

  /// Per-process token required by media stream URLs.
  pub stream_token: String,

  /// Trigger to gracefully terminate the streaming server when the application exits.
  pub shutdown_tx: Mutex<Option<oneshot::Sender<()>>>,

  /// Reference to the active recommended file watcher.
  pub watcher: Arc<Mutex<Option<notify::RecommendedWatcher>>>,

  /// Persistent theater metadata/cache and active media preparation jobs.
  pub media_cache: media_tools::MediaCache,
}

#[derive(serde::Serialize)]
struct StreamConfig {
  port: u16,
  token: String,
}
