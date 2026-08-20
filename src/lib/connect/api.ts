/**
 * Navio Connect Tauri IPC API client bindings.
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  ConnectedHostInfo,
  ConnectPermissions,
  ConnectPlaybackAction,
  ConnectPlayerState,
  DiscoveredPeer,
  LocalDeviceInfo,
  PairedDevice,
} from "./types";

/**
 * Checks if running inside the native Tauri runtime shell.
 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Retrieves metadata describing this local desktop Navio instance and network status.
 */
export async function getLocalDeviceInfo(): Promise<LocalDeviceInfo | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<LocalDeviceInfo>("connect_get_local_device");
  } catch (error) {
    console.error("[Navio Connect] Failed to get local device info:", error);
    return null;
  }
}

/**
 * Retrieves the list of discovered Navio peers on the local network via mDNS.
 */
export async function getDiscoveredPeers(): Promise<DiscoveredPeer[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<DiscoveredPeer[]>("connect_get_discovered_peers");
  } catch (error) {
    console.error("[Navio Connect] Failed to get discovered peers:", error);
    return [];
  }
}

/**
 * Retrieves all persistently paired and authorized devices from storage.
 */
export async function getPairedDevices(): Promise<PairedDevice[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<PairedDevice[]>("connect_get_paired_devices");
  } catch (error) {
    console.error("[Navio Connect] Failed to get paired devices:", error);
    return [];
  }
}

/**
 * Generates a new random 4-digit pairing PIN code on the host.
 */
export async function generatePairingPin(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<string>("connect_generate_pairing_pin");
  } catch (error) {
    console.error("[Navio Connect] Failed to generate pairing PIN:", error);
    return null;
  }
}

/**
 * Gets the active pairing PIN code if currently valid.
 */
export async function getActivePin(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<string | null>("connect_get_active_pin");
  } catch (error) {
    console.error("[Navio Connect] Failed to get active PIN:", error);
    return null;
  }
}

/**
 * Updates granular permission flags for a paired device.
 */
export async function updateDevicePermissions(
  deviceId: string,
  permissions: ConnectPermissions
): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    await invoke("connect_update_device_permissions", { deviceId, permissions });
    return true;
  } catch (error) {
    console.error("[Navio Connect] Failed to update permissions:", error);
    return false;
  }
}

/**
 * Revokes authorization for a paired device.
 */
export async function revokeDevice(deviceId: string): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    await invoke("connect_revoke_device", { deviceId });
    return true;
  } catch (error) {
    console.error("[Navio Connect] Failed to revoke device:", error);
    return false;
  }
}

/**
 * Broadcasts the current local playback state to all connected WebSocket clients.
 */
export async function broadcastPlaybackState(
  playerState: ConnectPlayerState
): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("connect_broadcast_playback_state", { playerState });
  } catch (error) {
    console.error("[Navio Connect] Failed to broadcast playback state:", error);
  }
}

/**
 * Pairs with a remote host peer using its 4-digit PIN code.
 */
export async function pairWithPeer(
  hostId: string,
  address: string,
  port: number,
  pin: string
): Promise<ConnectedHostInfo | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<ConnectedHostInfo>("connect_pair_with_peer", {
      hostId,
      address,
      port,
      pin,
    });
  } catch (error) {
    console.error("[Navio Connect] Pairing with peer failed:", error);
    throw error;
  }
}

/**
 * Connects to a previously paired remote host using an authentication token.
 */
export async function connectToPeer(
  hostId: string,
  address: string,
  port: number,
  token: string
): Promise<ConnectedHostInfo | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<ConnectedHostInfo>("connect_connect_to_peer", {
      hostId,
      address,
      port,
      token,
    });
  } catch (error) {
    console.error("[Navio Connect] Connect to peer failed:", error);
    throw error;
  }
}

/**
 * Dispatches a playback command (Play/Pause/Seek/Volume) to the actively connected remote host.
 */
export async function sendRemoteCommand(
  action: ConnectPlaybackAction
): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    await invoke("connect_send_remote_command", { action });
    return true;
  } catch (error) {
    console.error("[Navio Connect] Failed to send remote command:", error);
    return false;
  }
}

/**
 * Disconnects from the current remote host session.
 */
export async function disconnectRemote(): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("connect_disconnect_remote");
  } catch (error) {
    console.error("[Navio Connect] Failed to disconnect remote:", error);
  }
}

/**
 * Dispatches a remote download request to the actively connected remote host.
 */
export async function sendRemoteDownload(
  url: string,
  title?: string
): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    await invoke("connect_send_remote_download", { url, title });
    return true;
  } catch (error) {
    console.error("[Navio Connect] Failed to send remote download:", error);
    return false;
  }
}

/**
 * Returns active remote host information if currently in controller mode.
 */
export async function getActiveRemoteHost(): Promise<ConnectedHostInfo | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<ConnectedHostInfo | null>(
      "connect_get_active_remote_host"
    );
  } catch (error) {
    console.error("[Navio Connect] Failed to get active remote host:", error);
    return null;
  }
}
