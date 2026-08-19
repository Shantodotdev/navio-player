//! Persistent local storage for paired Navio Connect devices.
//!
//! Maintains a trusted registry of paired devices, auth tokens, and permissions
//! in `connect-devices.json` in the user's AppData directory.

use super::models::PairedDevice;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const STORAGE_VERSION: u32 = 1;

/// File schema for `connect-devices.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectStorage {
  pub version: u32,
  /// Persistent device ID of this local Navio instance.
  pub local_device_id: String,
  /// Map of device ID -> PairedDevice metadata.
  pub paired_devices: HashMap<String, PairedDevice>,
}

impl Default for ConnectStorage {
  fn default() -> Self {
    Self {
      version: STORAGE_VERSION,
      local_device_id: uuid::Uuid::new_v4().to_string(),
      paired_devices: HashMap::new(),
    }
  }
}

/// Returns the path to `connect-devices.json` in the application data directory.
pub fn get_storage_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
  let app_data = app_handle
    .path()
    .app_data_dir()
    .map_err(|e| e.to_string())?;
  fs::create_dir_all(&app_data).map_err(|e| format!("Failed to create AppData directory: {e}"))?;
  Ok(app_data.join("connect-devices.json"))
}

/// Loads the persistent connect store or creates a default one.
pub fn load_storage(app_handle: &AppHandle) -> Result<ConnectStorage, String> {
  let path = get_storage_path(app_handle)?;
  if !path.exists() {
    let default_store = ConnectStorage::default();
    let _ = save_storage(app_handle, &default_store);
    return Ok(default_store);
  }

  let bytes =
    fs::read(&path).map_err(|e| format!("Failed to read connect devices storage: {e}"))?;
  match serde_json::from_slice::<ConnectStorage>(&bytes) {
    Ok(store) => Ok(store),
    Err(err) => {
      eprintln!(
        "[Navio Connect] Warning: Failed to parse connect-devices.json ({err}). Resetting."
      );
      let default_store = ConnectStorage::default();
      let _ = save_storage(app_handle, &default_store);
      Ok(default_store)
    }
  }
}

/// Atomically persists the connect storage to disk.
pub fn save_storage(app_handle: &AppHandle, storage: &ConnectStorage) -> Result<(), String> {
  let path = get_storage_path(app_handle)?;
  let temp = path.with_extension("json.tmp");
  let mut file =
    fs::File::create(&temp).map_err(|e| format!("Failed to create temp connect storage: {e}"))?;
  serde_json::to_writer_pretty(&mut file, storage)
    .map_err(|e| format!("Failed to serialize connect storage: {e}"))?;
  file
    .flush()
    .map_err(|e| format!("Failed to flush connect storage: {e}"))?;
  drop(file);

  if path.exists() {
    let _ = fs::remove_file(&path);
  }
  fs::rename(temp, path).map_err(|e| format!("Failed to publish connect storage: {e}"))
}
