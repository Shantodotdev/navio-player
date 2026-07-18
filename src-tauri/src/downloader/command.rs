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
use tokio::io::AsyncBufRead;

const PROGRESS_PREFIX: &str = "NAVIO_PROGRESS:";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Renderer-owned values accepted when creating a new universal download.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDownloadArgs {
  id: String,
  url: String,
  format: DownloadFormat,
  no_playlist: Option<bool>,
  quality: Option<DownloadQuality>,
  video_container: Option<VideoContainer>,
  audio_format: Option<AudioFormat>,
  subtitle_mode: Option<SubtitleMode>,
  subtitle_languages: Option<Vec<String>>,
  playlist_start: Option<u32>,
  playlist_end: Option<u32>,
}

/// Tauri command that creates and starts one new durable download job.
#[tauri::command]
pub async fn start_download(
  request: StartDownloadArgs,
  app_handle: AppHandle,
  state: tauri::State<'_, AppState>,
) -> Result<(), String> {
  let id = request.id;
  let request = DownloadRequest {
    url: request.url,
    format: request.format,
    no_playlist: request.no_playlist.unwrap_or(true),
    quality: request.quality.unwrap_or_default(),
    video_container: request.video_container.unwrap_or_default(),
    audio_format: request.audio_format.unwrap_or_default(),
    subtitle_mode: request.subtitle_mode.unwrap_or_default(),
    subtitle_languages: request.subtitle_languages.unwrap_or_default(),
    playlist_start: request.playlist_start,
    playlist_end: request.playlist_end,
  };
  validate_start_request(&id, &request)?;
  let job = state.download_manager.create(id, request)?;
  if !job.request.no_playlist {
    if let Err(error) = create_download_playlist(&app_handle, &job.id) {
      update_job(&app_handle, &state.download_manager, &job.id, |job| {
        job.status = DownloadStatus::Failed;
        job.speed = "Failed".to_string();
        job.error = Some(error.clone());
        Ok(())
      })?;
      return Err(error);
    }
    if let Err(error) = app_handle.emit("library-updated", ()) {
      eprintln!("[Navio Event] failed to emit library-updated: {error}");
    }
  }
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
  let selected_format = format_selector(&job.request);
  let staging_dir = manager.staging_dir(app_handle, id)?;
  tokio::fs::create_dir_all(&staging_dir)
    .await
    .map_err(|error| format!("Failed to create private download staging directory: {error}"))?;
  let mut command = Command::new(ytdlp_path);
  // Release builds are GUI processes, but Windows gives console-subsystem child
  // executables their own terminal unless CREATE_NO_WINDOW is explicitly set.
  hide_console_window(&mut command);
  // Dropping the Tokio runtime during an app exit must not leave yt-dlp running
  // in the background without a Navio process to report its final state.
  command.kill_on_drop(true);
  if detect_node_js_runtime().await {
    command.arg("--js-runtimes").arg("node");
  }
  command
    // Navio owns the request contract. Ignoring user/global yt-dlp config files
    // prevents an unrelated `-f`, postprocessor, or output-path rule from
    // changing the queue's persisted behavior or producing opaque failures.
    .arg("--ignore-config")
    .args(YTDLP_OUTPUT_ENCODING_ARGS)
    .arg("-f")
    .arg(&selected_format)
    .arg(if job.request.no_playlist { "--no-playlist" } else { "--yes-playlist" })
    .arg("--continue")
    .arg("--paths")
    .arg(format!("home:{}", staging_dir.to_string_lossy()))
    .arg("--paths")
    .arg(format!("temp:{}", staging_dir.to_string_lossy()))
    .arg("--output")
    .arg("%(title)s.%(ext)s")
    .arg("--ffmpeg-location")
    .arg(bin_dir)
    .arg("--newline")
    .arg("--concurrent-fragments")
    .arg("3")
    .arg("--progress-template")
    // Normal yt-dlp console output is presentation text and can change between
    // releases. This fixed marker is the only progress shape Navio parses.
    .arg("download:NAVIO_PROGRESS:%(info.title)s\t%(progress._percent_str)s\t%(progress._speed_str)s\t%(progress._eta_str)s\t%(progress._total_bytes_str)s\t%(info.playlist_index)s\t%(info.n_entries)s\t%(info.format_id)s\t%(info.requested_formats.1.format_id)s")
    // `--print` may quiet ordinary output; force the structured progress template to stay enabled.
    .arg("--progress")
    .arg("--print")
    .arg("after_move:NAVIO_FILE:%(filepath)s\t%(playlist_title)s");
  command.args(build_ytdlp_options(&job.request));
  if !job.request.no_playlist {
    // The archive persists beside partial files so resume never re-downloads
    // items Navio already moved into the visible playlist.
    command
      .arg("--download-archive")
      .arg(staging_dir.join(".navio-completed.txt"));
  }
  command
    // Keep the URL after every option. It prevents extractors from treating
    // subsequent command arguments as independent download targets.
    .arg(&job.request.url)
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

  println!(
    "[Navio Downloader] launching yt-dlp | id={} mode={:?} selector={}",
    id, job.request.format, selected_format
  );

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
  let output = read_markers(
    app_handle,
    manager,
    id,
    stdout,
    &staging_dir,
    &download_dir,
    !job.request.no_playlist,
  )
  .await?;
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
      let mut completed_paths = output.completed_paths;
      let remaining_paths = move_completed_media(&staging_dir, &download_dir, &[])?;
      if !job.request.no_playlist {
        for path in &remaining_paths {
          append_downloaded_playlist_track(app_handle, id, output.playlist_title.as_deref(), path)?;
        }
      }
      completed_paths.extend(remaining_paths);
      if completed_paths.is_empty() {
        return Err("yt-dlp finished without producing a media file.".to_string());
      }
      // Progress output describes one currently transferred stream. High-quality
      // video downloads commonly finish with a small audio stream, so derive the
      // completed card's size from the finalized media files instead.
      let completed_size = format_bytes(total_completed_media_bytes(&completed_paths)?);
      update_job(app_handle, manager, id, |job| {
        job.status = DownloadStatus::Completed;
        job.progress = 100.0;
        job.speed = "Finished".to_string();
        job.eta = "00:00".to_string();
        job.size = completed_size;
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

/// Reads Navio's markers and finalizes playlist items as yt-dlp completes them.
async fn read_markers(
  app_handle: &AppHandle,
  manager: &DownloadManager,
  id: &str,
  stdout: tokio::process::ChildStdout,
  staging_dir: &Path,
  download_dir: &Path,
  is_playlist_download: bool,
) -> Result<DownloadOutput, String> {
  let mut reader = BufReader::new(stdout);
  let mut line_buffer = Vec::new();
  let mut output = DownloadOutput::default();
  let mut progress_accumulator = ProgressAccumulator::default();
  while let Some(line) = read_lossy_line(&mut reader, &mut line_buffer)
    .await
    .map_err(|error| format!("Failed to read yt-dlp output: {error}"))?
  {
    if let Some(update) = parse_progress_marker(&line) {
      let aggregate_progress = progress_accumulator.aggregate(&update);
      update_job(app_handle, manager, id, |job| {
        job.title = update.title;
        job.progress = aggregate_progress;
        job.speed = update.speed;
        job.eta = update.eta;
        job.size = update.size;
        job.current_item = update.current_item;
        job.total_items = update.total_items;
        Ok(())
      })?;
    } else if let Some(file) = parse_file_marker(&line) {
      if output.playlist_title.is_none() {
        output.playlist_title = file.playlist_title.clone();
      }
      if is_playlist_download && is_staged_completed_media(staging_dir, &file.path) {
        let completed_path = move_completed_file(&file.path, download_dir)?;
        append_downloaded_playlist_track(
          app_handle,
          id,
          file.playlist_title.as_deref(),
          &completed_path,
        )?;
        update_job(app_handle, manager, id, |job| {
          if !job.completed_paths.contains(&completed_path) {
            job.completed_paths.push(completed_path.clone());
          }
          Ok(())
        })?;
        if let Err(error) = app_handle.emit("library-updated", ()) {
          eprintln!("[Navio Event] failed to emit library-updated: {error}");
        }
        output.completed_paths.push(completed_path);
      }
    }
  }
  Ok(output)
}

/// Collects yt-dlp diagnostics without exposing the raw stream to the renderer.
async fn collect_stderr(stderr: tokio::process::ChildStderr) -> String {
  let mut reader = BufReader::new(stderr);
  let mut line_buffer = Vec::new();
  let mut last_error = String::new();
  while let Ok(Some(line)) = read_lossy_line(&mut reader, &mut line_buffer).await {
    if !line.trim().is_empty() {
      last_error = line;
    }
  }
  last_error
}

/// Reads one external-process line without trusting the child to emit valid UTF-8.
async fn read_lossy_line<R>(reader: &mut R, buffer: &mut Vec<u8>) -> std::io::Result<Option<String>>
where
  R: AsyncBufRead + Unpin,
{
  buffer.clear();
  if reader.read_until(b'\n', buffer).await? == 0 {
    return Ok(None);
  }
  if buffer.last() == Some(&b'\n') {
    buffer.pop();
  }
  if buffer.last() == Some(&b'\r') {
    buffer.pop();
  }
  Ok(Some(String::from_utf8_lossy(buffer).into_owned()))
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
  stream_id: String,
  stream_count: u32,
}

/// Per-job state that turns yt-dlp's per-stream percentages into one monotonic percentage.
#[derive(Default)]
struct ProgressAccumulator {
  current_item: Option<u32>,
  stream_ids: Vec<String>,
  last_stream_id: Option<String>,
  last_stream_progress: f32,
  last_progress: f32,
}

impl ProgressAccumulator {
  /// Aggregates video/audio streams and playlist items without allowing backward movement.
  fn aggregate(&mut self, update: &ProgressUpdate) -> f32 {
    if self.current_item != update.current_item {
      self.current_item = update.current_item;
      self.stream_ids.clear();
      self.last_stream_id = None;
      self.last_stream_progress = 0.0;
    }

    let mut stream_id = update.stream_id.clone();
    if self.last_stream_id.as_deref() == Some(stream_id.as_str())
      && update.progress < self.last_stream_progress
      && self.stream_ids.len() < update.stream_count as usize
    {
      stream_id = format!("{}#{}", stream_id, self.stream_ids.len() + 1);
    }
    let stream_index = self
      .stream_ids
      .iter()
      .position(|existing| existing == &stream_id)
      .unwrap_or_else(|| {
        self.stream_ids.push(stream_id.clone());
        self.stream_ids.len() - 1
      });
    self.last_stream_id = Some(stream_id);
    self.last_stream_progress = update.progress;

    let stream_count = (update.stream_count as usize)
      .max(self.stream_ids.len())
      .max(1);
    let item_progress = (stream_index as f32 + update.progress / 100.0) / stream_count as f32;
    let aggregate = match (update.current_item, update.total_items) {
      (Some(current), Some(total)) if total > 0 => {
        ((current.saturating_sub(1) as f32 + item_progress) / total as f32) * 100.0
      }
      _ => item_progress * 100.0,
    }
    .clamp(0.0, 100.0);
    self.last_progress = self.last_progress.max(aggregate);
    self.last_progress
  }
}

/// Ordered media output reported by yt-dlp after each item's post-processing completes.
#[derive(Default)]
struct DownloadOutput {
  playlist_title: Option<String>,
  completed_paths: Vec<String>,
}

/// A single completed-file marker with optional source playlist metadata.
struct DownloadedFile {
  path: PathBuf,
  playlist_title: Option<String>,
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
  if fields.len() != 9 {
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
    stream_id: empty_marker(fields[7], "default"),
    stream_count: if fields[8].is_empty() || fields[8].eq_ignore_ascii_case("na") {
      1
    } else {
      2
    },
  })
}

/// Parses Navio's post-move file marker without relying on yt-dlp presentation output.
fn parse_file_marker(line: &str) -> Option<DownloadedFile> {
  const FILE_PREFIX: &str = "NAVIO_FILE:";
  let marker = line.find(FILE_PREFIX)?;
  let (path, playlist_title) = line[marker + FILE_PREFIX.len()..].split_once('\t')?;
  let path = PathBuf::from(path.trim());
  if path.as_os_str().is_empty() {
    return None;
  }
  let playlist_title = match playlist_title.trim() {
    "" | "NA" => None,
    title => Some(title.to_string()),
  };
  Some(DownloadedFile {
    path,
    playlist_title,
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
  let download_dir = crate::settings::load_db(app_handle)?
    .downloads
    .folder
    .map(PathBuf::from)
    .unwrap_or(
      app_handle
        .path()
        .download_dir()
        .map_err(|error| error.to_string())?
        .join("Navio Player"),
    );
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

/// Moves completed media out of the staging directory in yt-dlp's playlist order.
fn move_completed_media(
  staging_dir: &Path,
  download_dir: &Path,
  ordered_files: &[PathBuf],
) -> Result<Vec<String>, String> {
  let mut files = ordered_files
    .iter()
    .filter(|path| is_staged_completed_media(staging_dir, path))
    .fold(Vec::new(), |mut files, path| {
      if !files.contains(path) {
        files.push(path.clone());
      }
      files
    });
  // Older yt-dlp versions may omit `after_move` markers. Continue supporting
  // those downloads, although only marker-backed jobs can retain playlist order.
  if files.is_empty() {
    collect_completed_files(staging_dir, &mut files)?;
  }
  let mut moved = Vec::new();
  for source in files {
    moved.push(move_completed_file(&source, download_dir)?);
  }
  Ok(moved)
}

/// Moves one marker-confirmed media file into the user-visible downloads directory.
fn move_completed_file(source: &Path, download_dir: &Path) -> Result<String, String> {
  let filename = source
    .file_name()
    .ok_or_else(|| "Completed download has no file name.".to_string())?;
  let target = available_target_path(download_dir, filename);
  move_file_with_cross_drive_fallback(source, &target, |from, to| fs::rename(from, to))
    .map_err(|error| format!("Failed to finalize downloaded media: {error}"))?;
  Ok(target.to_string_lossy().to_string())
}

/// Accepts only finalized media files contained in Navio's private staging directory.
fn is_staged_completed_media(staging_dir: &Path, path: &Path) -> bool {
  path.starts_with(staging_dir) && path.is_file() && is_completed_media(path)
}

/// Creates the immediately visible playlist record for a newly queued playlist download.
fn create_download_playlist(app_handle: &AppHandle, playlist_id: &str) -> Result<(), String> {
  let mut db = crate::playlists::load_db(app_handle)?;
  if db
    .playlists
    .iter()
    .any(|playlist| playlist.id == playlist_id)
  {
    return Ok(());
  }
  let name = available_playlist_name(&db, "Downloading playlist", None);
  db.playlists.push(crate::playlists::Playlist {
    id: playlist_id.to_string(),
    name,
    tracks: Vec::new(),
  });
  crate::playlists::save_db(app_handle, &db)
}

/// Appends a completed media item and source title to its visible Navio playlist.
fn append_downloaded_playlist_track(
  app_handle: &AppHandle,
  playlist_id: &str,
  playlist_title: Option<&str>,
  completed_path: &str,
) -> Result<(), String> {
  let cache_dir = app_handle
    .path()
    .app_cache_dir()
    .map_err(|error| format!("Failed to resolve application cache directory: {error}"))?;
  let track = playlist_track_from_download(completed_path, &cache_dir)?;
  let mut db = crate::playlists::load_db(app_handle)?;
  let requested_name = playlist_title
    .filter(|title| !title.trim().is_empty())
    .unwrap_or("Downloading playlist");
  let name = available_playlist_name(&db, requested_name, Some(playlist_id));
  let playlist = db
    .playlists
    .iter_mut()
    .find(|playlist| playlist.id == playlist_id)
    .ok_or_else(|| {
      "The playlist download was removed before its item was finalized.".to_string()
    })?;
  playlist.name = name;
  if !playlist.tracks.iter().any(|item| item.path == track.path) {
    playlist.tracks.push(track);
  }
  crate::playlists::save_db(app_handle, &db)
}

/// Builds a playable snapshot even when a downloaded format has no metadata reader.
fn playlist_track_from_download(
  path: &str,
  cache_dir: &Path,
) -> Result<crate::library::MediaItem, String> {
  if let Some(track) = crate::library::process_media_file(Path::new(path), cache_dir) {
    return Ok(track);
  }

  let media_path = Path::new(path);
  let extension = media_path
    .extension()
    .and_then(OsStr::to_str)
    .map(str::to_ascii_lowercase)
    .ok_or_else(|| format!("Downloaded media has no file extension: {path}"))?;
  let media_type = match extension.as_str() {
    "mp3" | "m4a" | "aac" | "opus" | "ogg" | "flac" | "wav" => "audio",
    "mp4" | "mkv" | "webm" | "mov" | "avi" | "m4v" => "video",
    _ => return Err(format!("Unsupported downloaded media format: {path}")),
  };
  let name = media_path
    .file_name()
    .and_then(OsStr::to_str)
    .ok_or_else(|| format!("Downloaded media has no file name: {path}"))?;
  let file_size_bytes = fs::metadata(media_path)
    .map_err(|error| format!("Failed to inspect downloaded media: {error}"))?
    .len();
  Ok(crate::library::MediaItem {
    id: format!("download-{}", uuid::Uuid::new_v4()),
    path: path.to_string(),
    name: name.to_string(),
    title: None,
    duration_secs: 0.0,
    file_size_bytes,
    media_type: media_type.to_string(),
    cover_cache_path: None,
  })
}

/// Produces a readable, unique name when a downloaded source matches an existing playlist.
fn available_playlist_name(
  db: &crate::playlists::PlaylistsDb,
  requested_name: &str,
  excluded_playlist_id: Option<&str>,
) -> String {
  let base_name = requested_name.trim();
  let base_name = if base_name.is_empty() {
    "Downloaded playlist"
  } else {
    base_name
  };
  if !db.playlists.iter().any(|playlist| {
    Some(playlist.id.as_str()) != excluded_playlist_id
      && playlist.name.eq_ignore_ascii_case(base_name)
  }) {
    return base_name.to_string();
  }
  let mut suffix = 2_u32;
  loop {
    let candidate = format!("{base_name} ({suffix})");
    if !db.playlists.iter().any(|playlist| {
      Some(playlist.id.as_str()) != excluded_playlist_id
        && playlist.name.eq_ignore_ascii_case(&candidate)
    }) {
      return candidate;
    }
    suffix = suffix.saturating_add(1);
  }
}

/// Returns an unused sibling path by adding the familiar ` (1)`, ` (2)` suffix.
fn available_target_path(directory: &Path, filename: &OsStr) -> PathBuf {
  let requested = directory.join(filename);
  if !requested.exists() {
    return requested;
  }

  let filename_path = Path::new(filename);
  let original_stem = filename_path
    .file_stem()
    .unwrap_or(filename)
    .to_string_lossy();
  let extension = filename_path.extension().and_then(OsStr::to_str);
  let stem = numeric_copy_base(&original_stem)
    .filter(|base| {
      let base_filename = match extension {
        Some(extension) => format!("{base}.{extension}"),
        None => (*base).to_string(),
      };
      directory.join(base_filename).exists()
    })
    .unwrap_or(&original_stem);
  let mut index = 1_u32;
  loop {
    let candidate_name = match extension {
      Some(extension) => format!("{stem} ({index}).{extension}"),
      None => format!("{stem} ({index})"),
    };
    let candidate = directory.join(candidate_name);
    if !candidate.exists() {
      return candidate;
    }
    index = index.saturating_add(1);
  }
}

/// Returns the unsuffixed stem when a filename ends in a numeric copy marker.
fn numeric_copy_base(stem: &str) -> Option<&str> {
  let without_closing = stem.strip_suffix(')')?;
  let (base, suffix) = without_closing.rsplit_once(" (")?;
  (!base.is_empty()
    && !suffix.is_empty()
    && suffix.chars().all(|character| character.is_ascii_digit()))
  .then_some(base)
}

/// Moves a completed file, copying it first when the destination is on another volume.
fn move_file_with_cross_drive_fallback<F>(
  source: &Path,
  target: &Path,
  rename: F,
) -> std::io::Result<()>
where
  F: FnOnce(&Path, &Path) -> std::io::Result<()>,
{
  match rename(source, target) {
    Ok(()) => Ok(()),
    Err(error) if error.raw_os_error() == Some(17) => {
      fs::copy(source, target)?;
      fs::remove_file(source)
    }
    Err(error) => Err(error),
  }
}

/// Returns the combined byte size of every finalized media file in one completed job.
///
/// A playlist can move more than one file. Summing the final paths, rather than
/// reusing yt-dlp's last progress line, reports the total user-visible result
/// after FFmpeg merging has completed.
fn total_completed_media_bytes(paths: &[String]) -> Result<u64, String> {
  paths.iter().try_fold(0_u64, |total, path| {
    let size = fs::metadata(path)
      .map_err(|error| format!("Failed to inspect finalized downloaded media: {error}"))?
      .len();
    total
      .checked_add(size)
      .ok_or_else(|| "Finalized download size exceeded Navio's supported range.".to_string())
  })
}

/// Formats a byte count using binary units for the downloader's completed-size label.
fn format_bytes(bytes: u64) -> String {
  const UNITS: [&str; 5] = ["B", "KiB", "MiB", "GiB", "TiB"];
  let mut value = bytes as f64;
  let mut unit_index = 0;
  while value >= 1024.0 && unit_index < UNITS.len() - 1 {
    value /= 1024.0;
    unit_index += 1;
  }
  if unit_index == 0 {
    format!("{bytes} B")
  } else {
    format!("{value:.1} {}", UNITS[unit_index])
  }
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
fn validate_start_request(id: &str, request: &DownloadRequest) -> Result<(), String> {
  if uuid::Uuid::parse_str(id).is_err() {
    return Err("Invalid download ID.".to_string());
  }
  super::inspection::validate_public_media_url(&request.url)?;
  if request.playlist_start == Some(0) || request.playlist_end == Some(0) {
    return Err("Collection item numbers must start at 1.".to_string());
  }
  if let (Some(start), Some(end)) = (request.playlist_start, request.playlist_end) {
    if start > end {
      return Err("Collection start must not be after its end.".to_string());
    }
  }
  if request.subtitle_languages.len() > 12
    || request.subtitle_languages.iter().any(|language| {
      language.is_empty()
        || language.len() > 16
        || !language
          .chars()
          .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    })
  {
    return Err("Unsupported subtitle language selection.".to_string());
  }
  if request.subtitle_mode == SubtitleMode::Selected && request.subtitle_languages.is_empty() {
    return Err("Select at least one subtitle language.".to_string());
  }
  if request.format == DownloadFormat::Bestaudio && request.subtitle_mode != SubtitleMode::None {
    return Err("Subtitles are available only for video downloads.".to_string());
  }
  Ok(())
}

/// Maps Navio's two UI modes to explicit yt-dlp format-selection expressions.
///
/// `best` in yt-dlp means the best *single* audio+video file. YouTube commonly
/// provides that only at a lower resolution, while 4K and other high-quality
/// formats are separate video-only and audio-only streams. `bv*+ba/b` matches
/// yt-dlp's normal download default: select the best video stream, merge the
/// best audio stream through FFmpeg, and fall back to a combined file only when
/// separate streams are unavailable.
fn format_selector(request: &DownloadRequest) -> String {
  if request.format == DownloadFormat::Bestaudio {
    return "bestaudio".to_string();
  }
  let height = match request.quality {
    DownloadQuality::Best => return "bv*+ba/b".to_string(),
    DownloadQuality::P2160 => 2160,
    DownloadQuality::P1440 => 1440,
    DownloadQuality::P1080 => 1080,
    DownloadQuality::P720 => 720,
    DownloadQuality::P480 => 480,
    DownloadQuality::P360 => 360,
  };
  format!("bv*[height<={height}]+ba/b[height<={height}]")
}

/// Builds only curated yt-dlp options represented by Navio's typed request model.
fn build_ytdlp_options(request: &DownloadRequest) -> Vec<String> {
  let mut options = Vec::new();
  if request.format == DownloadFormat::Best {
    let container = match request.video_container {
      VideoContainer::Auto => None,
      VideoContainer::Mp4 => Some("mp4"),
      VideoContainer::Mkv => Some("mkv"),
      VideoContainer::Webm => Some("webm"),
    };
    if let Some(container) = container {
      options.extend(["--merge-output-format".to_string(), container.to_string()]);
    }
  } else {
    let audio_format = match request.audio_format {
      AudioFormat::Original => None,
      AudioFormat::Mp3 => Some("mp3"),
      AudioFormat::M4a => Some("m4a"),
      AudioFormat::Opus => Some("opus"),
      AudioFormat::Flac => Some("flac"),
      AudioFormat::Wav => Some("wav"),
    };
    if let Some(audio_format) = audio_format {
      options.extend([
        "--extract-audio".to_string(),
        "--audio-format".to_string(),
        audio_format.to_string(),
      ]);
    }
  }

  if request.subtitle_mode != SubtitleMode::None {
    options.extend(["--write-subs".to_string(), "--write-auto-subs".to_string()]);
    let languages = match request.subtitle_mode {
      SubtitleMode::Selected => request.subtitle_languages.join(","),
      SubtitleMode::All => "all,-live_chat".to_string(),
      SubtitleMode::None => unreachable!(),
    };
    options.extend(["--sub-langs".to_string(), languages]);
    options.push("--embed-subs".to_string());
  }

  if !request.no_playlist {
    if let Some(start) = request.playlist_start {
      options.extend(["--playlist-start".to_string(), start.to_string()]);
    }
    if let Some(end) = request.playlist_end {
      options.extend(["--playlist-end".to_string(), end.to_string()]);
    }
  }
  options
}

/// Applies Windows' `CREATE_NO_WINDOW` flag to a subprocess without affecting other platforms.
///
/// This is required for release builds because the Navio executable is a GUI
/// process. Without the flag, launching the standalone yt-dlp executable can
/// flash a terminal window even though stdout and stderr are piped.
pub(super) fn hide_console_window(command: &mut Command) {
  #[cfg(windows)]
  {
    command.creation_flags(CREATE_NO_WINDOW);
  }
  #[cfg(not(windows))]
  {
    let _ = command;
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn parses_structured_progress_marker_without_human_output_regexes() {
    let update = parse_progress_marker(
      "NAVIO_PROGRESS:Example title\t42.5%\t2.0MiB/s\t00:12\t15.0MiB\t2\t8\t399\t251",
    )
    .expect("marker should parse");
    assert_eq!(update.title, "Example title");
    assert_eq!(update.progress, 42.5);
    assert_eq!(update.current_item, Some(2));
    assert_eq!(update.total_items, Some(8));
  }

  #[tokio::test]
  async fn process_output_reader_tolerates_non_utf8_title_bytes() {
    let output =
      b"NAVIO_PROGRESS:Messy \xAE\t42.5%\t2.0MiB/s\t00:12\t15.0MiB\tNA\tNA\t401\t251\r\n";
    let mut reader = BufReader::new(&output[..]);
    let mut buffer = Vec::new();

    let line = read_lossy_line(&mut reader, &mut buffer)
      .await
      .expect("raw process output should remain readable")
      .expect("one line should be available");
    let update = parse_progress_marker(&line).expect("the Navio marker should remain parseable");

    assert_eq!(update.progress, 42.5);
    assert_eq!(update.title, "Messy �");
  }

  #[test]
  fn multi_stream_progress_is_aggregated_without_decreasing() {
    let mut accumulator = ProgressAccumulator::default();
    let markers = [
      "NAVIO_PROGRESS:Example\t80%\t2MiB/s\t00:02\t10MiB\tNA\tNA\t399\t251",
      "NAVIO_PROGRESS:Example\t100%\t2MiB/s\t00:00\t10MiB\tNA\tNA\t399\t251",
      "NAVIO_PROGRESS:Example\t10%\t1MiB/s\t00:04\t2MiB\tNA\tNA\t251\t251",
      "NAVIO_PROGRESS:Example\t100%\t1MiB/s\t00:00\t2MiB\tNA\tNA\t251\t251",
    ];
    let aggregate = markers.map(|marker| {
      let update = parse_progress_marker(marker).expect("marker should parse");
      accumulator.aggregate(&update)
    });

    assert_eq!(aggregate, [40.0, 50.0, 55.0, 100.0]);
  }

  #[test]
  fn structured_ytdlp_streams_force_utf8_output() {
    assert_eq!(YTDLP_OUTPUT_ENCODING_ARGS, ["--encoding", "utf-8"]);
  }

  #[test]
  fn video_mode_selects_best_video_and_audio_streams_for_merging() {
    let video = DownloadRequest::default();
    assert_eq!(format_selector(&video), "bv*+ba/b");

    let audio = DownloadRequest {
      format: DownloadFormat::Bestaudio,
      ..DownloadRequest::default()
    };
    assert_eq!(format_selector(&audio), "bestaudio");
  }

  #[test]
  fn quality_ceiling_and_advanced_options_generate_allowlisted_arguments() {
    let request = DownloadRequest {
      format: DownloadFormat::Best,
      quality: DownloadQuality::P1080,
      video_container: VideoContainer::Mkv,
      subtitle_mode: SubtitleMode::Selected,
      subtitle_languages: vec!["en".to_string(), "bn".to_string()],
      playlist_start: Some(2),
      playlist_end: Some(5),
      no_playlist: false,
      ..DownloadRequest::default()
    };

    assert_eq!(
      format_selector(&request),
      "bv*[height<=1080]+ba/b[height<=1080]"
    );
    assert_eq!(
      build_ytdlp_options(&request),
      vec![
        "--merge-output-format",
        "mkv",
        "--write-subs",
        "--write-auto-subs",
        "--sub-langs",
        "en,bn",
        "--embed-subs",
        "--playlist-start",
        "2",
        "--playlist-end",
        "5",
      ]
    );
  }

  #[test]
  fn audio_conversion_and_all_subtitles_generate_safe_options() {
    let audio_request = DownloadRequest {
      format: DownloadFormat::Bestaudio,
      audio_format: AudioFormat::Flac,
      ..DownloadRequest::default()
    };
    assert_eq!(
      build_ytdlp_options(&audio_request),
      vec!["--extract-audio", "--audio-format", "flac"]
    );

    let subtitle_request = DownloadRequest {
      subtitle_mode: SubtitleMode::All,
      ..DownloadRequest::default()
    };
    assert_eq!(
      build_ytdlp_options(&subtitle_request),
      vec![
        "--write-subs",
        "--write-auto-subs",
        "--sub-langs",
        "all,-live_chat",
        "--embed-subs",
      ]
    );
  }

  #[test]
  fn request_validation_rejects_bad_ranges_and_subtitle_codes() {
    let request = DownloadRequest {
      url: "https://example.test/collection".to_string(),
      no_playlist: false,
      playlist_start: Some(5),
      playlist_end: Some(2),
      ..DownloadRequest::default()
    };
    assert!(validate_start_request("00000000-0000-4000-8000-000000000001", &request).is_err());

    let request = DownloadRequest {
      url: "https://example.test/video".to_string(),
      subtitle_mode: SubtitleMode::Selected,
      subtitle_languages: vec!["../../secret".to_string()],
      ..DownloadRequest::default()
    };
    assert!(validate_start_request("00000000-0000-4000-8000-000000000001", &request).is_err());
  }

  #[test]
  fn formats_completed_media_size_from_the_final_file_bytes() {
    assert_eq!(format_bytes(159_902_239), "152.5 MiB");
  }

  #[test]
  fn cross_drive_finalization_copies_then_removes_the_staging_file() {
    let directory = std::env::temp_dir().join(format!("navio-move-test-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&directory).expect("test directory should exist");
    let source = directory.join("source.mp4");
    let target = directory.join("target.mp4");
    fs::write(&source, b"video bytes").expect("source fixture should write");

    move_file_with_cross_drive_fallback(&source, &target, |_, _| {
      Err(std::io::Error::from_raw_os_error(17))
    })
    .expect("cross-drive moves should fall back to copy");

    assert!(!source.exists());
    assert_eq!(
      fs::read(&target).expect("target should exist"),
      b"video bytes"
    );
    fs::remove_dir_all(directory).expect("test directory should clean up");
  }

  #[test]
  fn finalization_uses_the_next_numeric_suffix_for_duplicate_titles() {
    let directory = std::env::temp_dir().join(format!("navio-name-test-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&directory).expect("test directory should exist");
    fs::write(directory.join("Example.mp4"), b"existing").expect("first fixture should write");
    fs::write(directory.join("Example (1).mp4"), b"existing").expect("second fixture should write");

    assert_eq!(
      available_target_path(&directory, std::ffi::OsStr::new("Example.mp4")),
      directory.join("Example (2).mp4"),
    );
    assert_eq!(
      available_target_path(&directory, std::ffi::OsStr::new("Example (1).mp4")),
      directory.join("Example (2).mp4"),
    );
    fs::remove_dir_all(directory).expect("test directory should clean up");
  }
}
