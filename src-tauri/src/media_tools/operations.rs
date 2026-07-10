use super::*;

/// Returns embedded track metadata and saved theater state for a video.
///
/// Track metadata is read from the persistent fingerprint cache when possible.
/// On a miss, FFprobe is preferred and FFmpeg's diagnostic output is parsed as
/// a fallback for distributions that do not include FFprobe.
pub async fn inspect_video_tracks(
  app_handle: &AppHandle,
  allowed_directories: &Arc<Mutex<HashSet<PathBuf>>>,
  cache: &MediaCache,
  path: String,
) -> Result<TheaterMediaInfo, String> {
  let media_path = validate_media_path(path, allowed_directories)?;
  let fingerprint = media_fingerprint(&media_path)?;
  let cached_entry = cache.load_media_entry(app_handle, &fingerprint).await?;
  let tracks = if let Some(tracks) = cached_entry.as_ref().and_then(|entry| entry.tracks.clone()) {
    // The fingerprint already includes source size and mtime, so this metadata
    // belongs to the exact source-file version being opened.
    tracks
  } else {
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
      // Some pinned Windows FFmpeg archives contain ffmpeg.exe only.
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

    let tracks = VideoTrackInfo {
      audio_tracks,
      subtitle_tracks,
    };
    cache
      .update_media_entry(app_handle, &fingerprint, &media_path, |entry| {
        entry.tracks = Some(tracks.clone());
      })
      .await?;
    tracks
  };

  let entry = cache
    .load_media_entry(app_handle, &fingerprint)
    .await?
    .unwrap_or_default();
  let cache_root = theater_cache_root(app_handle)?;
  // The frontend uses this list to restore a transcoded preference only when
  // the expensive work has already been completed in an earlier session.
  let cached_audio_stream_indexes = tracks
    .audio_tracks
    .iter()
    .filter(|track| {
      audio_output_path(&cache_root, &fingerprint, track.stream_index, &track.codec).is_file()
    })
    .map(|track| track.stream_index)
    .collect();

  Ok(TheaterMediaInfo {
    audio_tracks: tracks.audio_tracks,
    subtitle_tracks: tracks.subtitle_tracks,
    resume_position_secs: entry.resume_position_secs,
    preferred_audio_stream_index: entry.preferred_audio_stream_index,
    subtitle_preference_set: entry.subtitle_preference_set,
    preferred_subtitle_stream_index: entry.preferred_subtitle_stream_index,
    cached_audio_stream_indexes,
  })
}

/// Discovers stream metadata by parsing FFmpeg's standard input summary.
///
/// FFmpeg exits unsuccessfully when invoked without an output, but its stderr
/// still contains the stream table needed here. Only audio and subtitle rows
/// are converted into the small FFprobe-compatible representation above.
async fn inspect_streams_with_ffmpeg(
  ffmpeg_path: &Path,
  media_path: &Path,
) -> Result<FfprobeOutput, String> {
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

    // Typical forms are `1(eng)` and `2`; keep the language optional because
    // not every container labels its streams.
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

/// Runs one FFmpeg process and races it against a cancellation signal.
///
/// `kill_on_drop` ensures cancellation terminates the child process rather than
/// merely abandoning its future. Failed and cancelled outputs are deleted so a
/// later request cannot consume a partial asset.
async fn run_ffmpeg(
  mut command: Command,
  mut cancel: oneshot::Receiver<()>,
  output_path: &Path,
) -> Result<(), String> {
  command.kill_on_drop(true);
  let child = command
    .spawn()
    .map_err(|error| format!("Could not start FFmpeg: {}", error))?;
  let output = tokio::select! {
    output = child.wait_with_output() => output
      .map_err(|error| format!("Could not wait for FFmpeg: {}", error))?,
    _ = &mut cancel => {
      let _ = tokio::fs::remove_file(output_path).await;
      return Err("Media preparation was cancelled.".to_string());
    }
  };

  if output.status.success() {
    Ok(())
  } else {
    let _ = tokio::fs::remove_file(output_path).await;
    Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
  }
}

/// Converts one embedded subtitle stream to a cached WebVTT file.
///
/// Requests for an existing deterministic output are immediate LRU hits.
/// Concurrent misses for the same source fingerprint and stream share one
/// cancellable FFmpeg job.
pub async fn extract_subtitle_track(
  app_handle: &AppHandle,
  allowed_directories: &Arc<Mutex<HashSet<PathBuf>>>,
  cache: &MediaCache,
  path: String,
  stream_index: u32,
  request_id: String,
) -> Result<String, String> {
  let media_path = validate_media_path(path, allowed_directories)?;
  let fingerprint = media_fingerprint(&media_path)?;
  let subtitle_directory = theater_cache_root(app_handle)?.join("subtitles");
  tokio::fs::create_dir_all(&subtitle_directory)
    .await
    .map_err(|error| format!("Could not create the subtitle cache: {}", error))?;
  let output_path = subtitle_directory.join(format!("{}-{}.vtt", fingerprint, stream_index));

  if output_path.is_file() {
    // Cache hits still refresh the LRU timestamp before returning.
    cache
      .record_asset(app_handle, &output_path, AssetKind::Subtitle)
      .await?;
    allowed_directories
      .lock()
      .unwrap()
      .insert(subtitle_directory);
    return Ok(output_path.to_string_lossy().to_string());
  }

  let key = format!("subtitle:{}:{}", fingerprint, stream_index);
  let app = app_handle.clone();
  let cache_for_job = cache.clone();
  let output_for_job = output_path.clone();
  let media_for_job = media_path.clone();
  let result = cache
    .join_or_start(key, request_id, move |cancel| async move {
      let tools = ensure_media_tools(&app).await?;
      let temporary_path = temporary_output_path(&output_for_job);
      let mut command = Command::new(tools.ffmpeg_path);
      command
        .args(["-y", "-i"])
        .arg(&media_for_job)
        .args(["-map", &format!("0:{}", stream_index), "-c:s", "webvtt"])
        .arg(&temporary_path);
      run_ffmpeg(command, cancel, &temporary_path)
        .await
        .map_err(|error| {
          format!(
            "This subtitle track cannot be converted to WebVTT: {}",
            error
          )
        })?;
      // Publish only a completed file under the deterministic cache name.
      tokio::fs::rename(&temporary_path, &output_for_job)
        .await
        .map_err(|error| format!("Could not finalize cached subtitles: {}", error))?;
      cache_for_job
        .record_asset(&app, &output_for_job, AssetKind::Subtitle)
        .await?;
      Ok(output_for_job.to_string_lossy().to_string())
    })
    .await?;

  allowed_directories
    .lock()
    .unwrap()
    .insert(subtitle_directory);
  Ok(result)
}

/// Prepares one embedded audio stream as a separately synchronized cached file.
///
/// AAC, MP3, Opus, and Vorbis streams are remuxed with `copy`, avoiding CPU
/// heavy transcoding. Other codecs are converted to Opus only after the user
/// explicitly requests that track. Work is deduplicated by source and stream.
pub async fn extract_audio_track(
  app_handle: &AppHandle,
  allowed_directories: &Arc<Mutex<HashSet<PathBuf>>>,
  cache: &MediaCache,
  path: String,
  stream_index: u32,
  codec: String,
  request_id: String,
) -> Result<String, String> {
  let media_path = validate_media_path(path, allowed_directories)?;
  let fingerprint = media_fingerprint(&media_path)?;
  let cache_root = theater_cache_root(app_handle)?;
  let audio_directory = cache_root.join("audio");
  tokio::fs::create_dir_all(&audio_directory)
    .await
    .map_err(|error| format!("Could not create the audio cache: {}", error))?;
  let output_path = audio_output_path(&cache_root, &fingerprint, stream_index, &codec);

  if output_path.is_file() {
    // Reusing the deterministic output avoids both source reads and codec work.
    cache
      .record_asset(app_handle, &output_path, AssetKind::Audio)
      .await?;
    allowed_directories.lock().unwrap().insert(audio_directory);
    return Ok(output_path.to_string_lossy().to_string());
  }

  let (extension, copy_audio) = audio_output_details(&codec);
  let key = format!("audio:{}:{}:{}", fingerprint, stream_index, extension);
  let app = app_handle.clone();
  let cache_for_job = cache.clone();
  let output_for_job = output_path.clone();
  let media_for_job = media_path.clone();
  let result = cache
    .join_or_start(key, request_id, move |cancel| async move {
      let tools = ensure_media_tools(&app).await?;
      let temporary_path = temporary_output_path(&output_for_job);
      let mut command = Command::new(tools.ffmpeg_path);
      command
        .args(["-y", "-i"])
        .arg(&media_for_job)
        .args(["-map", &format!("0:{}", stream_index), "-vn", "-c:a"])
        .arg(if copy_audio { "copy" } else { "libopus" })
        .arg(&temporary_path);
      run_ffmpeg(command, cancel, &temporary_path)
        .await
        .map_err(|error| {
          format!(
            "This audio track cannot be prepared for playback: {}",
            error
          )
        })?;
      // Renaming after success prevents partial files from becoming cache hits.
      tokio::fs::rename(&temporary_path, &output_for_job)
        .await
        .map_err(|error| format!("Could not finalize cached audio: {}", error))?;
      cache_for_job
        .record_asset(&app, &output_for_job, AssetKind::Audio)
        .await?;
      Ok(output_for_job.to_string_lossy().to_string())
    })
    .await?;

  allowed_directories.lock().unwrap().insert(audio_directory);
  Ok(result)
}

/// Persists resume progress and, when requested, audio/subtitle preferences.
///
/// Frequent playback checkpoints set `save_preferences` to false so they cannot
/// overwrite a newer explicit language selection with stale UI state. Passing
/// `subtitle_enabled = false` records an intentional "subtitles off" choice.
/// Videos shorter than ten minutes retain preferences but never retain progress.
pub async fn save_theater_state(
  app_handle: &AppHandle,
  allowed_directories: &Arc<Mutex<HashSet<PathBuf>>>,
  cache: &MediaCache,
  path: String,
  duration_secs: f64,
  position_secs: f64,
  audio_stream_index: Option<u32>,
  subtitle_stream_index: Option<u32>,
  subtitle_enabled: bool,
  save_preferences: bool,
) -> Result<(), String> {
  let media_path = validate_media_path(path, allowed_directories)?;
  let fingerprint = media_fingerprint(&media_path)?;
  cache
    .update_media_entry(app_handle, &fingerprint, &media_path, |entry| {
      entry.resume_position_secs = if duration_secs >= MIN_RESUMABLE_VIDEO_DURATION_SECS {
        position_secs.max(0.0)
      } else {
        0.0
      };
      if save_preferences {
        entry.preferred_audio_stream_index = audio_stream_index;
        entry.subtitle_preference_set = true;
        entry.preferred_subtitle_stream_index =
          subtitle_enabled.then_some(subtitle_stream_index).flatten();
      }
    })
    .await
}
