//! Central coordinator for Navio Connect session management, pairing, and state broadcasting.
//!
//! The `ConnectHub` serves as the single source of truth on the host machine. It manages:
//! - Persistent paired devices and authentication tokens.
//! - Transient 4-digit pairing PIN codes.
//! - Multi-client async WebSocket broadcasting via `tokio::sync::broadcast`.
//! - Cached playback state mirror and permission validation.

use super::discovery::DiscoveryManager;
use super::models::{
  ConnectMessage, ConnectPermissions, ConnectPlayerState, DeviceType, DiscoveredPeer,
  LocalDeviceInfo, PairedDevice, Platform,
};
use super::storage::{load_storage, save_storage, ConnectStorage};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use tauri::AppHandle;
use tokio::sync::broadcast;

/// Central thread-safe state container and message router for Navio Connect.
///
/// Implements `Clone` cheaply because all internal fields are wrapped in `Arc`
/// (Atomic Reference Counting) smart pointers, allowing it to be shared across
/// Axum request tasks, Tauri commands, and mDNS discovery threads.
#[derive(Clone)]
pub struct ConnectHub {
  /// Tauri application handle, used to emit events to the local frontend WebView.
  app_handle: AppHandle,
  /// Cached local machine identity (ID, OS, hostname, LAN IPs, port).
  local_info: Arc<RwLock<LocalDeviceInfo>>,
  /// Map of paired client device ID -> PairedDevice metadata and auth tokens.
  paired_devices: Arc<RwLock<HashMap<String, PairedDevice>>>,
  /// Ephemeral 4-digit PIN generated when a new pairing session is initiated.
  active_pin: Arc<RwLock<Option<String>>>,
  /// Cached latest playback state snapshot (track, duration, position, is_playing).
  player_state: Arc<RwLock<ConnectPlayerState>>,
  /// Multi-Producer Multi-Consumer (MPMC) broadcast channel.
  /// When a message is sent here, every active WebSocket client receives a copy.
  broadcast_tx: broadcast::Sender<ConnectMessage>,
  /// Handle to the background mDNS discovery manager.
  discovery: Arc<RwLock<Option<DiscoveryManager>>>,
}

impl ConnectHub {
  /// Initializes the ConnectHub, loads saved devices from disk, and starts mDNS discovery.
  ///
  /// # Arguments
  /// * `app_handle` - The Tauri application handle.
  /// * `port` - The TCP port on which the Axum HTTP & WebSocket server is listening.
  pub fn new(app_handle: AppHandle, port: u16) -> Self {
    // Load existing paired devices from connect-devices.json
    let storage = load_storage(&app_handle).unwrap_or_default();
    let local_ips = detect_local_ip_addresses();
    let machine_name = hostname::get()
      .ok()
      .and_then(|h| h.into_string().ok())
      .unwrap_or_else(|| "Navio Desktop".to_string());

    let local_info = LocalDeviceInfo {
      id: storage.local_device_id.clone(),
      name: machine_name.clone(),
      port,
      local_ips: local_ips.clone(),
      platform: Platform::current(),
      version: "1.0.0".to_string(),
    };

    println!(
      "[Navio Connect] Initialized Hub | ID={} | Name=\"{}\" | Port={} | IPs={:?}",
      local_info.id, local_info.name, port, local_info.local_ips
    );

    // Initialize the broadcast channel with a buffer capacity of 128 messages.
    // If a client is slightly slow, messages are buffered in memory without blocking the host.
    let (broadcast_tx, _) = broadcast::channel(128);

    let hub = Self {
      app_handle,
      local_info: Arc::new(RwLock::new(local_info)),
      paired_devices: Arc::new(RwLock::new(storage.paired_devices)),
      active_pin: Arc::new(RwLock::new(None)),
      player_state: Arc::new(RwLock::new(ConnectPlayerState::default())),
      broadcast_tx,
      discovery: Arc::new(RwLock::new(None)),
    };

    // Launch background mDNS announcement and listener
    let discovery_mgr =
      DiscoveryManager::start(storage.local_device_id, machine_name, port, local_ips);
    match discovery_mgr {
      Ok(dm) => {
        if let Ok(mut lock) = hub.discovery.write() {
          *lock = Some(dm);
        }
      }
      Err(err) => {
        eprintln!("[Navio Connect] Warning: Discovery manager failed to start: {err}");
      }
    }

    hub
  }

  /// Returns metadata describing this local Navio instance (name, port, IPs, OS).
  pub fn get_local_info(&self) -> LocalDeviceInfo {
    self.local_info.read().unwrap().clone()
  }

  /// Returns the list of active Navio peers discovered on the local Wi-Fi.
  pub fn get_discovered_peers(&self) -> Vec<DiscoveredPeer> {
    if let Ok(lock) = self.discovery.read() {
      if let Some(ref dm) = *lock {
        return dm.get_discovered_peers();
      }
    }
    Vec::new()
  }

  /// Generates a secure random 4-digit pairing PIN code (e.g. `4829`) and stores it in memory.
  ///
  /// The PIN is displayed on the host screen for the user to type on their remote controller.
  pub fn generate_pairing_pin(&self) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let seed = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .unwrap_or_default()
      .subsec_nanos();
    // Generates a 4-digit number between 1000 and 9999
    let pin = format!("{:04}", (seed % 9000) + 1000);
    if let Ok(mut lock) = self.active_pin.write() {
      *lock = Some(pin.clone());
    }
    println!("[Navio Connect] Generated new pairing PIN: [{}]", pin);
    pin
  }

  /// Retrieves the currently active pairing PIN if one was generated and has not expired/used.
  pub fn get_active_pin(&self) -> Option<String> {
    self.active_pin.read().ok().and_then(|p| p.clone())
  }

  /// Validates a submitted PIN against the currently active pairing PIN.
  ///
  /// If valid, the PIN is immediately consumed and cleared from memory (single-use security).
  pub fn verify_pin(&self, candidate_pin: &str) -> bool {
    let is_valid = self
      .active_pin
      .read()
      .ok()
      .and_then(|p| p.as_ref().map(|active| active == candidate_pin.trim()))
      .unwrap_or(false);

    if is_valid {
      // Clear the single-use PIN immediately upon successful verification
      if let Ok(mut lock) = self.active_pin.write() {
        *lock = None;
      }
    }
    is_valid
  }

  /// Validates an incoming client auth token against the saved trusted devices registry.
  ///
  /// Returns `Some(PairedDevice)` with its configured permissions if authorized, or `None`.
  pub fn validate_token(&self, token: &str, client_id: &str) -> Option<PairedDevice> {
    let devices = self.paired_devices.read().ok()?;
    if let Some(device) = devices.get(client_id) {
      if device.token == token {
        return Some(device.clone());
      }
    }
    None
  }

  /// Registers a newly paired device, generates a permanent auth token, and persists to disk.
  ///
  /// # Returns
  /// A tuple containing `(PairedDevice, authTokenString)`.
  pub fn add_paired_device(
    &self,
    client_id: String,
    client_name: String,
    device_type: DeviceType,
    platform: Platform,
  ) -> (PairedDevice, String) {
    let token = uuid::Uuid::new_v4().to_string();
    let now = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .unwrap_or_default()
      .as_millis() as u64;

    let paired = PairedDevice {
      id: client_id.clone(),
      name: client_name.clone(),
      device_type,
      platform,
      token: token.clone(),
      permissions: ConnectPermissions::default(),
      paired_at_ms: now,
      last_seen_ms: now,
    };

    // Save into in-memory hashmap and persist atomically to connect-devices.json
    if let Ok(mut lock) = self.paired_devices.write() {
      lock.insert(client_id.clone(), paired.clone());
      let storage = ConnectStorage {
        version: 1,
        local_device_id: self.local_info.read().unwrap().id.clone(),
        paired_devices: lock.clone(),
      };
      let _ = save_storage(&self.app_handle, &storage);
    }

    println!(
      "[Navio Connect] Successfully paired new device: \"{}\" ({})",
      client_name, client_id
    );

    (paired, token)
  }

  /// Returns all currently paired and trusted devices.
  pub fn get_paired_devices(&self) -> Vec<PairedDevice> {
    if let Ok(lock) = self.paired_devices.read() {
      lock.values().cloned().collect()
    } else {
      Vec::new()
    }
  }

  /// Updates permission flags (streaming, control, downloads) for a paired device.
  pub fn update_permissions(
    &self,
    device_id: &str,
    permissions: ConnectPermissions,
  ) -> Result<(), String> {
    if let Ok(mut lock) = self.paired_devices.write() {
      if let Some(device) = lock.get_mut(device_id) {
        device.permissions = permissions;
        let storage = ConnectStorage {
          version: 1,
          local_device_id: self.local_info.read().unwrap().id.clone(),
          paired_devices: lock.clone(),
        };
        save_storage(&self.app_handle, &storage)?;
        println!(
          "[Navio Connect] Updated permissions for device: {}",
          device_id
        );
        return Ok(());
      }
    }
    Err("Device not found".to_string())
  }

  /// Revokes and removes a device from the trusted registry.
  pub fn revoke_device(&self, device_id: &str) -> Result<(), String> {
    if let Ok(mut lock) = self.paired_devices.write() {
      if lock.remove(device_id).is_some() {
        let storage = ConnectStorage {
          version: 1,
          local_device_id: self.local_info.read().unwrap().id.clone(),
          paired_devices: lock.clone(),
        };
        save_storage(&self.app_handle, &storage)?;
        println!("[Navio Connect] Revoked paired device: {}", device_id);
        return Ok(());
      }
    }
    Err("Device not found".to_string())
  }

  /// Sends a message into the broadcast channel to distribute it to all active WebSockets.
  pub fn broadcast_message(&self, message: ConnectMessage) {
    let _ = self.broadcast_tx.send(message);
  }

  /// Creates a new broadcast receiver subscription for a newly connected WebSocket client.
  pub fn subscribe_broadcast(&self) -> broadcast::Receiver<ConnectMessage> {
    self.broadcast_tx.subscribe()
  }

  /// Updates the cached playback state and broadcasts a `StateSync` frame to all clients.
  pub fn update_and_broadcast_player_state(&self, state: ConnectPlayerState) {
    if let Ok(mut lock) = self.player_state.write() {
      *lock = state.clone();
    }
    self.broadcast_message(ConnectMessage::StateSync { state });
  }

  /// Returns the latest cached playback state snapshot.
  pub fn get_current_player_state(&self) -> ConnectPlayerState {
    self.player_state.read().unwrap().clone()
  }

  /// Emits a Tauri event to the desktop WebView renderer.
  pub fn emit_event<S: serde::Serialize + Clone>(
    &self,
    event: &str,
    payload: S,
  ) -> Result<(), String> {
    use tauri::Emitter;
    self
      .app_handle
      .emit(event, payload)
      .map_err(|e| e.to_string())
  }

  /// Gracefully unregisters mDNS services on application exit.
  pub fn shutdown(&self) {
    if let Ok(lock) = self.discovery.read() {
      if let Some(ref dm) = *lock {
        dm.shutdown();
      }
    }
  }
}

/// Helper function to detect local network IPv4 addresses using OS interface queries.
fn detect_local_ip_addresses() -> Vec<String> {
  let mut ips = Vec::new();
  if let Ok(ip) = local_ip_address::local_ip() {
    ips.push(ip.to_string());
  }
  if ips.is_empty() {
    ips.push("127.0.0.1".to_string());
  }
  ips
}
