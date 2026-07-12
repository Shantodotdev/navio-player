//! Tauri command boundary and supervised yt-dlp worker for Navio downloads.
//!
//! This module turns renderer requests into durable [`DownloadJob`] records,
//! then runs yt-dlp in an isolated staging directory owned by that job. The
//! worker is deliberately responsible for the full attempt lifecycle: tool
//! setup, structured progress parsing, process termination, final file moves,
//! and terminal-state selection. Commands only request transitions; they never
//! receive a filesystem path from the renderer and never manipulate a process
//! without an entry in `DownloadManager`'s active-control registry.
//!
//! The central invariant is **persist first, emit second**. A live event may be
//! missed while a WebView reloads, but `get_downloads` can always reconstruct
//! the same record from disk. A non-zero yt-dlp exit is considered a failure
//! only when no explicit Pause, Cancel, or application-exit action was recorded.

use super::*;
use std::ffi::OsStr;

const PROGRESS_PREFIX: &str = "NAVIO_PROGRESS:";

/// Tauri command that creates and starts one new durable download job.
#[tauri::command]
pub async fn start_download(
  id: String,
  url: String,
  format: String,
  no_playlist: Option<bool>,
  app_handle: AppHandle,
  state: tauri::State<'_, AppState>,
) -> Result<(), String> {
  validate_start_request(&id, &url, &format)?;
  let request = DownloadRequest {
    url,
    format,
    no_playlist: no_playlist.unwrap_or(true),
  };
  let job = state.download_manager.create(id, request)?;
  // Persist and publish the card before spawning work. This prevents a fast
  // setup failure from being invisible if the renderer has not yet subscribed.
  emit_download_update(&app_handle, &job);
  start_attempt(app_handle, state.download_manager.clone(), job.id).await
}

/// Tauri command that resumes a paused, failed, or interrupted job using retained parts.
#[tauri::command]
pub async fn resume_download(
  id: String,
  app_handle: AppHandle,
  state: tauri::State<'_, AppState>,
) -> Result<(), String> {
  let job = state.download_manager.prepare_retry(&id)?;
  // A retry reuses the ID and staging folder, which is what lets yt-dlp locate
  // `.part` files instead of downloading completed fragments again.
  emit_download_update(&app_handle, &job);
  start_attempt(app_handle, state.download_manager.clone(), id).await
}

/// Tauri command that soft-pauses a job while retaining its private staging files.
#[tauri::command]
pub async fn pause_download(
  id: String,
  app_handle: AppHandle,
  state: tauri::State<'_, AppState>,
) -> Result<(), String> {
  let job = state
    .download_manager
    .request_stop(&id, StopAction::Pause)
    .await?;
  emit_download_update(&app_handle, &job);
  Ok(())
}

/// Tauri command that stops a job and schedules deletion of its partial artifacts.
#[tauri::command]
pub async fn cancel_download(
  id: String,
  app_handle: AppHandle,
  state: tauri::State<'_, AppState>,
) -> Result<(), String> {
  let job = state
    .download_manager
    .request_stop(&id, StopAction::Cancel)
    .await?;
  emit_download_update(&app_handle, &job);
  Ok(())
}

/// Tauri command that returns the persistent queue for initial renderer hydration.
#[tauri::command]
pub fn get_downloads(state: tauri::State<'_, AppState>) -> Vec<DownloadJob> {
  state.download_manager.list()
}

/// Tauri command that removes a finished history record without deleting downloaded media.
#[tauri::command]
pub fn remove_download(
  id: String,
  app_handle: AppHandle,
  state: tauri::State<'_, AppState>,
) -> Result<(), String> {
  state.download_manager.remove(&id)?;
  emit_download_removed(&app_handle, &id);
  Ok(())
}

/// Starts a worker only after its durable record has been claimed by the active registry.
async fn start_attempt(
  app_handle: AppHandle,
  manager: DownloadManager,
  id: String,
) -> Result<(), String> {
  let control = manager.claim_attempt(&id)?;
  // The command returns after registration, not after yt-dlp completes; cards
  // remain responsive while the worker handles tools and network I/O.
  tauri::async_runtime::spawn(async move {
    run_attempt(app_handle, manager, id, control).await;
  });
  Ok(())
}

/// Runs all setup, yt-dlp process supervision, file moves, and final state persistence for one attempt.
async fn run_attempt(
  app_handle: AppHandle,
  manager: DownloadManager,
  id: String,
  control: DownloadControl,
) {
  let result = run_attempt_inner(&app_handle, &manager, &id, &control).await;
  if let Err(error) = result {
    finalize_worker_error(&app_handle, &manager, &id, &control, error);
  }
  manager.release_attempt(&id);
}

/// Executes one attempt while ensuring user-requested stop actions never become false failures.
async fn run_attempt_inner(
  app_handle: &AppHandle,
  manager: &DownloadManager,
  id: &str,
  control: &DownloadControl,
) -> Result<(), String> {
  update_job(app_handle, manager, id, |job| {
    job.status = DownloadStatus::Preparing;
    job.title = "Preparing download...".to_string();
    job.speed = "Preparing".to_string();
    job.eta = "—".to_string();
    Ok(())
  })?;
  // Check immediately after each potentially long setup step. A Pause/Cancel
  // sent while binaries are installing must prevent yt-dlp from spawning later.
  finish_before_spawn_if_stopped(app_handle, manager, id, control)?;

  let download_dir = ensure_download_directory(app_handle, manager, id)?;
  let ytdlp_path = ensure_ytdlp_installed(app_handle, id).await?;
  finish_before_spawn_if_stopped(app_handle, manager, id, control)?;
  let bin_dir = app_handle
    .path()
    .app_data_dir()
    .map_err(|error| format!("Failed to resolve app data directory: {error}"))?
    .join("bin");
  ensure_ffmpeg_installed(app_handle, id).await?;
  finish_before_spawn_if_stopped(app_handle, manager, id, control)?;

  let job = manager
    .get(id)
    .ok_or_else(|| "Download was not found.".to_string())?;
  let staging_dir = manager.staging_dir(app_handle, id)?;
  tokio::fs::create_dir_all(&staging_dir)
    .await
    .map_err(|error| format!("Failed to create private download staging directory: {error}"))?;
  let mut command = Command::new(ytdlp_path);
  // Dropping the Tokio runtime during an app exit must not leave yt-dlp running
  // in the background without a Navio process to report its final state.
  command.kill_on_drop(true);
  if detect_node_js_runtime().await {
    command.arg("--js-runtimes").arg("node");
  }
  command
    .arg(&job.request.url)
    .arg("-f")
    .arg(&job.request.format)
    .arg(if job.request.no_playlist { "--no-playlist" } else { "--yes-playlist" })
    .arg("--continue")
    .arg("--paths")
    .arg(format!("home:{}", staging_dir.to_string_lossy()))
    .arg("--paths")
    .arg(format!("temp:{}", staging_dir.to_string_lossy()))
    .arg("--output")
    .arg("%(title)s [%(id)s].%(ext)s")
    .arg("--ffmpeg-location")
    .arg(bin_dir)
    .arg("--newline")
    .arg("--concurrent-fragments")
    .arg("3")
    .arg("--progress-template")
    // Normal yt-dlp console output is presentation text and can change between
    // releases. This fixed marker is the only progress shape Navio parses.
    .arg("download:NAVIO_PROGRESS:%(info.title)s\t%(progress._percent_str)s\t%(progress._speed_str)s\t%(progress._eta_str)s\t%(progress._total_bytes_str)s\t%(info.playlist_index)s\t%(info.n_entries)s")
    // `--print` may quiet ordinary output; force the structured progress template to stay enabled.
    .arg("--progress")
    .arg("--print")
    .arg("after_move:NAVIO_FILE:%(filepath)s")
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

  let mut child = command
    .spawn()
    .map_err(|error| format!("Could not start yt-dlp: {error}"))?;
  let stdout = child
    .stdout
    .take()
    .ok_or_else(|| "Could not read yt-dlp progress output.".to_string())?;
  let stderr = child
    .stderr
    .take()
    .ok_or_else(|| "Could not read yt-dlp diagnostic output.".to_string())?;
  control.attach_child(child).await;
  update_job(app_handle, manager, id, |job| {
    job.status = DownloadStatus::Downloading;
    job.speed = "Starting...".to_string();
    Ok(())
  })?;

  let stderr_task = tauri::async_runtime::spawn(collect_stderr(stderr));
  read_markers(app_handle, manager, id, stdout).await?;
  let status = control.wait_for_child().await?;
  let last_error = stderr_task.await.unwrap_or_else(|_| String::new());
  match control.action() {
    // The stop command already persisted `paused`/`cancelled`; do not overwrite
    // that deliberate outcome with yt-dlp's non-zero exit code after termination.
    StopAction::Pause => Ok(()),
    StopAction::Cancel => {
      remove_staging_directory(manager.staging_dir(app_handle, id)?)?;
      Ok(())
    }
    StopAction::Exit => Ok(()),
    StopAction::None if status.success() => {
      // Files become visible in the user's Downloads folder only after a fully
      // successful process exit. Failed playlist attempts keep every staged
      // file in place so a retry can continue rather than duplicate content.
      let completed_paths = move_completed_media(&staging_dir, &download_dir)?;
      if completed_paths.is_empty() {
        return Err("yt-dlp finished without producing a media file.".to_string());
      }
      update_job(app_handle, manager, id, |job| {
        job.status = DownloadStatus::Completed;
        job.progress = 100.0;
        job.speed = "Finished".to_string();
        job.eta = "00:00".to_string();
        job.error = None;
        job.completed_paths = completed_paths;
        Ok(())
      })?;
      remove_staging_directory(staging_dir)?;
      if let Err(error) = app_handle.emit("library-updated", ()) {
        eprintln!("[Navio Event] failed to emit library-updated: {error}");
      }
      Ok(())
    }
    StopAction::None => Err(if last_error.is_empty() {
      format!("yt-dlp exited with status {status}.")
    } else {
      last_error
    }),
  }
}

/// Updates a record, writes it atomically, and broadcasts the exact persisted result.
fn update_job<F>(
  app_handle: &AppHandle,
  manager: &DownloadManager,
  id: &str,
  update: F,
) -> Result<DownloadJob, String>
where
  F: FnOnce(&mut DownloadJob) -> Result<(), String>,
{
  let job = manager.update(id, update)?;
  // `DownloadManager::update` has synchronously completed its atomic write;
  // emitting afterwards keeps every renderer aligned with durable state.
  emit_download_update(app_handle, &job);
  Ok(job)
}

/// Finalizes setup/process errors unless a user action already selected the terminal state.
fn finalize_worker_error(
  app_handle: &AppHandle,
  manager: &DownloadManager,
  id: &str,
  control: &DownloadControl,
  error: String,
) {
  if control.action() != StopAction::None {
    if control.action() == StopAction::Cancel {
      if let Ok(staging_dir) = manager.staging_dir(app_handle, id) {
        if let Err(cleanup_error) = remove_staging_directory(staging_dir) {
          eprintln!(
            "[Navio Downloader] failed to remove cancelled staging directory: {cleanup_error}"
          );
        }
      }
    }
    return;
  }
  let diagnostic = normalize_error(&error);
  // Preserve the final yt-dlp diagnostic for a retryable failure instead of
  // replacing it with a generic title that gives the user nothing to act on.
  if let Ok(job) = manager.update(id, |job| {
    job.status = DownloadStatus::Failed;
    job.speed = "Failed".to_string();
    job.eta = "—".to_string();
    job.error = Some(diagnostic.clone());
    Ok(())
  }) {
    emit_download_update(app_handle, &job);
  }
}

/// Resolves a pause/cancel received while tools were still being prepared.
fn finish_before_spawn_if_stopped(
  app_handle: &AppHandle,
  manager: &DownloadManager,
  id: &str,
  control: &DownloadControl,
) -> Result<(), String> {
  match control.action() {
    StopAction::None => Ok(()),
    StopAction::Pause | StopAction::Exit => {
      Err("Download stopped before yt-dlp started.".to_string())
    }
    StopAction::Cancel => {
      remove_staging_directory(manager.staging_dir(app_handle, id)?)?;
      Err("Download was cancelled before yt-dlp started.".to_string())
    }
  }
}

/// Reads only Navio's structured yt-dlp markers and ignores unrelated presentation output.
async fn read_markers(
  app_handle: &AppHandle,
  manager: &DownloadManager,
  id: &str,
  stdout: tokio::process::ChildStdout,
) -> Result<(), String> {
  let mut reader = BufReader::new(stdout).lines();
  while let Some(line) = reader
    .next_line()
    .await
    .map_err(|error| format!("Failed to read yt-dlp output: {error}"))?
  {
    if let Some(update) = parse_progress_marker(&line) {
      update_job(app_handle, manager, id, |job| {
        job.title = update.title;
        job.progress = update.progress;
        job.speed = update.speed;
        job.eta = update.eta;
        job.size = update.size;
        job.current_item = update.current_item;
        job.total_items = update.total_items;
        Ok(())
      })?;
    }
  }
  Ok(())
}

/// Collects yt-dlp diagnostics without exposing the raw stream to the renderer.
async fn collect_stderr(stderr: tokio::process::ChildStderr) -> String {
  let mut reader = BufReader::new(stderr).lines();
  let mut last_error = String::new();
  while let Ok(Some(line)) = reader.next_line().await {
    if !line.trim().is_empty() {
      last_error = line;
    }
  }
  last_error
}

/// Parsed form of Navio's fixed yt-dlp progress template.
struct ProgressUpdate {
  title: String,
  progress: f32,
  speed: String,
  eta: String,
  size: String,
  current_item: Option<u32>,
  total_items: Option<u32>,
}

/// Parses a machine-owned tab-delimited marker, never a human-readable yt-dlp progress line.
fn parse_progress_marker(line: &str) -> Option<ProgressUpdate> {
  let marker = line.find(PROGRESS_PREFIX)?;
  // The marker may still be prefixed by yt-dlp's logging label, so locate it
  // rather than requiring it to start at byte zero.
  let fields = line[marker + PROGRESS_PREFIX.len()..]
    .split('\t')
    .map(str::trim)
    .collect::<Vec<_>>();
  if fields.len() != 7 {
    return None;
  }
  let progress = fields[1]
    .trim_end_matches('%')
    .parse::<f32>()
    .ok()?
    .clamp(0.0, 100.0);
  Some(ProgressUpdate {
    title: fields[0].to_string(),
    progress,
    speed: empty_marker(fields[2], "—"),
    eta: empty_marker(fields[3], "—"),
    size: empty_marker(fields[4], "—"),
    current_item: fields[5].parse().ok(),
    total_items: fields[6].parse().ok(),
  })
}

/// Replaces yt-dlp's empty `NA`-style fields with a stable UI placeholder.
fn empty_marker(value: &str, fallback: &str) -> String {
  if value.is_empty() || value.eq_ignore_ascii_case("na") {
    fallback.to_string()
  } else {
    value.to_string()
  }
}

/// Keeps the user download directory authorized and watched exactly as the previous downloader did.
fn ensure_download_directory(
  app_handle: &AppHandle,
  manager: &DownloadManager,
  id: &str,
) -> Result<PathBuf, String> {
  let download_dir = app_handle
    .path()
    .download_dir()
    .map_err(|error| error.to_string())?
    .join("Navio Player");
  fs::create_dir_all(&download_dir)
    .map_err(|error| format!("Failed to create download folder: {error}"))?;
  let state = app_handle.state::<AppState>();
  state
    .allowed_directories
    .lock()
    .expect("allowed directory lock poisoned")
    .insert(download_dir.clone());
  if let Ok(mut database) = library::load_db(app_handle) {
    let value = download_dir.to_string_lossy().to_string();
    if !database.scanned_directories.contains(&value) {
      database.scanned_directories.push(value);
      if let Some(watcher) = state
        .watcher
        .lock()
        .expect("watcher lock poisoned")
        .as_mut()
      {
        use notify::Watcher;
        let _ = watcher.watch(&download_dir, notify::RecursiveMode::Recursive);
      }
      library::save_db(app_handle, &database)?;
    }
  }
  update_job(app_handle, manager, id, |job| {
    job.title = "Preparing download tools...".to_string();
    job.speed = "Preparing".to_string();
    Ok(())
  })?;
  Ok(download_dir)
}

/// Moves all completed regular files out of an isolated attempt directory only after yt-dlp succeeds.
fn move_completed_media(staging_dir: &Path, download_dir: &Path) -> Result<Vec<String>, String> {
  let mut files = Vec::new();
  collect_completed_files(staging_dir, &mut files)?;
  let mut moved = Vec::new();
  for source in files {
    let filename = source
      .file_name()
      .ok_or_else(|| "Completed download has no file name.".to_string())?;
    let target = download_dir.join(filename);
    if target.exists() {
      // The output template includes the remote media ID, but keep this guard
      // because finalization must never replace a user-owned local file.
      return Err(format!(
        "Refusing to overwrite existing file: {}",
        target.display()
      ));
    }
    fs::rename(&source, &target)
      .map_err(|error| format!("Failed to finalize downloaded media: {error}"))?;
    moved.push(target.to_string_lossy().to_string());
  }
  Ok(moved)
}

/// Recursively selects media outputs while excluding yt-dlp resume and temporary artifacts.
fn collect_completed_files(directory: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
  for entry in fs::read_dir(directory)
    .map_err(|error| format!("Failed to read download staging directory: {error}"))?
  {
    let path = entry
      .map_err(|error| format!("Failed to inspect staged download: {error}"))?
      .path();
    if path.is_dir() {
      collect_completed_files(&path, files)?;
    } else if is_completed_media(&path) {
      files.push(path);
    }
  }
  Ok(())
}

/// Restricts finalization to common local media formats rather than auxiliary yt-dlp files.
fn is_completed_media(path: &Path) -> bool {
  let Some(extension) = path.extension().and_then(OsStr::to_str) else {
    return false;
  };
  matches!(
    extension.to_ascii_lowercase().as_str(),
    "mp4"
      | "mkv"
      | "webm"
      | "mov"
      | "avi"
      | "m4v"
      | "mp3"
      | "m4a"
      | "aac"
      | "opus"
      | "ogg"
      | "flac"
      | "wav"
  )
}

/// Removes only Navio's own private staging directory after cancellation or success.
fn remove_staging_directory(staging_dir: PathBuf) -> Result<(), String> {
  // The caller obtains this path exclusively through DownloadManager; no path
  // originating from the renderer can reach this recursive deletion.
  if staging_dir.exists() {
    fs::remove_dir_all(&staging_dir)
      .map_err(|error| format!("Failed to remove partial download files: {error}"))?;
  }
  Ok(())
}

/// Reduces raw tool diagnostics to one safe, useful renderer message.
fn normalize_error(error: &str) -> String {
  error
    .lines()
    .rev()
    .find(|line| !line.trim().is_empty())
    .unwrap_or("Download failed for an unknown reason.")
    .trim()
    .chars()
    .take(500)
    .collect()
}

/// Rejects malformed IDs and unsupported UI formats before they reach file/process boundaries.
fn validate_start_request(id: &str, url: &str, format: &str) -> Result<(), String> {
  if uuid::Uuid::parse_str(id).is_err() {
    return Err("Invalid download ID.".to_string());
  }
  reqwest::Url::parse(url).map_err(|_| "Enter a valid download URL.".to_string())?;
  if !matches!(format, "best" | "bestaudio") {
    return Err("Unsupported download format.".to_string());
  }
  Ok(())
}

/// Tauri command that identifies playlist links without contacting a remote service.
#[derive(serde::Serialize)]
pub struct UrlTypeInfo {
  pub is_playlist: bool,
  pub has_video: bool,
}

/// Classifies a URL only to choose between single-video and playlist UX.
#[tauri::command]
pub fn check_url_type(url: String) -> Result<UrlTypeInfo, String> {
  let mut is_playlist = false;
  let mut has_video = false;
  if let Ok(parsed) = reqwest::Url::parse(&url) {
    let host = parsed.host_str().unwrap_or("");
    if host.contains("youtube.com") || host.contains("youtu.be") {
      has_video = host.contains("youtu.be") && !parsed.path().trim_start_matches('/').is_empty();
      for (key, _) in parsed.query_pairs() {
        is_playlist |= key == "list";
        has_video |= key == "v";
      }
    } else {
      let path = parsed.path().to_lowercase();
      is_playlist = ["/playlist/", "/album/", "/set/", "/sets/"]
        .iter()
        .any(|part| path.contains(part));
      has_video = !is_playlist;
    }
  }
  Ok(UrlTypeInfo {
    is_playlist,
    has_video,
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn parses_structured_progress_marker_without_human_output_regexes() {
    let update =
      parse_progress_marker("NAVIO_PROGRESS:Example title\t42.5%\t2.0MiB/s\t00:12\t15.0MiB\t2\t8")
        .expect("marker should parse");
    assert_eq!(update.title, "Example title");
    assert_eq!(update.progress, 42.5);
    assert_eq!(update.current_item, Some(2));
    assert_eq!(update.total_items, Some(8));
  }
}
