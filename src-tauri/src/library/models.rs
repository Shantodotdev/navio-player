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
}

/// A transient library response assembled from the current filesystem state.
///
/// Tracks are intentionally excluded from `LibraryDb`; this view is returned
/// to the renderer but is never persisted as the library database.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct LibraryView {
  /// Directories configured by the user for live scanning.
  pub scanned_directories: Vec<String>,
  /// Media currently present inside the configured directories.
  pub tracks: Vec<MediaItem>,
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn legacy_track_records_are_ignored_when_loading_library_configuration() {
    let json = r#"{
      "scanned_directories": ["C:\\Media"],
      "tracks": [{"id":"old","path":"C:\\Media\\old.mp4"}]
    }"#;

    let db: LibraryDb = serde_json::from_str(json).expect("legacy JSON should remain readable");

    assert_eq!(db.scanned_directories, vec!["C:\\Media"]);
  }

  #[test]
  fn persisted_library_configuration_contains_no_track_array() {
    let db = LibraryDb {
      scanned_directories: vec!["C:\\Media".to_string()],
    };

    let json = serde_json::to_value(db).expect("library configuration should serialize");

    assert_eq!(
      json,
      serde_json::json!({"scanned_directories": ["C:\\Media"]})
    );
  }
}
