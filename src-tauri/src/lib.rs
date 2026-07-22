//! Native Navio application composition and shared cross-module state.
//!
//! This crate deliberately keeps the browser-facing renderer thin: local file
//! authorization, streaming tokens, filesystem watchers, media preparation,
//! downloader persistence, and operating-system process control stay in Rust.
//! `AppState` is the narrow shared surface exposed to Tauri commands. Its fields
//! are long-lived services or guarded resources, never unvalidated renderer
//! inputs; commands validate and narrow their own parameters before using them.

mod activity;
mod application;
mod commands;
mod control;
mod downloader;
mod library;
mod mcp;
mod media_tools;
mod playlists;
mod server;
mod settings;
mod watcher;

pub use application::run;

/// Runs Navio as a standalone STDIO MCP server for local AI coding clients.
///
/// MCP mode does not initialize Tauri or create a WebView. It owns a dedicated
/// Tokio runtime, serves protocol frames on the inherited standard streams, and
/// reaches the separately running desktop through the authenticated control bridge.
pub fn run_mcp() -> Result<(), String> {
  let runtime = tokio::runtime::Builder::new_multi_thread()
    .enable_all()
    .build()
    .map_err(|error| format!("Could not initialize the Navio MCP runtime: {error}"))?;
  runtime.block_on(mcp::serve_stdio())
}

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Manager, RunEvent};
use tokio::sync::oneshot;

/// Global state managed by the Tauri application.
/// Available to frontend commands via Tauri's State Manager.
pub struct AppState {
  /// Durable queue and live process controls for downloader jobs.
  pub download_manager: downloader::DownloadManager,
  /// Versioned local playback activity and smart-playlist source data.
  pub activity_store: activity::ActivityStore,
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

  /// Bounded request bridge used by authenticated local MCP control calls.
  pub control_broker: control::ControlBroker,
}

#[derive(serde::Serialize)]
struct StreamConfig {
  port: u16,
  token: String,
}
