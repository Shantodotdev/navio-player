//! # Navio Downloader Module
//!
//! This module manages downloading streaming media files from remote URLs (such as YouTube streams)
//! using `yt-dlp` and `ffmpeg` muxing tools.
//!
//! It implements:
//! - Lazy binary verification: Fetches `yt-dlp` and `ffmpeg` prebuilts dynamically on first launch.
//! - Async execution: Runs download processes on background threads to keep the UI fluid.
//! - Stdout progress parsing: Uses regular expression matching to feed live download statistics (percentage, speed, size, ETA) back to the UI.
//! - Automated scanning: Auto-adds downloaded media directly to the user's local catalog.

use crate::library;
use crate::AppState;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

const YTDLP_VERSION: &str = "2026.07.04";
const MIN_NODE_JS_RUNTIME_MAJOR: u32 = 22;
const MAX_YTDLP_BYTES: u64 = 128 * 1024 * 1024;
const MAX_FFMPEG_ZIP_BYTES: u64 = 128 * 1024 * 1024;

#[cfg(windows)]
const YTDLP_SHA256: &str = "52fe3c26dcf71fbdc85b528589020bb0b8e383155cfa81b64dd447bbe35e24b8";
#[cfg(not(windows))]
const YTDLP_SHA256: &str = "495be29ff4d9d4e9be7eabdfef225221e5d5282e77f2f505abc6dca80349f3fd";

#[cfg(target_os = "windows")]
const FFMPEG_ZIP_SHA256: &str = "d1124593b7453fc54dd90ca3819dc82c22ffa957937f33dd650082f1a495b10e";
#[cfg(target_os = "macos")]
const FFMPEG_ZIP_SHA256: &str = "e08c670fcbdc2e627aa4c0d0c5ee1ef20e82378af2f14e4e7ae421a148bd49af";
#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
const FFMPEG_ZIP_SHA256: &str = "4348301b0d5e18174925e2022da1823aebbdb07282bbe9adb64b2485e1ef2df7";

fn sha256_hex(bytes: &[u8]) -> String {
  let mut hasher = Sha256::new();
  hasher.update(bytes);
  format!("{:x}", hasher.finalize())
}

async fn download_verified_bytes(
  url: &str,
  expected_sha256: &str,
  max_bytes: u64,
) -> Result<Vec<u8>, String> {
  let response = reqwest::get(url)
    .await
    .map_err(|e| format!("Failed to fetch {}: {}", url, e))?
    .error_for_status()
    .map_err(|e| format!("Unexpected response while fetching {}: {}", url, e))?;

  if let Some(content_len) = response.content_length() {
    if content_len > max_bytes {
      return Err(format!(
        "Refusing {} byte download from {}; limit is {} bytes",
        content_len, url, max_bytes
      ));
    }
  }

  let bytes = response
    .bytes()
    .await
    .map_err(|e| format!("Failed to read release data stream: {}", e))?;

  if bytes.len() as u64 > max_bytes {
    return Err(format!(
      "Refusing {} byte download from {}; limit is {} bytes",
      bytes.len(),
      url,
      max_bytes
    ));
  }

  let actual_sha256 = sha256_hex(&bytes);
  if actual_sha256 != expected_sha256 {
    return Err(format!(
      "Downloaded artifact hash mismatch. Expected {}, got {}",
      expected_sha256, actual_sha256
    ));
  }

  Ok(bytes.to_vec())
}

fn write_verified_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
  let tmp_path = path.with_extension("tmp");
  fs::write(&tmp_path, bytes)
    .map_err(|e| format!("Failed to write temporary file {:?}: {}", tmp_path, e))?;
  fs::rename(&tmp_path, path)
    .map_err(|e| format!("Failed to install verified file {:?}: {}", path, e))?;
  Ok(())
}

fn file_matches_sha256(path: &Path, expected_sha256: &str) -> bool {
  fs::read(path)
    .map(|bytes| sha256_hex(&bytes) == expected_sha256)
    .unwrap_or(false)
}

fn parse_node_major(version: &str) -> Option<u32> {
  version
    .trim()
    .strip_prefix('v')
    .unwrap_or_else(|| version.trim())
    .split('.')
    .next()
    .and_then(|major| major.parse::<u32>().ok())
}

async fn detect_node_js_runtime() -> bool {
  let Ok(output) = Command::new("node").arg("--version").output().await else {
    return false;
  };

  if !output.status.success() {
    return false;
  }

  let version = String::from_utf8_lossy(&output.stdout);
  parse_node_major(&version)
    .map(|major| major >= MIN_NODE_JS_RUNTIME_MAJOR)
    .unwrap_or(false)
}

/// Payload struct representing a single download progress update broadcasted to the React frontend.
#[derive(serde::Serialize, Clone, Debug)]
pub struct DownloadPayload {
  /// Unique identifier of the active download item.
  pub id: String,
  /// Target stream URL being processed.
  pub url: String,
  /// Cleaned title (derived from the stream metadata or filename).
  pub title: String,
  /// Current progress percentage (0.0 to 100.0).
  pub progress: f32,
  /// Live download speed string (e.g. "4.5 MiB/s").
  pub speed: String,
  /// Estimated time remaining (e.g. "00:15").
  pub eta: String,
  /// Total file size being downloaded.
  pub size: String,
  /// Current execution state: "downloading" | "completed" | "failed".
  pub status: String,
}

fn emit_download_progress(app_handle: &AppHandle, payload: DownloadPayload) {
  println!(
    "[Navio Event] emit download-progress | id={} status={} progress={:.1}% title=\"{}\" speed=\"{}\" eta=\"{}\" size=\"{}\"",
    payload.id,
    payload.status,
    payload.progress,
    payload.title,
    payload.speed,
    payload.eta,
    payload.size
  );

  if let Err(err) = app_handle.emit("download-progress", payload) {
    eprintln!("[Navio Event] failed to emit download-progress: {}", err);
  }
}

/// Verifies if `yt-dlp` is installed in the local AppData binary bin directory.
/// If the binary is missing, it downloads it on-demand from the official GitHub releases.
///
/// # Arguments
/// * `app_handle` - Tauri application handle to resolve path pathways.
/// * `download_id` - ID of the active download card to broadcast setup progress updates to.
async fn ensure_ytdlp_installed(
  app_handle: &AppHandle,
  download_id: &str,
) -> Result<PathBuf, String> {
  // Resolve AppData/bin folder path
  let app_data = app_handle
    .path()
    .app_data_dir()
    .map_err(|e| e.to_string())?;
  let bin_dir = app_data.join("bin");

  if !bin_dir.exists() {
    fs::create_dir_all(&bin_dir)
      .map_err(|e| format!("Failed to create bin folder directory: {}", e))?;
  }

  // Use platform-specific binary extension (.exe on Windows, extensionless on Unix)
  let exe_name = if cfg!(windows) {
    "yt-dlp.exe"
  } else {
    "yt-dlp"
  };
  let ytdlp_path = bin_dir.join(exe_name);

  let needs_install = !ytdlp_path.exists() || !file_matches_sha256(&ytdlp_path, YTDLP_SHA256);
  println!(
    "[Navio Downloader] yt-dlp verification | path={:?} needs_install={}",
    ytdlp_path, needs_install
  );

  // If not present or hash-mismatched, download the pinned binary release.
  if needs_install {
    // Notify the UI that setup is starting
    let setup_payload = DownloadPayload {
      id: download_id.to_string(),
      url: "".to_string(),
      title: "Setting up downloader engine (yt-dlp)...".to_string(),
      progress: 0.0,
      speed: "Downloading utility...".to_string(),
      eta: "—".to_string(),
      size: "—".to_string(),
      status: "downloading".to_string(),
    };
    emit_download_progress(app_handle, setup_payload);

    let download_url = if cfg!(windows) {
      format!(
        "https://github.com/yt-dlp/yt-dlp/releases/download/{}/yt-dlp.exe",
        YTDLP_VERSION
      )
    } else {
      format!(
        "https://github.com/yt-dlp/yt-dlp/releases/download/{}/yt-dlp",
        YTDLP_VERSION
      )
    };

    println!(
      "[Navio Downloader] Fetching yt-dlp tool from: {}",
      download_url
    );

    let bytes = download_verified_bytes(&download_url, YTDLP_SHA256, MAX_YTDLP_BYTES).await?;
    write_verified_file(&ytdlp_path, &bytes)?;

    // Mark the binary as executable on Unix systems (macOS, Linux)
    #[cfg(unix)]
    {
      use std::os::unix::fs::PermissionsExt;
      let mut perms = fs::metadata(&ytdlp_path)
        .map_err(|e| e.to_string())?
        .permissions();
      perms.set_mode(0o755);
      fs::set_permissions(&ytdlp_path, perms).map_err(|e| e.to_string())?;
    }

    println!(
      "[Navio Downloader] yt-dlp installed successfully at: {:?}",
      ytdlp_path
    );
  }

  Ok(ytdlp_path)
}

/// Verifies if `ffmpeg` is installed in the local AppData binary bin directory.
/// If missing, it fetches the prebuilt archive from `ffbinaries` and extracts it.
///
/// # Arguments
/// * `app_handle` - Tauri application handle to resolve path pathways.
/// * `download_id` - ID of the active download card to broadcast setup progress updates to.
async fn ensure_ffmpeg_installed(
  app_handle: &AppHandle,
  download_id: &str,
) -> Result<PathBuf, String> {
  // Resolve AppData/bin folder path
  let app_data = app_handle
    .path()
    .app_data_dir()
    .map_err(|e| e.to_string())?;
  let bin_dir = app_data.join("bin");

  if !bin_dir.exists() {
    fs::create_dir_all(&bin_dir)
      .map_err(|e| format!("Failed to create bin folder directory: {}", e))?;
  }

  // Use platform-specific binary extension (.exe on Windows, extensionless on Unix)
  let exe_name = if cfg!(windows) {
    "ffmpeg.exe"
  } else {
    "ffmpeg"
  };
  let ffmpeg_path = bin_dir.join(exe_name);
  let ffmpeg_marker_path = bin_dir.join("ffmpeg.zip.sha256");
  let is_verified_install = ffmpeg_path.exists()
    && fs::read_to_string(&ffmpeg_marker_path)
      .map(|hash| hash.trim() == FFMPEG_ZIP_SHA256)
      .unwrap_or(false);
  println!(
    "[Navio Downloader] ffmpeg verification | path={:?} verified={}",
    ffmpeg_path, is_verified_install
  );

  // If not present or not installed from the pinned archive, verify and extract it.
  if !is_verified_install {
    // Notify the UI that setup is starting
    let setup_payload = DownloadPayload {
      id: download_id.to_string(),
      url: "".to_string(),
      title: "Downloading ffmpeg merger (one-time setup)...".to_string(),
      progress: 0.0,
      speed: "Downloading media muxer...".to_string(),
      eta: "—".to_string(),
      size: "—".to_string(),
      status: "downloading".to_string(),
    };
    emit_download_progress(app_handle, setup_payload);

    let ffmpeg_url = if cfg!(target_os = "windows") {
      "https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v4.4.1/ffmpeg-4.4.1-win-64.zip"
    } else if cfg!(target_os = "macos") {
      "https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v4.4.1/ffmpeg-4.4.1-osx-64.zip"
    } else {
      "https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v4.4.1/ffmpeg-4.4.1-linux-64.zip"
    };

    println!("[Navio Downloader] Fetching ffmpeg from: {}", ffmpeg_url);

    let zip_path = bin_dir.join("ffmpeg.zip");

    let bytes =
      download_verified_bytes(ffmpeg_url, FFMPEG_ZIP_SHA256, MAX_FFMPEG_ZIP_BYTES).await?;
    write_verified_file(&zip_path, &bytes)?;

    // Unzip the prebuilt archive using the zip crate
    let zip_file = fs::File::open(&zip_path).map_err(|e| e.to_string())?;
    let mut archive =
      zip::ZipArchive::new(zip_file).map_err(|e| format!("Failed to open zip archive: {}", e))?;

    for i in 0..archive.len() {
      let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
      let outpath = match file.enclosed_name() {
        Some(path) => bin_dir.join(path),
        None => continue,
      };

      // Extract files, skipping directories
      if !(*file.name()).ends_with('/') {
        let mut outfile =
          fs::File::create(&outpath).map_err(|e| format!("Failed to create output file: {}", e))?;
        std::io::copy(&mut file, &mut outfile)
          .map_err(|e| format!("Failed to extract file: {}", e))?;
      }
    }

    // Clean up temporary zip file
    let _ = fs::remove_file(zip_path);
    fs::write(&ffmpeg_marker_path, FFMPEG_ZIP_SHA256)
      .map_err(|e| format!("Failed to save ffmpeg verification marker: {}", e))?;

    // Mark the binary as executable on Unix systems (macOS, Linux)
    #[cfg(unix)]
    {
      use std::os::unix::fs::PermissionsExt;
      let mut perms = fs::metadata(&ffmpeg_path)
        .map_err(|e| e.to_string())?
        .permissions();
      perms.set_mode(0o755);
      fs::set_permissions(&ffmpeg_path, perms).map_err(|e| e.to_string())?;
    }

    println!(
      "[Navio Downloader] ffmpeg installed successfully at: {:?}",
      ffmpeg_path
    );
  }

  Ok(ffmpeg_path)
}

/// Tauri IPC Command to spawn a background stream download process.
/// Sets up directories, launches the downloader CLI, parses console output, and indexes the download.
///
/// # Arguments
/// * `id` - Unique identifier for tracking this download session on the UI.
/// * `url` - Streaming URL of the video/audio to download.
/// * `format` - Target quality/format code (e.g. "bestvideo+bestaudio" or "bestaudio").
/// * `app_handle` - App context to emit Tauri events.
/// * `state` - Global AppState to whitelist/watch download folders.
#[tauri::command]
pub async fn start_download(
  id: String,
  url: String,
  format: String,
  app_handle: AppHandle,
  state: tauri::State<'_, AppState>,
) -> Result<(), String> {
  println!(
    "[Navio Command] start_download | id={} format={} url={}",
    id, format, url
  );

  // 1. Resolve and create the system Downloads/Navio Player folder path
  let download_dir = app_handle
    .path()
    .download_dir()
    .map_err(|e| e.to_string())?
    .join("Navio Player");

  if !download_dir.exists() {
    fs::create_dir_all(&download_dir)
      .map_err(|e| format!("Failed to create download folder: {}", e))?;
    println!(
      "[Navio Downloader] Created download directory: {:?}",
      download_dir
    );
  }

  // Register folder path in Axum stream server allowed directories list
  {
    let mut allowed = state.allowed_directories.lock().unwrap();
    allowed.insert(download_dir.clone());
    println!(
      "[Navio Downloader] Allowed download directory for streaming: {:?}",
      download_dir
    );
  }

  // Sync folder path into the database index directories if not already present
  if let Ok(mut db) = library::load_db(&app_handle) {
    let download_dir_str = download_dir.to_string_lossy().to_string();
    if !db.scanned_directories.contains(&download_dir_str) {
      println!(
        "[Navio Downloader] Adding download directory to library DB: {}",
        download_dir_str
      );
      db.scanned_directories.push(download_dir_str.clone());
      let mut allowed = state.allowed_directories.lock().unwrap();
      allowed.insert(download_dir.clone());

      // Dynamically notify directory filesystem event watcher to track this folder
      let mut watcher_opt = state.watcher.lock().unwrap();
      if let Some(ref mut watcher) = *watcher_opt {
        use notify::Watcher;
        let _ = watcher.watch(&download_dir, notify::RecursiveMode::Recursive);
        println!(
          "[Navio Downloader] Watcher subscribed to download directory: {:?}",
          download_dir
        );
      }

      let _ = library::save_db(&app_handle, &db);
    }
  }

  // Spawn download worker thread asynchronously
  let app_handle_clone = app_handle.clone();
  tauri::async_runtime::spawn(async move {
    println!("[Navio Downloader] Worker started | id={}", id);

    // 2. Fetch yt-dlp binary (if missing)
    let ytdlp_path = match ensure_ytdlp_installed(&app_handle_clone, &id).await {
      Ok(p) => p,
      Err(err) => {
        let err_payload = DownloadPayload {
          id,
          url,
          title: format!("Setup error: {}", err),
          progress: 0.0,
          speed: "0 B/s".to_string(),
          eta: "—".to_string(),
          size: "—".to_string(),
          status: "failed".to_string(),
        };
        emit_download_progress(&app_handle_clone, err_payload);
        return;
      }
    };
    println!("[Navio Downloader] yt-dlp ready | path={:?}", ytdlp_path);

    // 3. Fetch ffmpeg binary (if missing)
    let _ffmpeg_path = match ensure_ffmpeg_installed(&app_handle_clone, &id).await {
      Ok(p) => p,
      Err(err) => {
        let err_payload = DownloadPayload {
          id,
          url,
          title: format!("ffmpeg setup error: {}", err),
          progress: 0.0,
          speed: "0 B/s".to_string(),
          eta: "—".to_string(),
          size: "—".to_string(),
          status: "failed".to_string(),
        };
        emit_download_progress(&app_handle_clone, err_payload);
        return;
      }
    };
    println!("[Navio Downloader] ffmpeg ready | path={:?}", _ffmpeg_path);

    // 4. Configure subprocess command arguments
    let output_template = download_dir.join("%(title)s.%(ext)s");
    let bin_dir = app_handle_clone.path().app_data_dir().unwrap().join("bin");
    let use_node_js_runtime = detect_node_js_runtime().await;

    let mut cmd = Command::new(ytdlp_path);

    if use_node_js_runtime {
      println!("[Navio Downloader] Node.js runtime detected; enabling yt-dlp JS runtime support");
      cmd.arg("--js-runtimes").arg("node");
    } else {
      eprintln!(
        "[yt-dlp setup] Node.js {}+ was not found; YouTube downloads may fail without an external JS runtime",
        MIN_NODE_JS_RUNTIME_MAJOR
      );
    }

    cmd
      .arg(&url)
      .arg("-f")
      .arg(&format)
      .arg("-o")
      .arg(output_template.to_string_lossy().to_string())
      .arg("--ffmpeg-location")
      .arg(bin_dir.to_string_lossy().to_string())
      .arg("--merge-output-format")
      .arg("webm")
      .stdout(Stdio::piped())
      .stderr(Stdio::piped());

    // Spawn subprocess command
    let mut child = match cmd.spawn() {
      Ok(c) => c,
      Err(err) => {
        let err_payload = DownloadPayload {
          id,
          url,
          title: format!("Execution failed: {}", err),
          progress: 0.0,
          speed: "0 B/s".to_string(),
          eta: "—".to_string(),
          size: "—".to_string(),
          status: "failed".to_string(),
        };
        emit_download_progress(&app_handle_clone, err_payload);
        return;
      }
    };
    println!("[Navio Downloader] yt-dlp process spawned | id={}", id);

    // Capture standard input/output streams
    let stdout = child
      .stdout
      .take()
      .expect("Failed to open process stdout stream");
    let stderr = child
      .stderr
      .take()
      .expect("Failed to open process stderr stream");
    let mut reader = BufReader::new(stdout).lines();

    // Spawn async background task to read stderr, print it, and capture the last error line
    let last_err = Arc::new(Mutex::new(String::new()));
    let last_err_clone = last_err.clone();
    tauri::async_runtime::spawn(async move {
      let mut err_reader = BufReader::new(stderr).lines();
      while let Ok(Some(line)) = err_reader.next_line().await {
        eprintln!("[yt-dlp stderr] {}", line);
        let mut lock = last_err_clone.lock().unwrap();
        *lock = line;
      }
    });

    // Regex to parse progress lines: [download]  12.3% of  34.5MiB at   5.2MiB/s ETA 00:12
    let progress_regex = regex::Regex::new(
      r"\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+([^\s]+)\s+at\s+([^\s]+)\s+ETA\s+([^\s]+)",
    )
    .unwrap();

    // Regex to extract output destination file names
    let dest_regex = regex::Regex::new(r"\[download\]\s+Destination:\s+(.+)").unwrap();
    let merge_regex = regex::Regex::new(r"\[Merger\]\s+Merging\s+formats\s+into\s+(.+)").unwrap();

    // Set initial fallback title using URL substring
    let mut current_title = url.replace("https://", "").replace("www.", "");
    if current_title.len() > 40 {
      current_title = format!("{}...", &current_title[..40]);
    }

    // Keep track of the final downloaded absolute path (for indexing reference)
    let downloaded_path = Arc::new(Mutex::new(None));

    // Read subprocess stdout line by line
    while let Ok(Some(line)) = reader.next_line().await {
      println!("[yt-dlp stdout] {}", line);

      let mut payload_update = false;
      let mut progress = 0.0;
      let mut size = "—".to_string();
      let mut speed = "—".to_string();
      let mut eta = "—".to_string();

      // Check for destination file name print
      if let Some(caps) = dest_regex.captures(&line) {
        let full_path = caps
          .get(1)
          .unwrap()
          .as_str()
          .trim_matches(|c| c == '"' || c == '\'');
        *downloaded_path.lock().unwrap() = Some(PathBuf::from(full_path));
        if let Some(filename) = Path::new(full_path).file_name().and_then(|s| s.to_str()) {
          current_title = filename.to_string();
          payload_update = true;
        }
      }

      // Check for merger output filename print
      if let Some(caps) = merge_regex.captures(&line) {
        let full_path = caps
          .get(1)
          .unwrap()
          .as_str()
          .trim_matches(|c| c == '"' || c == '\'');
        *downloaded_path.lock().unwrap() = Some(PathBuf::from(full_path));
        if let Some(filename) = Path::new(full_path).file_name().and_then(|s| s.to_str()) {
          current_title = filename.to_string();
          payload_update = true;
        }
      }

      // Check for download progress metrics
      if let Some(caps) = progress_regex.captures(&line) {
        progress = caps.get(1).unwrap().as_str().parse::<f32>().unwrap_or(0.0);
        size = caps.get(2).unwrap().as_str().to_string();
        speed = caps.get(3).unwrap().as_str().to_string();
        eta = caps.get(4).unwrap().as_str().to_string();
        payload_update = true;
      }

      // Broadcast progress event tick to the frontend
      if payload_update {
        let tick = DownloadPayload {
          id: id.clone(),
          url: url.clone(),
          title: current_title.clone(),
          progress,
          speed,
          eta,
          size,
          status: "downloading".to_string(),
        };
        emit_download_progress(&app_handle_clone, tick);
      }
    }

    // Wait for subprocess to exit
    let status_code = child.wait().await;
    let success = status_code.map(|s| s.success()).unwrap_or(false);
    println!(
      "[Navio Downloader] yt-dlp process exited | id={} success={}",
      id, success
    );

    if success {
      // Index the download folder to find the new track immediately
      let cache_dir = app_handle_clone.path().app_cache_dir().unwrap_or_default();
      let allowed_extensions = ["mp3", "m4a", "flac", "ogg", "wav", "mp4", "mkv", "webm"];

      let scanned_items = tokio::task::spawn_blocking(move || {
        library::scan_dir_recursive(&download_dir, &cache_dir, &allowed_extensions)
      })
      .await
      .unwrap_or_default();
      println!(
        "[Navio Downloader] Post-download library scan completed | id={} items={}",
        id,
        scanned_items.len()
      );

      if let Ok(mut db) = library::load_db(&app_handle_clone) {
        for new_item in scanned_items {
          if let Some(pos) = db.tracks.iter().position(|t| t.path == new_item.path) {
            db.tracks[pos] = new_item;
          } else {
            db.tracks.push(new_item);
          }
        }
        let _ = library::save_db(&app_handle_clone, &db);
        println!(
          "[Navio Downloader] Library DB updated after download | id={}",
          id
        );
      }

      // Notify database change globally to force reload frontend catalog
      println!(
        "[Navio Event] emit library-updated | source=downloader id={}",
        id
      );
      if let Err(err) = app_handle_clone.emit("library-updated", ()) {
        eprintln!("[Navio Event] failed to emit library-updated: {}", err);
      }

      // Emit final completion payload
      let success_payload = DownloadPayload {
        id,
        url,
        title: current_title,
        progress: 100.0,
        speed: "Finished".to_string(),
        eta: "00:00".to_string(),
        size: "".to_string(),
        status: "completed".to_string(),
      };
      emit_download_progress(&app_handle_clone, success_payload);
    } else {
      // Retrieve the last line captured from the stderr thread
      let err_msg = {
        let lock = last_err.lock().unwrap();
        if lock.is_empty() {
          "Download process exited with error".to_string()
        } else {
          lock.clone()
        }
      };

      // Emit failed payload with error text
      let fail_payload = DownloadPayload {
        id,
        url,
        title: format!("Error: {}", err_msg),
        progress: 0.0,
        speed: "Failed".to_string(),
        eta: "—".to_string(),
        size: "—".to_string(),
        status: "failed".to_string(),
      };
      emit_download_progress(&app_handle_clone, fail_payload);
    }
  });

  println!("[Navio Command] start_download accepted | worker queued");
  Ok(())
}
