//! Installation and verification for Navio's pinned downloader executables.
//!
//! yt-dlp and FFmpeg are application-managed binaries rather than renderer
//! dependencies. This module resolves them under AppData, bounds remote payload
//! sizes, verifies the configured SHA-256 digest, and installs only verified
//! bytes. Download-job status remains the responsibility of `command`; keeping
//! that policy out of this module also lets theater playback reuse FFmpeg setup
//! without creating a fictitious downloader card.

/// Verifies if `yt-dlp` is installed in the local AppData binary bin directory.
/// If the binary is missing, it downloads it on-demand from the official GitHub releases.
///
/// # Arguments
/// * `app_handle` - Tauri application handle to resolve path pathways.
/// * `download_id` - ID of the active download card to broadcast setup progress updates to.
use super::*;

pub(super) async fn ensure_ytdlp_installed(
  app_handle: &AppHandle,
  download_id: &str,
) -> Result<PathBuf, String> {
  let _ = download_id;
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
pub async fn ensure_ffmpeg_installed(
  app_handle: &AppHandle,
  download_id: &str,
) -> Result<PathBuf, String> {
  let _ = download_id;
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
