use crate::downloader;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::AppHandle;
use tokio::process::Command;

#[derive(Clone)]
pub struct MediaTools {
  pub ffmpeg_path: PathBuf,
  pub ffprobe_path: PathBuf,
}

#[derive(serde::Serialize)]
pub struct EmbeddedTrack {
  pub stream_index: u32,
  pub language: Option<String>,
  pub title: Option<String>,
  pub is_default: bool,
  pub codec: String,
}

#[derive(serde::Serialize)]
pub struct VideoTrackInfo {
  pub audio_tracks: Vec<EmbeddedTrack>,
  pub subtitle_tracks: Vec<EmbeddedTrack>,
}

#[derive(serde::Deserialize)]
struct FfprobeOutput {
  #[serde(default)]
  streams: Vec<FfprobeStream>,
}

#[derive(serde::Deserialize)]
struct FfprobeStream {
  index: u32,
  codec_type: String,
  codec_name: String,
  #[serde(default)]
  tags: FfprobeTags,
  #[serde(default)]
  disposition: FfprobeDisposition,
}

#[derive(Default, serde::Deserialize)]
struct FfprobeTags {
  language: Option<String>,
  title: Option<String>,
}

#[derive(Default, serde::Deserialize)]
struct FfprobeDisposition {
  #[serde(default)]
  default: i32,
}

pub async fn ensure_media_tools(app_handle: &AppHandle) -> Result<MediaTools, String> {
  let ffmpeg_path = downloader::ensure_ffmpeg_installed(app_handle, "theater-tools").await?;
  let ffprobe_name = if cfg!(windows) {
    "ffprobe.exe"
  } else {
    "ffprobe"
  };
  let ffprobe_path = ffmpeg_path
    .parent()
    .ok_or_else(|| "Could not resolve the FFmpeg bin directory".to_string())?
    .join(ffprobe_name);

  if !ffprobe_path.exists() {
    return Err("The installed FFmpeg package does not include ffprobe.".to_string());
  }

  Ok(MediaTools {
    ffmpeg_path,
    ffprobe_path,
  })
}

fn is_path_allowed(path: &Path, allowed_directories: &HashSet<PathBuf>) -> bool {
  let Ok(canonical_path) = path.canonicalize() else {
    return false;
  };

  allowed_directories.iter().any(|directory| {
    directory
      .canonicalize()
      .map(|canonical_directory| canonical_path.starts_with(canonical_directory))
      .unwrap_or(false)
  })
}

pub async fn inspect_video_tracks(
  app_handle: &AppHandle,
  allowed_directories: &Arc<Mutex<HashSet<PathBuf>>>,
  path: String,
) -> Result<VideoTrackInfo, String> {
  let media_path = PathBuf::from(path);
  if !media_path.is_file() {
    return Err("The selected video no longer exists.".to_string());
  }

  if !is_path_allowed(&media_path, &allowed_directories.lock().unwrap()) {
    return Err("The selected video is outside your media library.".to_string());
  }

  let tools = ensure_media_tools(app_handle).await?;
  let output = Command::new(tools.ffprobe_path)
    .args([
      "-v",
      "error",
      "-show_entries",
      "stream=index,codec_type,codec_name:stream_tags=language,title:stream_disposition=default",
      "-of",
      "json",
    ])
    .arg(&media_path)
    .output()
    .await
    .map_err(|error| format!("Could not start ffprobe: {}", error))?;

  if !output.status.success() {
    return Err(format!(
      "ffprobe could not inspect this video: {}",
      String::from_utf8_lossy(&output.stderr).trim()
    ));
  }

  let parsed: FfprobeOutput = serde_json::from_slice(&output.stdout)
    .map_err(|error| format!("ffprobe returned invalid metadata: {}", error))?;
  let mut audio_tracks = Vec::new();
  let mut subtitle_tracks = Vec::new();

  for stream in parsed.streams {
    let track = EmbeddedTrack {
      stream_index: stream.index,
      language: stream.tags.language,
      title: stream.tags.title,
      is_default: stream.disposition.default != 0,
      codec: stream.codec_name,
    };

    match stream.codec_type.as_str() {
      "audio" => audio_tracks.push(track),
      "subtitle" => subtitle_tracks.push(track),
      _ => {}
    }
  }

  Ok(VideoTrackInfo {
    audio_tracks,
    subtitle_tracks,
  })
}
