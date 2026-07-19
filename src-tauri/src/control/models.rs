use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

/// Media category used by local search and explicit URL downloads.
#[derive(Clone, Copy, Debug, Deserialize, JsonSchema, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaType {
  Audio,
  Video,
}

/// Transport action applied to the active HTML media element.
#[derive(Clone, Copy, Debug, Deserialize, JsonSchema, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PlaybackAction {
  Play,
  Pause,
  Stop,
  Next,
  Previous,
  SeekTo,
  SeekBy,
}

/// Supported mutation of Navio's active playback queue.
#[derive(Clone, Copy, Debug, Deserialize, JsonSchema, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum QueueAction {
  Add,
  Remove,
  Clear,
  PlayIndex,
}

/// Presentation surface requested for the current media.
#[derive(Clone, Copy, Debug, Deserialize, JsonSchema, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PlayerView {
  Hidden,
  Drawer,
  Theater,
}

/// A renderer operation requested by a trusted local MCP client.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ControlCommand {
  /// Return the renderer's current playback snapshot.
  GetPlaybackState,
  /// Return the active playback queue.
  GetQueue,
  /// Search only media already indexed in the user's Navio library.
  SearchLibrary {
    query: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    media_type: Option<MediaType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    limit: Option<u8>,
  },
  /// Start a local track selected by stable ID or exact local name.
  PlayMedia {
    #[serde(skip_serializing_if = "Option::is_none")]
    track_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
  },
  /// Change transport state for the active media.
  ControlPlayback {
    action: PlaybackAction,
    #[serde(skip_serializing_if = "Option::is_none")]
    seconds: Option<f64>,
  },
  /// Set the app-wide volume percentage.
  SetVolume { volume: u8 },
  /// Mutate the active playback queue.
  EditQueue {
    action: QueueAction,
    #[serde(skip_serializing_if = "Option::is_none")]
    track_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    index: Option<usize>,
  },
  /// Change the Now Playing presentation surface.
  SetPlayerView { view: PlayerView },
  /// Download an explicit public URL and play it after completion.
  DownloadAndPlayUrl { url: String, media_type: MediaType },
  /// Return all durable download jobs or one selected job.
  GetDownloads {
    #[serde(skip_serializing_if = "Option::is_none")]
    job_id: Option<String>,
  },
}

/// One correlated command waiting for the renderer to execute it.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PendingControlRequest {
  /// Unique identifier used to deliver the renderer's reply to the HTTP caller.
  pub id: Uuid,
  /// Typed command that the renderer must execute.
  pub command: ControlCommand,
}

/// Serializable result returned by the renderer for one control command.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ControlReply {
  /// Whether the command completed successfully.
  pub success: bool,
  /// Optional concise user-facing status or error message.
  pub message: Option<String>,
  /// Optional command-specific response body.
  pub data: Option<Value>,
}

impl ControlReply {
  /// Creates a successful control reply containing command-specific JSON data.
  ///
  /// The stable envelope is shared by the loopback endpoint and MCP tool output,
  /// so callers can inspect `success` before narrowing the command-specific data.
  pub fn success(data: Value) -> Self {
    Self {
      success: true,
      message: None,
      data: Some(data),
    }
  }

  /// Creates a failed reply containing only bounded, user-facing message text.
  ///
  /// Internal error types, tokens, and filesystem details remain on the desktop
  /// side of the control boundary.
  pub fn error(message: impl Into<String>) -> Self {
    Self {
      success: false,
      message: Some(message.into()),
      data: None,
    }
  }
}
