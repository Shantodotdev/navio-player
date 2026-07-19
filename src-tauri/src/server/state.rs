use super::*;

/// State shared across the local HTTP streaming server threads.
#[derive(Clone)]
pub struct ServerState {
  /// Directories that the user scanned. Only files inside these dirs can be streamed.
  /// This is a security boundary preventing arbitrary local file reads by webview scripts.
  pub allowed_directories: Arc<Mutex<HashSet<PathBuf>>>,

  /// Per-process bearer token required by stream requests.
  /// This prevents arbitrary browser origins from reading localhost media URLs.
  pub stream_token: String,

  /// Per-process bearer token required by private MCP control routes.
  pub control_token: String,

  /// Bounded handoff from authenticated HTTP calls to the renderer.
  pub control_broker: crate::control::ControlBroker,
}

#[derive(serde::Deserialize)]
pub(super) struct StreamQuery {
  pub(super) token: String,
}
