/**
 * TypeScript type definitions for Navio Connect (P2P Discovery, WebSocket Hub & Remote Control).
 */

export type DeviceType = "desktop" | "mobile" | "tablet" | "web";

export type Platform =
  | "windows"
  | "macos"
  | "linux"
  | "ios"
  | "android"
  | "web"
  | "unknown";

export interface ConnectPermissions {
  allowViewLibrary: boolean;
  allowStreaming: boolean;
  allowPlaybackControl: boolean;
  allowRemoteDownload: boolean;
}

export interface PairedDevice {
  id: string;
  name: string;
  deviceType: DeviceType;
  platform: Platform;
  token: string;
  permissions: ConnectPermissions;
  pairedAtMs: number;
  lastSeenMs: number;
}

export interface DiscoveredPeer {
  id: string;
  name: string;
  addresses: string[];
  port: number;
  deviceType: DeviceType;
  platform: Platform;
  version: string;
  lastSeenMs: number;
}

export interface LocalDeviceInfo {
  id: string;
  name: string;
  port: number;
  localIps: string[];
  platform: Platform;
  version: string;
}

export interface ConnectPlayerState {
  title: string;
  artist?: string | null;
  album?: string | null;
  durationMs: number;
  positionMs: number;
  isPlaying: boolean;
  volume: number;
  mediaType: string;
  thumbnailUrl?: string | null;
  queueLength: number;
  queueIndex: number;
  updatedAtMs: number;
}

export type ConnectPlaybackAction =
  | { action: "play" }
  | { action: "pause" }
  | { action: "toggle_play" }
  | { action: "seek"; payload: { position_ms: number } }
  | { action: "set_volume"; payload: { volume: number } }
  | { action: "next_track" }
  | { action: "previous_track" }
  | { action: "select_queue_item"; payload: { index: number } };

export interface ConnectedHostInfo {
  hostId: string;
  hostName: string;
  address: string;
  port: number;
  permissions: ConnectPermissions;
}
