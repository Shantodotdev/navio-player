//! Tauri IPC command endpoints for Navio Connect.

use super::client::ConnectedHostInfo;
use super::models::{
  ConnectPermissions, ConnectPlaybackAction, ConnectPlayerState, DiscoveredPeer, LocalDeviceInfo,
  PairedDevice,
};
use crate::AppState;
use tauri::State;

/// Returns metadata describing this local Navio desktop instance and network status.
#[tauri::command]
pub fn connect_get_local_device(state: State<'_, AppState>) -> Result<LocalDeviceInfo, String> {
  Ok(state.connect_hub.get_local_info())
}

/// Returns the current list of other Navio peers discovered on the local network via mDNS.
#[tauri::command]
pub fn connect_get_discovered_peers(
  state: State<'_, AppState>,
) -> Result<Vec<DiscoveredPeer>, String> {
  Ok(state.connect_hub.get_discovered_peers())
}

/// Returns the list of all persistently paired and authorized devices.
#[tauri::command]
pub fn connect_get_paired_devices(state: State<'_, AppState>) -> Result<Vec<PairedDevice>, String> {
  Ok(state.connect_hub.get_paired_devices())
}

/// Generates a new 4-digit pairing PIN code and returns it for display on screen.
#[tauri::command]
pub fn connect_generate_pairing_pin(state: State<'_, AppState>) -> Result<String, String> {
  Ok(state.connect_hub.generate_pairing_pin())
}

/// Retrieves the active pairing PIN code if currently valid.
#[tauri::command]
pub fn connect_get_active_pin(state: State<'_, AppState>) -> Result<Option<String>, String> {
  Ok(state.connect_hub.get_active_pin())
}

/// Updates the granular permission toggles for a paired device.
#[tauri::command]
pub fn connect_update_device_permissions(
  state: State<'_, AppState>,
  device_id: String,
  permissions: ConnectPermissions,
) -> Result<(), String> {
  state
    .connect_hub
    .update_permissions(&device_id, permissions)
}

/// Revokes authorization for a paired device.
#[tauri::command]
pub fn connect_revoke_device(state: State<'_, AppState>, device_id: String) -> Result<(), String> {
  state.connect_hub.revoke_device(&device_id)
}

/// Dispatched by the frontend player whenever local media state changes (play/pause/seek/track/volume).
#[tauri::command]
pub fn connect_broadcast_playback_state(
  state: State<'_, AppState>,
  player_state: ConnectPlayerState,
) -> Result<(), String> {
  state
    .connect_hub
    .update_and_broadcast_player_state(player_state);
  Ok(())
}

/// Initiates a pairing handshake with a remote Navio host using its PIN.
#[tauri::command]
pub async fn connect_pair_with_peer(
  state: State<'_, AppState>,
  host_id: String,
  address: String,
  port: u16,
  pin: String,
) -> Result<ConnectedHostInfo, String> {
  let local_info = state.connect_hub.get_local_info();
  let (host_info, token) = state
    .connect_client
    .pair_with_pin(
      host_id.clone(),
      address,
      port,
      pin,
      local_info.id,
      local_info.name,
    )
    .await?;

  // Save the token for future auto-reconnects
  println!(
    "[Navio Connect] Successfully paired with remote host \"{}\" ({})",
    host_info.host_name, host_id
  );
  let _ = token; // Can be persisted in paired hosts store

  Ok(host_info)
}

/// Connects to a previously paired remote Navio host using an authentication token.
#[tauri::command]
pub async fn connect_connect_to_peer(
  state: State<'_, AppState>,
  host_id: String,
  address: String,
  port: u16,
  token: String,
) -> Result<ConnectedHostInfo, String> {
  let local_info = state.connect_hub.get_local_info();
  state
    .connect_client
    .connect_with_token(host_id, address, port, token, local_info.id)
    .await
}

/// Sends a playback command (play/pause/seek/volume) to the currently active remote host.
#[tauri::command]
pub fn connect_send_remote_command(
  state: State<'_, AppState>,
  action: ConnectPlaybackAction,
) -> Result<(), String> {
  state.connect_client.send_command(action)
}

/// Disconnects from the currently active remote host.
#[tauri::command]
pub fn connect_disconnect_remote(state: State<'_, AppState>) -> Result<(), String> {
  state.connect_client.disconnect();
  Ok(())
}

/// Returns the currently active connected host info if controlling a remote machine.
#[tauri::command]
pub fn connect_get_active_remote_host(
  state: State<'_, AppState>,
) -> Result<Option<ConnectedHostInfo>, String> {
  Ok(state.connect_client.get_active_host())
}
