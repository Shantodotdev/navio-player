use super::*;

/// Represents a media file (audio or video) inside the library catalog.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MediaItem {
  /// Unique auto-generated ID for this track.
  pub id: String,
  /// Absolute canonical file path on the host system.
  pub path: String,
  /// The filename (including extension).
  pub name: String,
  /// Title extracted from audio tags (if available).
  pub title: Option<String>,
  /// Track or video duration in seconds.
  pub duration_secs: f64,
  /// File size in bytes.
  #[serde(default)]
  pub file_size_bytes: u64,
  /// Media type: "audio" or "video".
  pub media_type: String,
  /// Path to extracted cover art file in AppData cache (if available).
  pub cover_cache_path: Option<String>,
}

/// Represents a custom user-defined playlist.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Playlist {
  /// User-defined unique playlist name.
  pub name: String,
  /// Ordered list of MediaItem IDs belonging to this playlist.
  pub track_ids: Vec<String>,
}

/// Represents the structured layout of our local database file (`library.json`).
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct LibraryDb {
  /// Directories that the user has added to their scanned catalog.
  pub scanned_directories: Vec<String>,
  /// Flattened list of all scanned media tracks.
  pub tracks: Vec<MediaItem>,
  /// List of custom playlists.
  pub playlists: Vec<Playlist>,
}
