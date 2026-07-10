use crate::downloader;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use tokio::process::Command;

#[derive(Clone)]
pub struct MediaTools {
  pub ffmpeg_path: PathBuf,
  pub ffprobe_path: Option<PathBuf>,
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

  Ok(MediaTools {
    ffmpeg_path,
    ffprobe_path: ffprobe_path.exists().then_some(ffprobe_path),
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
  let parsed = if let Some(ffprobe_path) = tools.ffprobe_path {
    let output = Command::new(ffprobe_path)
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

    serde_json::from_slice(&output.stdout)
      .map_err(|error| format!("ffprobe returned invalid metadata: {}", error))?
  } else {
    inspect_streams_with_ffmpeg(&tools.ffmpeg_path, &media_path).await?
  };
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

async fn inspect_streams_with_ffmpeg(
  ffmpeg_path: &Path,
  media_path: &Path,
) -> Result<FfprobeOutput, String> {
  // The pinned Windows FFmpeg package ships only ffmpeg.exe. Its normal
  // inspection output still includes stream indices, languages, codecs, and
  // default dispositions, so use it whenever ffprobe is unavailable.
  let output = Command::new(ffmpeg_path)
    .args(["-hide_banner", "-i"])
    .arg(media_path)
    .output()
    .await
    .map_err(|error| format!("Could not start FFmpeg: {}", error))?;
  let stderr = String::from_utf8_lossy(&output.stderr);
  let mut streams = Vec::new();

  for line in stderr.lines() {
    let trimmed = line.trim();
    let Some(stream_start) = trimmed.find("Stream #0:") else {
      continue;
    };
    let remainder = &trimmed[stream_start + "Stream #0:".len()..];
    let Some((index_part, description)) = remainder.split_once(": ") else {
      continue;
    };

    let (index_text, language) = match index_part.split_once('(') {
      Some((index, language_part)) => (index, language_part.strip_suffix(')')),
      None => (index_part, None),
    };
    let Ok(index) = index_text.parse::<u32>() else {
      continue;
    };

    let (codec_type, codec_description) =
      if let Some(description) = description.strip_prefix("Audio:") {
        ("audio", description)
      } else if let Some(description) = description.strip_prefix("Subtitle:") {
        ("subtitle", description)
      } else {
        continue;
      };

    let codec = codec_description
      .trim()
      .split([',', ' '])
      .next()
      .unwrap_or("unknown")
      .to_string();
    streams.push(FfprobeStream {
      index,
      codec_type: codec_type.to_string(),
      codec_name: codec,
      tags: FfprobeTags {
        language: language.map(str::to_string),
        title: None,
      },
      disposition: FfprobeDisposition {
        default: i32::from(description.contains("(default)")),
      },
    });
  }

  if streams.is_empty() {
    return Err(format!(
      "FFmpeg could not read stream metadata: {}",
      stderr.lines().last().unwrap_or("unknown error")
    ));
  }

  Ok(FfprobeOutput { streams })
}

pub async fn extract_subtitle_track(
  app_handle: &AppHandle,
  allowed_directories: &Arc<Mutex<HashSet<PathBuf>>>,
  path: String,
  stream_index: u32,
) -> Result<String, String> {
  let media_path = PathBuf::from(path);
  if !media_path.is_file() {
    return Err("The selected video no longer exists.".to_string());
  }

  if !is_path_allowed(&media_path, &allowed_directories.lock().unwrap()) {
    return Err("The selected video is outside your media library.".to_string());
  }

  let subtitle_directory = app_handle
    .path()
    .app_cache_dir()
    .map_err(|error| format!("Could not resolve the subtitle cache: {}", error))?
    .join("theater-subtitles");
  tokio::fs::create_dir_all(&subtitle_directory)
    .await
    .map_err(|error| format!("Could not create the subtitle cache: {}", error))?;

  let output_path = subtitle_directory.join(format!("{}.vtt", uuid::Uuid::new_v4()));
  let tools = ensure_media_tools(app_handle).await?;
  let output = Command::new(tools.ffmpeg_path)
    .args(["-y", "-i"])
    .arg(&media_path)
    .args(["-map", &format!("0:{}", stream_index), "-c:s", "webvtt"])
    .arg(&output_path)
    .output()
    .await
    .map_err(|error| format!("Could not start FFmpeg: {}", error))?;

  if !output.status.success() {
    let _ = tokio::fs::remove_file(&output_path).await;
    return Err(format!(
      "This subtitle track cannot be converted to WebVTT: {}",
      String::from_utf8_lossy(&output.stderr).trim()
    ));
  }

  allowed_directories
    .lock()
    .unwrap()
    .insert(subtitle_directory);

  Ok(output_path.to_string_lossy().to_string())
}

pub async fn extract_audio_track(
  app_handle: &AppHandle,
  allowed_directories: &Arc<Mutex<HashSet<PathBuf>>>,
  path: String,
  stream_index: u32,
  codec: String,
) -> Result<String, String> {
  let media_path = PathBuf::from(path);
  if !media_path.is_file() {
    return Err("The selected video no longer exists.".to_string());
  }

  if !is_path_allowed(&media_path, &allowed_directories.lock().unwrap()) {
    return Err("The selected video is outside your media library.".to_string());
  }

  let audio_directory = app_handle
    .path()
    .app_cache_dir()
    .map_err(|error| format!("Could not resolve the audio cache: {}", error))?
    .join("theater-audio");
  tokio::fs::create_dir_all(&audio_directory)
    .await
    .map_err(|error| format!("Could not create the audio cache: {}", error))?;

  let (extension, copy_audio) = match codec.as_str() {
    "aac" => ("m4a", true),
    "opus" | "vorbis" => ("ogg", true),
    "mp3" => ("mp3", true),
    _ => ("ogg", false),
  };
  let output_path = audio_directory.join(format!("{}.{}", uuid::Uuid::new_v4(), extension));
  let tools = ensure_media_tools(app_handle).await?;
  let mut command = Command::new(tools.ffmpeg_path);
  command
    .args(["-y", "-i"])
    .arg(&media_path)
    .args(["-map", &format!("0:{}", stream_index), "-vn", "-c:a"])
    .arg(if copy_audio { "copy" } else { "libopus" })
    .arg(&output_path);
  let output = command
    .output()
    .await
    .map_err(|error| format!("Could not start FFmpeg: {}", error))?;

  if !output.status.success() {
    let _ = tokio::fs::remove_file(&output_path).await;
    return Err(format!(
      "This audio track cannot be prepared for playback: {}",
      String::from_utf8_lossy(&output.stderr).trim()
    ));
  }

  allowed_directories.lock().unwrap().insert(audio_directory);
  Ok(output_path.to_string_lossy().to_string())
}
