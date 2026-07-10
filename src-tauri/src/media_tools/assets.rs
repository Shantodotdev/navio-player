use super::*;

/// Rebuilds LRU bookkeeping from the files that actually exist on disk.
///
/// This recovers from a missing or malformed index, includes assets produced by
/// the older UUID-based cache layout, and removes abandoned partial files once
/// they are old enough that no active FFmpeg job can reasonably own them.
pub(super) async fn reconcile_asset_index(
  root: &Path,
  index: &mut AssetIndex,
) -> Result<(), String> {
  let app_cache = root
    .parent()
    .ok_or_else(|| "Could not resolve the application cache root.".to_string())?;
  let directories = [
    (root.join("audio"), AssetKind::Audio),
    (root.join("subtitles"), AssetKind::Subtitle),
    (app_cache.join("theater-audio"), AssetKind::Audio),
    (app_cache.join("theater-subtitles"), AssetKind::Subtitle),
  ];
  let mut discovered = HashSet::new();

  for (directory, kind) in directories {
    scan_asset_directory(&directory, kind, index, &mut discovered).await?;
  }

  // Anything not rediscovered was deleted externally or evicted previously.
  index.entries.retain(|path, _| discovered.contains(path));
  Ok(())
}

/// Adds regular generated files from one managed directory to the LRU index.
pub(super) async fn scan_asset_directory(
  directory: &Path,
  kind: AssetKind,
  index: &mut AssetIndex,
  discovered: &mut HashSet<String>,
) -> Result<(), String> {
  let mut entries = match tokio::fs::read_dir(directory).await {
    Ok(entries) => entries,
    Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
    Err(error) => {
      return Err(format!(
        "Could not inspect theater cache directory {}: {}",
        directory.display(),
        error
      ))
    }
  };

  while let Some(entry) = entries
    .next_entry()
    .await
    .map_err(|error| format!("Could not read theater cache entry: {}", error))?
  {
    let metadata = entry
      .metadata()
      .await
      .map_err(|error| format!("Could not inspect theater cache entry: {}", error))?;
    if !metadata.is_file() {
      continue;
    }

    let path = entry.path();
    let path_key = path.to_string_lossy().to_string();
    let modified_ms = metadata
      .modified()
      .map(system_time_ms)
      .unwrap_or_else(|_| now_ms());
    let file_name = entry.file_name().to_string_lossy().to_string();
    if file_name.contains(".part.") || file_name.ends_with(".part") {
      // A recent partial file may belong to another concurrent extraction.
      if now_ms().saturating_sub(modified_ms) >= STALE_PARTIAL_AGE_MS {
        let _ = tokio::fs::remove_file(&path).await;
      }
      continue;
    }

    discovered.insert(path_key.clone());
    let previous_access = index
      .entries
      .get(&path_key)
      .map(|asset| asset.last_accessed_ms)
      .unwrap_or(modified_ms);
    index.entries.insert(
      path_key,
      AssetIndexEntry {
        kind,
        size_bytes: metadata.len(),
        last_accessed_ms: previous_access,
      },
    );
  }
  Ok(())
}

/// Converts a filesystem timestamp into the millisecond scale used by the LRU.
pub(super) fn system_time_ms(time: SystemTime) -> u64 {
  time
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_millis()
    .min(u128::from(u64::MAX)) as u64
}

/// Evicts least recently used files of one kind until that kind is under its
/// byte limit. The file just produced or selected is protected from this pass.
pub(super) async fn cleanup_assets(index: &mut AssetIndex, kind: AssetKind, protected_path: &Path) {
  let limit = match kind {
    AssetKind::Audio => MAX_AUDIO_CACHE_BYTES,
    AssetKind::Subtitle => MAX_SUBTITLE_CACHE_BYTES,
  };
  let mut total = index
    .entries
    .values()
    .filter(|entry| entry.kind == kind)
    .map(|entry| entry.size_bytes)
    .sum::<u64>();
  if total <= limit {
    return;
  }

  let protected = protected_path.to_string_lossy();
  let mut candidates = index
    .entries
    .iter()
    .filter(|(path, entry)| entry.kind == kind && path.as_str() != protected)
    .map(|(path, entry)| (path.clone(), entry.last_accessed_ms, entry.size_bytes))
    .collect::<Vec<_>>();
  candidates.sort_unstable_by_key(|(_, accessed, _)| *accessed);

  for (path, _, size) in candidates {
    if total <= limit {
      break;
    }
    if tokio::fs::remove_file(&path).await.is_ok() {
      index.entries.remove(&path);
      total = total.saturating_sub(size);
    }
  }
}

/// Root directory for disposable theater audio, subtitle, and LRU data.
pub(super) fn theater_cache_root(app_handle: &AppHandle) -> Result<PathBuf, String> {
  app_handle
    .path()
    .app_cache_dir()
    .map(|path| path.join("theater-media"))
    .map_err(|error| format!("Could not resolve the theater cache: {}", error))
}

/// Returns the browser-friendly extension and whether FFmpeg can stream-copy
/// the codec without decoding and re-encoding it.
pub(super) fn audio_output_details(codec: &str) -> (&'static str, bool) {
  match codec {
    "aac" => ("m4a", true),
    "opus" | "vorbis" => ("ogg", true),
    "mp3" => ("mp3", true),
    _ => ("ogg", false),
  }
}

/// Deterministic path for an audio stream prepared from a fingerprinted source.
pub(super) fn audio_output_path(
  root: &Path,
  fingerprint: &str,
  stream_index: u32,
  codec: &str,
) -> PathBuf {
  let (extension, _) = audio_output_details(codec);
  root
    .join("audio")
    .join(format!("{}-{}.{}", fingerprint, stream_index, extension))
}

/// Creates a unique partial-file path while retaining the final extension.
///
/// FFmpeg uses the extension to infer its output container. A unique temporary
/// path prevents interrupted jobs from being mistaken for valid cache hits.
pub(super) fn temporary_output_path(output_path: &Path) -> PathBuf {
  let stem = output_path
    .file_stem()
    .and_then(|value| value.to_str())
    .unwrap_or("media");
  let extension = output_path
    .extension()
    .and_then(|value| value.to_str())
    .unwrap_or("tmp");
  output_path.with_file_name(format!(
    "{}.{}.part.{}",
    stem,
    uuid::Uuid::new_v4(),
    extension
  ))
}
