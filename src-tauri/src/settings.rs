use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const SETTINGS_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Settings {
  #[serde(default = "default_version")]
  pub version: u32,
  #[serde(default)]
  pub playback: PlaybackSettings,
  #[serde(default)]
  pub library: LibrarySettings,
  #[serde(default)]
  pub downloads: DownloadSettings,
  #[serde(default)]
  pub interface: InterfaceSettings,
  #[serde(default)]
  pub updates: UpdateSettings,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PlaybackSettings {
  #[serde(default = "default_volume")]
  pub volume: u8,
  #[serde(default = "default_true")]
  pub play_video_in_sidebar: bool,
  #[serde(default)]
  pub default_audio_language: Option<String>,
  #[serde(default)]
  pub default_subtitle_language: Option<String>,
  #[serde(default)]
  pub subtitles_enabled: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct LibrarySettings {
  #[serde(default = "default_true")]
  pub show_thumbnails: bool,
  #[serde(default = "default_list_view")]
  pub view_mode: String,
  #[serde(default)]
  pub show_file_extensions: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct DownloadSettings {
  #[serde(default)]
  pub folder: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct InterfaceSettings {
  #[serde(default = "default_drawer_width")]
  pub now_playing_drawer_width: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct UpdateSettings {
  #[serde(default = "default_true")]
  pub automatic: bool,
}

impl Default for Settings {
  fn default() -> Self {
    Self {
      version: SETTINGS_VERSION,
      playback: PlaybackSettings::default(),
      library: LibrarySettings::default(),
      downloads: DownloadSettings::default(),
      interface: InterfaceSettings::default(),
      updates: UpdateSettings::default(),
    }
  }
}

impl Default for PlaybackSettings {
  fn default() -> Self {
    Self {
      volume: 80,
      play_video_in_sidebar: true,
      default_audio_language: None,
      default_subtitle_language: None,
      subtitles_enabled: false,
    }
  }
}

impl Default for LibrarySettings {
  fn default() -> Self {
    Self {
      show_thumbnails: true,
      view_mode: "list".to_string(),
      show_file_extensions: false,
    }
  }
}

impl Default for InterfaceSettings {
  fn default() -> Self {
    Self {
      now_playing_drawer_width: 640,
    }
  }
}

impl Default for UpdateSettings {
  fn default() -> Self {
    Self { automatic: true }
  }
}

fn default_version() -> u32 {
  SETTINGS_VERSION
}
fn default_volume() -> u8 {
  80
}
fn default_true() -> bool {
  true
}
fn default_list_view() -> String {
  "list".to_string()
}
fn default_drawer_width() -> u32 {
  640
}

/// Resolves Navio's versioned settings database path.
pub fn get_db_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
  let app_data = app_handle
    .path()
    .app_data_dir()
    .map_err(|e| e.to_string())?;
  fs::create_dir_all(&app_data).map_err(|e| format!("Failed to create AppData directory: {e}"))?;
  Ok(app_data.join("settings.json"))
}

/// Loads settings, filling missing fields from Navio's safe defaults.
pub fn load_db(app_handle: &AppHandle) -> Result<Settings, String> {
  let path = get_db_path(app_handle)?;
  if !path.exists() {
    return Ok(Settings::default());
  }
  let bytes = fs::read(path).map_err(|e| format!("Failed to read settings database: {e}"))?;
  serde_json::from_slice(&bytes).map_err(|e| format!("Failed to parse settings database: {e}"))
}

/// Saves settings atomically so a shutdown cannot leave invalid JSON behind.
pub fn save_db(app_handle: &AppHandle, settings: &Settings) -> Result<(), String> {
  let path = get_db_path(app_handle)?;
  let temp = path.with_extension("json.tmp");
  let mut file =
    fs::File::create(&temp).map_err(|e| format!("Failed to create settings temp file: {e}"))?;
  serde_json::to_writer_pretty(&mut file, settings)
    .map_err(|e| format!("Failed to serialize settings: {e}"))?;
  file
    .flush()
    .map_err(|e| format!("Failed to flush settings: {e}"))?;
  drop(file);
  if path.exists() {
    fs::remove_file(&path).map_err(|e| format!("Failed to replace settings: {e}"))?;
  }
  fs::rename(temp, path).map_err(|e| format!("Failed to publish settings: {e}"))
}

/// Removes Navio databases and managed downloader binaries without touching media files.
pub fn reset_databases(app_handle: &AppHandle) -> Result<(), String> {
  let app_data = app_handle
    .path()
    .app_data_dir()
    .map_err(|e| e.to_string())?;
  for name in [
    "settings.json",
    "library.json",
    "playlists.json",
    "downloads.json",
    "theater-media.json",
  ] {
    let path = app_data.join(name);
    if path.exists() {
      fs::remove_file(path).map_err(|e| format!("Failed to remove database: {e}"))?;
    }
  }
  let bin_dir = app_data.join("bin");
  if bin_dir.exists() {
    fs::remove_dir_all(bin_dir).map_err(|e| format!("Failed to remove downloader tools: {e}"))?;
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn default_settings_match_navios_initial_preferences() {
    let settings = Settings::default();

    assert_eq!(settings.playback.volume, 80);
    assert!(settings.playback.play_video_in_sidebar);
    assert_eq!(settings.library.view_mode, "list");
    assert!(settings.library.show_thumbnails);
    assert!(!settings.library.show_file_extensions);
    assert!(settings.updates.automatic);
  }

  #[test]
  fn settings_json_uses_a_version_and_stable_sections() {
    let json = serde_json::to_value(Settings::default()).expect("settings serialize");

    assert_eq!(json["version"], 1);
    assert!(json["playback"]["default_audio_language"].is_null());
    assert!(json["downloads"]["folder"].is_null());
  }
}
