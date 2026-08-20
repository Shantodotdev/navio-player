//! Data models, network protocol messages, and permission definitions for Navio Connect.
//!
//! All messages exchanged across LAN WebSockets and HTTP routes use these strictly-typed
//! structs with Serde serialization.

use serde::{Deserialize, Serialize};

/// Identifies the device category connecting to the Navio host.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeviceType {
  Desktop,
  Mobile,
  Tablet,
  Web,
}

/// Identifies the operating system or runtime platform of the peer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Platform {
  Windows,
  MacOS,
  Linux,
  Ios,
  Android,
  Web,
  Unknown,
}

impl Platform {
  /// Detects the local platform at runtime.
  pub fn current() -> Self {
    if cfg!(target_os = "windows") {
      Platform::Windows
    } else if cfg!(target_os = "macos") {
      Platform::MacOS
    } else if cfg!(target_os = "linux") {
      Platform::Linux
    } else {
      Platform::Unknown
    }
  }

  pub fn as_str(&self) -> &'static str {
    match self {
      Platform::Windows => "windows",
      Platform::MacOS => "macos",
      Platform::Linux => "linux",
      Platform::Ios => "ios",
      Platform::Android => "android",
      Platform::Web => "web",
      Platform::Unknown => "unknown",
    }
  }
}

/// Granular permissions granted by a host to a specific paired device.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectPermissions {
  /// Whether the peer is permitted to view the local media library catalog.
  pub allow_view_library: bool,
  /// Whether the peer is permitted to stream media files from this machine.
  pub allow_streaming: bool,
  /// Whether the peer is permitted to send playback commands (play/pause/seek/volume).
  pub allow_playback_control: bool,
  /// Whether the peer is permitted to dispatch downloader jobs to this machine.
  pub allow_remote_download: bool,
}

impl Default for ConnectPermissions {
  fn default() -> Self {
    Self {
      allow_view_library: true,
      allow_streaming: true,
      allow_playback_control: true,
      allow_remote_download: true,
    }
  }
}

/// A persistently trusted and paired device.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairedDevice {
  /// Unique identifier of the paired device.
  pub id: String,
  /// Friendly display name (e.g. "Khalid's MacBook Pro").
  pub name: String,
  /// Device category.
  pub device_type: DeviceType,
  /// Operating system / platform.
  pub platform: Platform,
  /// Secure shared secret token used to authenticate WebSocket and API requests.
  pub token: String,
  /// Granular permissions configured for this peer.
  pub permissions: ConnectPermissions,
  /// Epoch timestamp (in milliseconds) when the device was first paired.
  pub paired_at_ms: u64,
  /// Epoch timestamp (in milliseconds) of the most recent connection.
  pub last_seen_ms: u64,
}

/// A peer discovered on the local network via mDNS.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredPeer {
  /// Unique ID of the remote Navio instance.
  pub id: String,
  /// Friendly host name.
  pub name: String,
  /// List of resolved IPv4/IPv6 addresses on the LAN.
  pub addresses: Vec<String>,
  /// Port number on which the peer's Navio Connect server is listening.
  pub port: u16,
  /// Device category.
  pub device_type: DeviceType,
  /// Operating system / platform.
  pub platform: Platform,
  /// Application / protocol version string.
  pub version: String,
  /// Epoch timestamp (in milliseconds) of the last discovery heartbeat.
  pub last_seen_ms: u64,
}

/// Information describing the local Navio Connect node.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDeviceInfo {
  /// Unique ID for this Navio instance.
  pub id: String,
  /// Friendly machine name.
  pub name: String,
  /// Port on which Navio Connect is listening.
  pub port: u16,
  /// Detected LAN IP addresses (e.g., ["192.168.1.10"]).
  pub local_ips: Vec<String>,
  /// Operating system.
  pub platform: Platform,
  /// Protocol version.
  pub version: String,
}

/// Current synchronized playback state broadcasted to paired controllers.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectPlayerState {
  /// Title of the currently playing track/video.
  pub title: String,
  /// Artist or creator name if available.
  pub artist: Option<String>,
  /// Album name if available.
  pub album: Option<String>,
  /// Duration in milliseconds.
  pub duration_ms: u64,
  /// Current playback position in milliseconds.
  pub position_ms: u64,
  /// True if media is actively playing; false if paused or stopped.
  pub is_playing: bool,
  /// Volume level between 0.0 and 1.0.
  pub volume: f32,
  /// Media type: "audio" or "video".
  pub media_type: String,
  /// URL to retrieve thumbnail/cover art if available.
  pub thumbnail_url: Option<String>,
  /// Total tracks in the active queue.
  pub queue_length: usize,
  /// Current active index in the queue (-1 when no track selected).
  pub queue_index: i64,
  /// Timestamp of when this state snapshot was captured.
  pub updated_at_ms: u64,
}

/// Playback actions that can be sent from a controller to a host.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action", content = "payload", rename_all = "snake_case")]
pub enum ConnectPlaybackAction {
  Play,
  Pause,
  TogglePlay,
  Seek { position_ms: u64 },
  SetVolume { volume: f32 },
  NextTrack,
  PreviousTrack,
  SelectQueueItem { index: usize },
}

/// Minimal track item representation for remote library queries and streaming.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectTrackItem {
  pub id: String,
  pub title: String,
  pub artist: Option<String>,
  pub album: Option<String>,
  pub duration_seconds: f64,
  pub media_type: String,
  pub stream_url: String,
  pub thumbnail_url: Option<String>,
}

/// Bidirectional message protocol exchanged over the WebSocket channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "snake_case")]
pub enum ConnectMessage {
  /// Keep-alive ping.
  Ping,
  /// Keep-alive pong.
  Pong,

  /// Initial authentication frame sent by client upon connecting.
  Auth { token: String, client_id: String },
  /// Authentication result returned by host.
  AuthResult {
    success: bool,
    error_message: Option<String>,
    host_name: String,
    permissions: Option<ConnectPermissions>,
  },

  /// Request to pair a new device using a PIN code.
  PairRequest {
    client_id: String,
    client_name: String,
    device_type: DeviceType,
    platform: Platform,
    pin: String,
  },
  /// Response to a pairing attempt.
  PairResponse {
    success: bool,
    token: Option<String>,
    error_message: Option<String>,
    host_name: String,
    permissions: Option<ConnectPermissions>,
  },

  /// Command dispatched from a controller to the playback host.
  Command { action: ConnectPlaybackAction },

  /// Playback state snapshot sent from host to controllers.
  StateSync { state: ConnectPlayerState },

  /// Request to trigger a remote media download on the host.
  RemoteDownloadRequest { url: String, title: Option<String> },
  /// Live download progress broadcasted by host.
  RemoteDownloadProgress {
    job_id: String,
    url: String,
    percent: f32,
    speed: Option<String>,
    status: String,
  },

  /// Request to query media tracks from the host library.
  LibraryQuery {
    search: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
  },
  /// Response containing media tracks for remote browsing and streaming.
  LibraryResponse { tracks: Vec<ConnectTrackItem> },
}
