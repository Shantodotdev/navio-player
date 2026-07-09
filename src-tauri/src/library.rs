use lofty::file::AudioFile;
use lofty::file::TaggedFileExt;
use lofty::probe::Probe;
use lofty::tag::Accessor;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;
use uuid::Uuid;

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
  /// Artist extracted from audio tags (if available).
  pub artist: Option<String>,
  /// Album name extracted from audio tags (if available).
  pub album: Option<String>,
  /// Track or video duration in seconds.
  pub duration_secs: f64,
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

/// Retrieves the absolute file path pointing to the AppData database file.
/// Creates the parent AppData directory if it doesn't already exist.
pub fn get_db_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
  let app_data = app_handle
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to resolve AppData directory: {}", e))?;

  if !app_data.exists() {
    fs::create_dir_all(&app_data)
      .map_err(|e| format!("Failed to create AppData directory: {}", e))?;
  }

  Ok(app_data.join("library.json"))
}

/// Loads the local database file from disk.
/// Returns an empty `LibraryDb` structure if the file doesn't exist yet.
pub fn load_db(app_handle: &tauri::AppHandle) -> Result<LibraryDb, String> {
  let db_path = get_db_path(app_handle)?;
  if !db_path.exists() {
    return Ok(LibraryDb::default());
  }

  let file = fs::File::open(db_path).map_err(|e| format!("Failed to open database file: {}", e))?;
  let reader = std::io::BufReader::new(file);

  let db =
    serde_json::from_reader(reader).map_err(|e| format!("Failed to parse database JSON: {}", e))?;

  Ok(db)
}

/// Saves the current library catalog state to disk in a pretty-printed JSON format.
pub fn save_db(app_handle: &tauri::AppHandle, db: &LibraryDb) -> Result<(), String> {
  let db_path = get_db_path(app_handle)?;
  let file =
    fs::File::create(db_path).map_err(|e| format!("Failed to write database file: {}", e))?;
  let writer = std::io::BufWriter::new(file);

  serde_json::to_writer_pretty(writer, db)
    .map_err(|e| format!("Failed to serialize database: {}", e))?;

  Ok(())
}

/// Recursively scans a system directory tree for supported media extensions.
///
/// # Arguments
/// * `dir_path` - The system folder path to scan.
/// * `app_cache_dir` - Path to the application cache folder (used to write cover art).
/// * `allowed_extensions` - Array of supported lowercased extension slices (e.g. `["mp3", "mp4"]`).
pub fn scan_dir_recursive(
  dir_path: &Path,
  app_cache_dir: &Path,
  allowed_extensions: &[&str],
) -> Vec<MediaItem> {
  let mut items = Vec::new();

  // Read target directory entries
  let entries = match fs::read_dir(dir_path) {
    Ok(e) => e,
    Err(_) => return items, // Silently skip directories we don't have access to
  };

  for entry in entries.flatten() {
    let path = entry.path();
    if path.is_dir() {
      // Recurse into subdirectory
      items.extend(scan_dir_recursive(&path, app_cache_dir, allowed_extensions));
    } else if path.is_file() {
      if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
        let ext_lower = ext.to_lowercase();
        if allowed_extensions.contains(&ext_lower.as_str()) {
          // Process file and extract metadata tags
          if let Some(item) = process_media_file(&path, app_cache_dir) {
            items.push(item);
          }
        }
      }
    }
  }

  items
}

/// Inspects a media file, reads metadata tags, and wraps them in a `MediaItem` struct.
pub fn process_media_file(path: &Path, app_cache_dir: &Path) -> Option<MediaItem> {
  let path_str = path.to_string_lossy().to_string();
  let filename = path.file_name()?.to_string_lossy().to_string();
  let extension = path.extension()?.to_str()?.to_lowercase();

  let audio_extensions = ["mp3", "m4a", "flac", "ogg", "wav"];
  let video_extensions = ["mp4", "mkv", "webm", "avi", "mov"];

  let media_type = if audio_extensions.contains(&extension.as_str()) {
    "audio"
  } else if video_extensions.contains(&extension.as_str()) {
    "video"
  } else {
    return None;
  };

  let id = Uuid::new_v4().to_string();
  let mut title = None;
  let mut artist = None;
  let mut album = None;
  let mut duration_secs = 0.0;
  let mut cover_cache_path = None;

  if media_type == "audio" {
    // Probe audio file structure
    if let Ok(tagged_file) = Probe::open(path).and_then(|p| p.read()) {
      let properties = tagged_file.properties();
      duration_secs = properties.duration().as_secs_f64();

      // Read standardized tagging format (ID3v2, Vorbis, etc.)
      if let Some(tag) = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag())
      {
        title = tag.title().map(|s| s.to_string());
        artist = tag.artist().map(|s| s.to_string());
        album = tag.album().map(|s| s.to_string());

        // Extract artwork bytes if present
        if let Some(picture) = tag.pictures().first() {
          let art_data = picture.data();

          // Optimization: Hash image bytes to write identical artwork once (covers deduplication)
          use std::collections::hash_map::DefaultHasher;
          use std::hash::{Hash, Hasher};
          let mut hasher = DefaultHasher::new();
          art_data.hash(&mut hasher);
          let hash_str = format!("{:x}", hasher.finish());

          let file_name = format!("{}.jpg", hash_str);
          let target_path = app_cache_dir.join("covers").join(&file_name);

          // Write to file cache only if the cover art hasn't been extracted before
          if !target_path.exists() {
            fs::create_dir_all(target_path.parent().unwrap()).ok();
            fs::write(&target_path, art_data).ok();
          }
          cover_cache_path = Some(target_path.to_string_lossy().to_string());
        }
      }
    }
  } else {
    // Read video duration header asynchronously / lightweightly
    duration_secs = read_video_duration(path).unwrap_or(0.0);
  }

  Some(MediaItem {
    id,
    path: path_str,
    name: filename,
    title,
    artist,
    album,
    duration_secs,
    media_type: media_type.to_string(),
    cover_cache_path,
  })
}

/// Parses video headers to read duration (header-only, low-RAM, lightweight).
fn read_video_duration(path: &Path) -> Option<f64> {
  let ext = path.extension()?.to_str()?.to_lowercase();
  if ext == "mp4" {
    let f = fs::File::open(path).ok()?;
    let size = f.metadata().ok()?.len();
    let reader = std::io::BufReader::new(f);
    // Reads only the metadata atoms/boxes (e.g. 'moov') from the file
    let mp4 = mp4::Mp4Reader::read_header(reader, size).ok()?;
    Some(mp4.duration().as_secs_f64())
  } else if ext == "mkv" || ext == "webm" {
    // Reads Matroska segment info headers using matroska::get_from
    let info = matroska::get_from::<_, matroska::Info>(path).ok()??;
    Some(info.duration?.as_secs_f64())
  } else {
    None
  }
}
