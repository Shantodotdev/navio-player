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

/// Represents the structured layout of the library database (`library.json`).
///
/// Playlists are intentionally absent from this model. They are persisted in
/// `playlists.json` so removing a scanned folder cannot remove the user's
/// independent playlist snapshots.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct LibraryDb {
  /// Directories that the user has added to their scanned catalog.
  pub scanned_directories: Vec<String>,
  /// Flattened list of all scanned media tracks.
  pub tracks: Vec<MediaItem>,
}
