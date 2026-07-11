use super::*;

const SUPPORTED_EXTENSIONS: [&str; 10] = [
  "mp3", "m4a", "flac", "ogg", "wav", "mp4", "mkv", "webm", "avi", "mov",
];

/// Builds a transient library view from the current contents of every saved folder.
pub fn build_library_view(db: &LibraryDb, app_cache_dir: &Path) -> LibraryView {
  let mut tracks = Vec::new();

  for directory in &db.scanned_directories {
    let path = PathBuf::from(directory);
    if path.is_dir() {
      tracks.extend(scan_dir_recursive(
        &path,
        app_cache_dir,
        &SUPPORTED_EXTENSIONS,
      ));
    }
  }

  LibraryView {
    scanned_directories: db.scanned_directories.clone(),
    tracks,
  }
}

/// Recursively scans a system directory tree for supported media extensions.
///
/// # Arguments
/// * `dir_path` - The system folder path to scan.
/// * `app_cache_dir` - Path to the application cache folder (used to write cover art).
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
  let file_size_bytes = fs::metadata(path).ok()?.len();

  let audio_extensions = ["mp3", "m4a", "flac", "ogg", "wav"];
  let video_extensions = ["mp4", "mkv", "webm", "avi", "mov"];

  let media_type = if audio_extensions.contains(&extension.as_str()) {
    "audio"
  } else if video_extensions.contains(&extension.as_str()) {
    "video"
  } else {
    return None;
  };

  let id = stable_media_id(path);
  let mut title = None;
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
    duration_secs,
    file_size_bytes,
    media_type: media_type.to_string(),
    cover_cache_path,
  })
}

/// Produces a stable client identity for a file path without persisting the path in the library DB.
fn stable_media_id(path: &Path) -> String {
  use std::collections::hash_map::DefaultHasher;
  use std::hash::{Hash, Hasher};

  let mut hasher = DefaultHasher::new();
  path.to_string_lossy().hash(&mut hasher);
  format!("media-{:016x}", hasher.finish())
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
