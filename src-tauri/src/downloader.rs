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
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

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
    std::fs::create_dir_all(&bin_dir)
      .map_err(|e| format!("Failed to create bin folder directory: {}", e))?;
  }

  // Use platform-specific binary extension (.exe on Windows, extensionless on Unix)
  let exe_name = if cfg!(windows) { "yt-dlp.exe" } else { "yt-dlp" };
  let ytdlp_path = bin_dir.join(exe_name);

  // If not present, download the binary from the latest official GitHub release
  if !ytdlp_path.exists() {
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
    let _ = app_handle.emit("download-progress", setup_payload);

    let download_url = if cfg!(windows) {
      "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    } else {
      "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
    };

    println!("[Navio Downloader] Fetching yt-dlp tool from: {}", download_url);

    let response = reqwest::get(download_url)
      .await
      .map_err(|e| format!("Failed to fetch yt-dlp release: {}", e))?;

    let bytes = response
      .bytes()
      .await
      .map_err(|e| format!("Failed to read release data stream: {}", e))?;

    std::fs::write(&ytdlp_path, bytes)
      .map_err(|e| format!("Failed to save yt-dlp executable: {}", e))?;

    // Mark the binary as executable on Unix systems (macOS, Linux)
    #[cfg(unix)]
    {
      use std::os::unix::fs::PermissionsExt;
      let mut perms = std::fs::metadata(&ytdlp_path)
        .map_err(|e| e.to_string())?
        .permissions();
      perms.set_mode(0o755);
      std::fs::set_permissions(&ytdlp_path, perms).map_err(|e| e.to_string())?;
    }

    println!("[Navio Downloader] yt-dlp installed successfully at: {:?}", ytdlp_path);
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
    std::fs::create_dir_all(&bin_dir)
      .map_err(|e| format!("Failed to create bin folder directory: {}", e))?;
  }

  // Use platform-specific binary extension (.exe on Windows, extensionless on Unix)
  let exe_name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
  let ffmpeg_path = bin_dir.join(exe_name);

  // If not present, download the compressed binary archive and extract it
  if !ffmpeg_path.exists() {
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
    let _ = app_handle.emit("download-progress", setup_payload);

    let ffmpeg_url = if cfg!(target_os = "windows") {
      "https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v4.4.1/ffmpeg-4.4.1-win-64.zip"
    } else if cfg!(target_os = "macos") {
      "https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v4.4.1/ffmpeg-4.4.1-osx-64.zip"
    } else {
      "https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v4.4.1/ffmpeg-4.4.1-linux-64.zip"
    };

    println!("[Navio Downloader] Fetching ffmpeg from: {}", ffmpeg_url);

    let zip_path = bin_dir.join("ffmpeg.zip");

    let response = reqwest::get(ffmpeg_url)
      .await
      .map_err(|e| format!("Failed to fetch ffmpeg release: {}", e))?;

    let bytes = response
      .bytes()
      .await
      .map_err(|e| format!("Failed to read zip stream: {}", e))?;

    std::fs::write(&zip_path, bytes)
      .map_err(|e| format!("Failed to save ffmpeg zip: {}", e))?;

    // Unzip the prebuilt archive using the zip crate
    let zip_file = std::fs::File::open(&zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(zip_file)
      .map_err(|e| format!("Failed to open zip archive: {}", e))?;

    for i in 0..archive.len() {
      let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
      let outpath = match file.enclosed_name() {
        Some(path) => bin_dir.join(path),
        None => continue,
      };

      // Extract files, skipping directories
      if !(*file.name()).ends_with('/') {
        let mut outfile = std::fs::File::create(&outpath)
          .map_err(|e| format!("Failed to create output file: {}", e))?;
        std::io::copy(&mut file, &mut outfile)
          .map_err(|e| format!("Failed to extract file: {}", e))?;
      }
    }

    // Clean up temporary zip file
    let _ = std::fs::remove_file(zip_path);

    // Mark the binary as executable on Unix systems (macOS, Linux)
    #[cfg(unix)]
    {
      use std::os::unix::fs::PermissionsExt;
      let mut perms = std::fs::metadata(&ffmpeg_path)
        .map_err(|e| e.to_string())?
        .permissions();
      perms.set_mode(0o755);
      std::fs::set_permissions(&ffmpeg_path, perms).map_err(|e| e.to_string())?;
    }

    println!("[Navio Downloader] ffmpeg installed successfully at: {:?}", ffmpeg_path);
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
  // 1. Resolve and create the system Downloads/Navio Player folder path
  let download_dir = app_handle
    .path()
    .download_dir()
    .map_err(|e| e.to_string())?
    .join("Navio Player");

  if !download_dir.exists() {
    std::fs::create_dir_all(&download_dir)
      .map_err(|e| format!("Failed to create download folder: {}", e))?;
  }

  // Register folder path in Axum stream server allowed directories list
  {
    let mut allowed = state.allowed_directories.lock().unwrap();
    allowed.insert(download_dir.clone());
  }

  // Sync folder path into the database index directories if not already present
  if let Ok(mut db) = library::load_db(&app_handle) {
    let download_dir_str = download_dir.to_string_lossy().to_string();
    if !db.scanned_directories.contains(&download_dir_str) {
      db.scanned_directories.push(download_dir_str.clone());
      let mut allowed = state.allowed_directories.lock().unwrap();
      allowed.insert(download_dir.clone());

      // Dynamically notify directory filesystem event watcher to track this folder
      let mut watcher_opt = state.watcher.lock().unwrap();
      if let Some(ref mut watcher) = *watcher_opt {
        use notify::Watcher;
        let _ = watcher.watch(&download_dir, notify::RecursiveMode::Recursive);
      }

      let _ = library::save_db(&app_handle, &db);
    }
  }

  // Spawn download worker thread asynchronously
  let app_handle_clone = app_handle.clone();
  tauri::async_runtime::spawn(async move {
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
        let _ = app_handle_clone.emit("download-progress", err_payload);
        return;
      }
    };

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
        let _ = app_handle_clone.emit("download-progress", err_payload);
        return;
      }
    };

    // 4. Configure subprocess command arguments
    let output_template = download_dir.join("%(title)s.%(ext)s");
    let bin_dir = app_handle_clone.path().app_data_dir().unwrap().join("bin");

    let mut cmd = Command::new(ytdlp_path);
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
      .arg("--no-warnings")
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
        let _ = app_handle_clone.emit("download-progress", err_payload);
        return;
      }
    };

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
        let _ = app_handle_clone.emit("download-progress", tick);
      }
    }

    // Wait for subprocess to exit
    let status_code = child.wait().await;
    let success = status_code.map(|s| s.success()).unwrap_or(false);

    if success {
      // Index the download folder to find the new track immediately
      let cache_dir = app_handle_clone.path().app_cache_dir().unwrap_or_default();
      let allowed_extensions = ["mp3", "m4a", "flac", "ogg", "wav", "mp4", "mkv", "webm"];

      let scanned_items = tokio::task::spawn_blocking(move || {
        library::scan_dir_recursive(&download_dir, &cache_dir, &allowed_extensions)
      })
      .await
      .unwrap_or_default();

      if let Ok(mut db) = library::load_db(&app_handle_clone) {
        for new_item in scanned_items {
          if let Some(pos) = db.tracks.iter().position(|t| t.path == new_item.path) {
            db.tracks[pos] = new_item;
          } else {
            db.tracks.push(new_item);
          }
        }
        let _ = library::save_db(&app_handle_clone, &db);
      }

      // Notify database change globally to force reload frontend catalog
      let _ = app_handle_clone.emit("library-updated", ());

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
      let _ = app_handle_clone.emit("download-progress", success_payload);
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
      let _ = app_handle_clone.emit("download-progress", fail_payload);
    }
  });

  Ok(())
}
