/**
 * React hook to synchronize Navio Connect peer discovery, remote playback commands, and state broadcasting.
 */

import { useEffect, useRef } from "react";
import { isTauri } from "../lib/connect/api";
import type {
  ConnectPlaybackAction,
  ConnectPlayerState,
} from "../lib/connect/types";
import { useConnectStore } from "../store/connectStore";
import { usePlayerStore } from "../store/playerStore";
import { toast } from "../store/toastStore";

/**
 * Coordinates Navio Connect discovery, playback commands, and state broadcasting.
 */
export function useConnectSync() {
  const initialize = useConnectStore((state) => state.initialize);
  const refreshDiscoveredPeers = useConnectStore(
    (state) => state.refreshDiscoveredPeers
  );
  const setRemotePlayerState = useConnectStore(
    (state) => state.setRemotePlayerState
  );

  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const currentTime = usePlayerStore((state) => state.currentTime);
  const volume = usePlayerStore((state) => state.volume);
  const playlist = usePlayerStore((state) => state.playlist);
  const playIndex = usePlayerStore((state) => state.playIndex);

  const lastBroadcastRef = useRef<number>(0);

  // 1. Initialize store and periodic peer discovery refresh timer
  useEffect(() => {
    if (!isTauri()) return;

    void initialize();

    // Refresh discovered peers every 5 seconds while active
    const interval = setInterval(() => {
      void refreshDiscoveredPeers();
    }, 5000);

    return () => clearInterval(interval);
  }, [initialize, refreshDiscoveredPeers]);

  // 2. Broadcast local player state changes to connected remote controllers
  useEffect(() => {
    if (!isTauri()) return;

    const now = Date.now();
    // Throttle state broadcasts to at most once every 500ms for continuous scrub updates
    if (now - lastBroadcastRef.current < 500 && isPlaying) {
      return;
    }
    lastBroadcastRef.current = now;

    const playerState: ConnectPlayerState = {
      title: currentTrack?.title || currentTrack?.name || "No Media Playing",
      artist: null,
      album: null,
      durationMs: Math.round((currentTrack?.duration_secs || 0) * 1000),
      positionMs: Math.round(currentTime * 1000),
      isPlaying,
      volume: volume / 100,
      mediaType: currentTrack?.media_type || "audio",
      thumbnailUrl: currentTrack?.cover_cache_path || null,
      queueLength: playlist.length,
      queueIndex: playIndex,
      updatedAtMs: now,
    };

    import("../lib/connect/api").then(({ broadcastPlaybackState }) => {
      void broadcastPlaybackState(playerState);
    });
  }, [currentTrack, isPlaying, currentTime, volume, playlist.length, playIndex]);

  // 3. Listen to incoming commands and remote events from the Rust backend
  useEffect(() => {
    if (!isTauri()) return;

    let unlistenCommand: (() => void) | undefined;
    let unlistenSync: (() => void) | undefined;
    let unlistenDisconnect: (() => void) | undefined;
    let unlistenDownload: (() => void) | undefined;

    async function setupListeners() {
      const { listen } = await import("@tauri-apps/api/event");

      // Handle playback command received from a remote controller
      unlistenCommand = await listen<ConnectPlaybackAction>(
        "navio-connect://playback-command",
        (event) => {
          const action = event.payload;
          const player = usePlayerStore.getState();

          switch (action.action) {
            case "play":
              player.setIsPlaying(true);
              break;
            case "pause":
              player.setIsPlaying(false);
              break;
            case "toggle_play":
              player.setIsPlaying(!player.isPlaying);
              break;
            case "seek":
              if (player.mediaElement) {
                player.mediaElement.currentTime =
                  action.payload.position_ms / 1000;
              }
              break;
            case "set_volume":
              player.setVolume(Math.round(action.payload.volume * 100));
              break;
            case "next_track":
              player.nextTrack();
              break;
            case "previous_track":
              player.prevTrack();
              break;
            case "select_queue_item": {
              const targetTrack = player.playlist[action.payload.index];
              if (targetTrack) {
                player.playTrack(targetTrack);
              }
              break;
            }
          }
        }
      );

      // Handle remote state sync received when this client is controlling another device
      unlistenSync = await listen<ConnectPlayerState>(
        "navio-connect://remote-state-sync",
        (event) => {
          setRemotePlayerState(event.payload);
        }
      );

      // Handle disconnection event from remote host
      unlistenDisconnect = await listen(
        "navio-connect://remote-disconnected",
        () => {
          useConnectStore.getState().disconnectRemote();
          toast.info("Disconnected from remote host");
        }
      );

      // Handle remote download notification
      unlistenDownload = await listen<{ url: string; title?: string }>(
        "navio-connect://remote-download",
        async (event) => {
          toast.info(
            `Remote download queued: ${event.payload.title || event.payload.url}`
          );
        }
      );
    }

    void setupListeners();

    return () => {
      unlistenCommand?.();
      unlistenSync?.();
      unlistenDisconnect?.();
      unlistenDownload?.();
    };
  }, [setRemotePlayerState]);
}
