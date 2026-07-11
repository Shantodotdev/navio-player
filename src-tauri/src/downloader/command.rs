use super::*;

/// Tauri IPC Command to spawn a background stream download process.
/// Sets up directories, launches the downloader CLI, parses console output, and indexes the download.
///
/// # Arguments
/// * `id` - Unique identifier for tracking this download session on the UI.
/// * `url` - Streaming URL of the video/audio to download.
/// * `format` - Target format mode ("best" lets yt-dlp choose the highest available quality).
/// * `app_handle` - App context to emit Tauri events.
/// * `state` - Global AppState to whitelist/watch download folders.
#[tauri::command]
pub async fn start_download(
  id: String,
  url: String,
  format: String,
  no_playlist: Option<bool>,
  app_handle: AppHandle,
  state: tauri::State<'_, AppState>,
) -> Result<(), String> {
  println!(
    "[Navio Command] start_download | id={} format={} url={} no_playlist={:?}",
    id, format, url, no_playlist
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
        eprintln!("[Navio Downloader] Download preparation failed: {}", err);
        let err_payload = DownloadPayload {
          id,
          url,
          title: "Could not prepare downloads.".to_string(),
          progress: 0.0,
          speed: "0 B/s".to_string(),
          eta: "â€”".to_string(),
          size: "â€”".to_string(),
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
        eprintln!(
          "[Navio Downloader] Media processing preparation failed: {}",
          err
        );
        let err_payload = DownloadPayload {
          id,
          url,
          title: "Could not prepare media processing.".to_string(),
          progress: 0.0,
          speed: "0 B/s".to_string(),
          eta: "â€”".to_string(),
          size: "â€”".to_string(),
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

    cmd.arg(&url);

    if format != "best" {
      cmd.arg("-f").arg(&format);
    }

    if no_playlist.unwrap_or(true) {
      cmd.arg("--no-playlist");
    } else {
      cmd.arg("--yes-playlist");
    }

    cmd
      .arg("-o")
      .arg(output_template.to_string_lossy().to_string())
      .arg("--ffmpeg-location")
      .arg(bin_dir.to_string_lossy().to_string())
      .arg("--newline")
      .arg("--concurrent-fragments")
      .arg("3")
      .stdout(Stdio::piped())
      .stderr(Stdio::piped());

    // Spawn subprocess command
    let mut child = match cmd.spawn() {
      Ok(c) => c,
      Err(err) => {
        eprintln!(
          "[Navio Downloader] Could not start download process: {}",
          err
        );
        let err_payload = DownloadPayload {
          id,
          url,
          title: "Could not start download.".to_string(),
          progress: 0.0,
          speed: "0 B/s".to_string(),
          eta: "â€”".to_string(),
          size: "â€”".to_string(),
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

    // Spawn async background task to read stderr, print it, and capture the last error line
    let last_err = Arc::new(Mutex::new(String::new()));
    let last_err_clone = last_err.clone();
    tauri::async_runtime::spawn(async move {
      let mut err_reader = BufReader::new(stderr);
      let mut err_bytes = Vec::new();
      while let Ok(n) = err_reader.read_until(b'\n', &mut err_bytes).await {
        if n == 0 {
          break;
        }
        let line = String::from_utf8_lossy(&err_bytes).into_owned();
        let line = line.trim_end_matches(['\r', '\n']).to_string();
        eprintln!("[yt-dlp stderr] {}", line);
        let mut lock = last_err_clone.lock().unwrap();
        *lock = line;
        err_bytes.clear();
      }
    });

    // Regex to parse progress lines: [download]  12.3% of  34.5MiB at   5.2MiB/s ETA 00:12
    let progress_regex = regex::Regex::new(
      r"\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+(.+?)\s+at\s+(.+?)\s+ETA\s+([^\s]+)",
    )
    .unwrap();

    // Regex to extract output destination file names
    let dest_regex = regex::Regex::new(r"\[download\]\s+Destination:\s+(.+)").unwrap();
    let merge_regex = regex::Regex::new(r"\[Merger\]\s+Merging\s+formats\s+into\s+(.+)").unwrap();
    let already_downloaded_regex =
      regex::Regex::new(r"\[download\]\s+(.+?)\s+has\s+already\s+been\s+downloaded").unwrap();

    // Regexes for playlist detection and tracking
    let playlist_item_regex =
      regex::Regex::new(r"\[download\]\s+Downloading\s+item\s+(\d+)\s+of\s+(\d+)").unwrap();
    let playlist_title_regex =
      regex::Regex::new(r"\[download\]\s+Downloading\s+playlist:\s+(.+)").unwrap();
    let playlist_title_alt_regex =
      regex::Regex::new(r"Downloading\s+playlist\s+(.+?)\s+-\s+add").unwrap();

    let mut current_item = 0;
    let mut total_items = 0;
    let mut playlist_title: Option<String> = None;

    // Set initial fallback title using URL substring
    let mut current_title = url.replace("https://", "").replace("www.", "");
    if current_title.len() > 40 {
      current_title = format!("{}...", &current_title[..40]);
    }

    // Keep track of the final downloaded absolute path (for indexing reference)
    let downloaded_path = Arc::new(Mutex::new(None));

    let mut reader = BufReader::new(stdout);
    let mut line_bytes = Vec::new();

    // Read subprocess stdout line by line
    while let Ok(n) = reader.read_until(b'\n', &mut line_bytes).await {
      if n == 0 {
        break; // EOF
      }
      let line = String::from_utf8_lossy(&line_bytes).into_owned();
      let line = line.trim_end_matches(['\r', '\n']).to_string();
      line_bytes.clear();

      println!("[yt-dlp stdout] {}", line);

      let mut payload_update = false;
      let mut progress = 0.0;
      let mut size = "â€”".to_string();
      let mut speed = "â€”".to_string();
      let mut eta = "â€”".to_string();

      // Check for playlist item index
      if let Some(caps) = playlist_item_regex.captures(&line) {
        if let (Ok(curr), Ok(tot)) = (caps[1].parse::<usize>(), caps[2].parse::<usize>()) {
          current_item = curr;
          total_items = tot;
        }
      }

      // Check for playlist title
      if let Some(caps) = playlist_title_regex.captures(&line) {
        playlist_title = Some(caps[1].trim().to_string());
      } else if let Some(caps) = playlist_title_alt_regex.captures(&line) {
        playlist_title = Some(caps[1].trim().to_string());
      }

      // Check for destination file name print
      if let Some(caps) = dest_regex.captures(&line) {
        let full_path = caps
          .get(1)
          .unwrap()
          .as_str()
          .trim_matches(|c| c == '"' || c == '\'');
        *downloaded_path.lock().unwrap() = Some(PathBuf::from(full_path));
        if let Some(filename) = Path::new(full_path).file_name().and_then(|s| s.to_str()) {
          current_title = clean_download_title(filename);
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
          current_title = clean_download_title(filename);
          payload_update = true;
        }
      }

      // Check for already downloaded file skips
      if let Some(caps) = already_downloaded_regex.captures(&line) {
        let full_path = caps
          .get(1)
          .unwrap()
          .as_str()
          .trim_matches(|c| c == '"' || c == '\'');
        *downloaded_path.lock().unwrap() = Some(PathBuf::from(full_path));
        if let Some(filename) = Path::new(full_path).file_name().and_then(|s| s.to_str()) {
          current_title = clean_download_title(filename);
          payload_update = true;
        }
      }

      // Check for download progress metrics
      if let Some(caps) = progress_regex.captures(&line) {
        progress = caps
          .get(1)
          .unwrap()
          .as_str()
          .parse::<f32>()
          .unwrap_or(0.0)
          .clamp(0.0, 100.0);
        size = caps.get(2).unwrap().as_str().trim().to_string();
        speed = caps.get(3).unwrap().as_str().trim().to_string();
        eta = caps.get(4).unwrap().as_str().to_string();
        payload_update = true;
      }

      // Broadcast progress event tick to the frontend
      if payload_update {
        let display_title = if total_items > 0 && current_item > 0 {
          format!("[{}/{}] {}", current_item, total_items, current_title)
        } else {
          current_title.clone()
        };

        let tick = DownloadPayload {
          id: id.clone(),
          url: url.clone(),
          title: display_title,
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
      // A live library refresh will discover the download if its folder is configured.
      println!(
        "[Navio Event] emit library-updated | source=downloader id={}",
        id
      );
      if let Err(err) = app_handle_clone.emit("library-updated", ()) {
        eprintln!("[Navio Event] failed to emit library-updated: {}", err);
      }

      // Emit final completion payload
      let final_title = if let Some(ref plt) = playlist_title {
        format!("Playlist: {}", plt)
      } else {
        current_title.clone()
      };

      let success_payload = DownloadPayload {
        id,
        url,
        title: final_title,
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
      eprintln!("[Navio Downloader] Download failed: {}", err_msg);

      // Emit failed payload with error text
      let fail_payload = DownloadPayload {
        id,
        url,
        title: "Download failed.".to_string(),
        progress: 0.0,
        speed: "Failed".to_string(),
        eta: "â€”".to_string(),
        size: "â€”".to_string(),
        status: "failed".to_string(),
      };
      emit_download_progress(&app_handle_clone, fail_payload);
    }
  });

  println!("[Navio Command] start_download accepted | worker queued");
  Ok(())
}

#[derive(serde::Serialize)]
pub struct UrlTypeInfo {
  pub is_playlist: bool,
  pub has_video: bool,
}

#[tauri::command]
pub fn check_url_type(url: String) -> Result<UrlTypeInfo, String> {
  let mut is_playlist = false;
  let mut has_video = false;

  if let Ok(parsed) = reqwest::Url::parse(&url) {
    let host = parsed.host_str().unwrap_or("");
    let is_youtube = host.contains("youtube.com") || host.contains("youtu.be");
    if is_youtube {
      if host.contains("youtu.be") {
        has_video = !parsed.path().trim_start_matches('/').is_empty();
      }
      for (key, _) in parsed.query_pairs() {
        if key == "list" {
          is_playlist = true;
        }
        if key == "v" {
          has_video = true;
        }
      }
    } else {
      let path = parsed.path().to_lowercase();
      if path.contains("/playlist/")
        || path.contains("/album/")
        || path.contains("/set/")
        || path.contains("/sets/")
      {
        is_playlist = true;
      } else {
        has_video = true;
      }
    }
  }

  Ok(UrlTypeInfo {
    is_playlist,
    has_video,
  })
}

fn clean_download_title(filename: &str) -> String {
  let mut title = filename.to_string();
  if let Ok(format_re) = regex::Regex::new(r"\.f\d+") {
    title = format_re.replace_all(&title, "").into_owned();
  }
  let title_without_suffixes = title.replace(".part", "").replace(".ytdl", "");
  Path::new(&title_without_suffixes)
    .file_stem()
    .and_then(|s| s.to_str())
    .map(|s| s.to_string())
    .unwrap_or(title_without_suffixes)
}
