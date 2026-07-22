import { create } from "zustand";
import { useSettingsStore } from "./settingsStore";

/// Representation of a media file track on the client side.
export type Track = {
  id: string;
  path: string;
  name: string;
  title?: string;
  duration_secs: number;
  file_size_bytes?: number;
  media_type: "audio" | "video";
  cover_cache_path?: string;
};

/** Session-only repeat behavior for natural media completion. */
export type RepeatMode = "off" | "all" | "one";

/// The player state slice representing media queues and current progress.
interface PlayerState {
  /// The active track loaded in the player.
  currentTrack: Track | null;
  /// Queue of files scheduled for playback.
  playlist: Track[];
  /// Index of the current track within the playlist.
  playIndex: number;
  /// True if the media is currently playing.
  isPlaying: boolean;
  /// Active dynamic HTTP streaming port retrieved from Rust.
  streamPort: number;
  /// Per-run token required by the local stream server.
  streamToken: string;
  /// Playback time in seconds.
  currentTime: number;
  /// App-wide volume percentage (0 - 100).
  volume: number;
  /// Whether playback traverses the canonical queue in shuffled order.
  shuffleEnabled: boolean;
  /// Repeat behavior applied when the current media ends naturally.
  repeatMode: RepeatMode;
  /// Unplayed track IDs remaining in the active shuffled cycle.
  shufflePendingIds: string[];
  /// Actual shuffled playback path, including the current track as the final ID.
  shuffleHistoryIds: string[];
  /// Now Playing sidebar drawer toggle state.
  isDrawerOpen: boolean;
  /// Full-app theater mode for the active video.
  isTheaterOpen: boolean;
  /// Reference to the DOM media player element.
  mediaElement: HTMLVideoElement | null;

  // Actions
  /// Load a specific track and option queue into the active playlist.
  playTrack: (track: Track, fromPlaylist?: Track[]) => void;
  /// Pause or play.
  setIsPlaying: (playing: boolean) => void;
  /**
   * Pause playback and reset both the active media element and stored position.
   * This provides true stop semantics shared by the UI and MCP transport.
   */
  stopPlayback: () => void;
  /**
   * Seek to a clamped absolute playback position.
   * Returns false without mutation when the supplied value is not finite.
   */
  seekTo: (seconds: number) => boolean;
  /**
   * Seek relative to the live media-element position, falling back to stored time.
   * Returns false without mutation when the offset is not finite.
   */
  seekBy: (seconds: number) => boolean;
  /// Seek to a specific progress timestamp.
  setCurrentTime: (time: number) => void;
  /// Set audio volume.
  setVolume: (volume: number) => void;
  /// Enable or disable shuffled traversal without reordering the visible queue.
  toggleShuffle: () => void;
  /// Cycle repeat behavior through off, all, one, and back to off.
  cycleRepeatMode: () => void;
  /// Resolve a natural media completion according to repeat and shuffle state.
  handleTrackEnded: () => void;
  /// Skip to next queue item.
  nextTrack: () => void;
  /// Backtrack to previous queue item.
  prevTrack: () => void;
  /// Store the backend streaming server port.
  setStreamPort: (port: number) => void;
  /// Store the backend streaming server connection settings.
  setStreamConfig: (config: { port: number; token: string }) => void;
  /// Override the queue list.
  setPlaylist: (tracks: Track[]) => void;
  /**
   * Append one unique local track to the active queue.
   * When no explicit queue exists, the current track becomes its first entry.
   */
  addToQueue: (track: Track) => void;
  /**
   * Remove one queue item while preserving the current media and a valid index.
   * Removing the active item selects a neighboring replacement or stops playback.
   */
  removeQueueIndex: (index: number) => boolean;
  /** Remove every queued item except the current track, when one is active. */
  clearQueue: () => void;
  /** Start one valid queue index using the shared `playTrack` implementation. */
  playQueueIndex: (index: number) => boolean;
  /// Open/Close the Now Playing right drawer.
  setDrawerOpen: (open: boolean) => void;
  /// Toggle the Now Playing right drawer.
  toggleDrawer: () => void;
  /// Open or close the theater presentation for a video.
  setTheaterOpen: (open: boolean) => void;
  /// Set the reference to the unified background video/audio element.
  setMediaElement: (element: HTMLVideoElement | null) => void;
  /// Clear the media element only when the caller still owns the active reference.
  clearMediaElement: (element: HTMLVideoElement | null) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTrack: null,
  playlist: [],
  playIndex: -1,
  isPlaying: false,
  streamPort: 0,
  streamToken: "",
  currentTime: 0,
  volume: 80,
  shuffleEnabled: false,
  repeatMode: "off",
  shufflePendingIds: [],
  shuffleHistoryIds: [],
  isDrawerOpen: false,
  isTheaterOpen: false,
  mediaElement: null,

  playTrack: (track, fromPlaylist = []) => {
    const { streamPort, streamToken, mediaElement } = get();
    const list = fromPlaylist.length > 0 ? fromPlaylist : [track];
    const idx = list.findIndex((t) => t.id === track.id);

    const shufflePendingIds = get().shuffleEnabled
      ? shuffleTrackIds(list.filter((item) => item.id !== track.id))
      : [];

    set({
      playlist: list,
      currentTrack: track,
      playIndex: idx !== -1 ? idx : 0,
      isPlaying: true,
      currentTime: 0,
      isDrawerOpen: true,
      isTheaterOpen: false,
      shufflePendingIds,
      shuffleHistoryIds: get().shuffleEnabled ? [track.id] : [],
    });

    if (mediaElement) {
      const srcUrl = buildStreamUrl(streamPort, streamToken, track.path);
      mediaElement.src = srcUrl;
      mediaElement
        .play()
        .catch((err) =>
          console.warn("Playback autoplay blocked or failed:", err),
        );
    }
  },

  setIsPlaying: (playing) => {
    const { mediaElement } = get();
    set({ isPlaying: playing });
    if (mediaElement) {
      if (playing) {
        mediaElement.play().catch((err) => console.warn("Play failed:", err));
      } else {
        mediaElement.pause();
      }
    }
  },

  stopPlayback: () => {
    const { mediaElement } = get();
    if (mediaElement) {
      mediaElement.pause();
      mediaElement.currentTime = 0;
    }
    set({ isPlaying: false, currentTime: 0 });
  },

  seekTo: (seconds) => {
    if (!Number.isFinite(seconds)) return false;
    const { mediaElement } = get();
    const duration = mediaElement?.duration;
    const maximum =
      duration !== undefined && Number.isFinite(duration) && duration > 0
        ? duration
        : Number.POSITIVE_INFINITY;
    const target = Math.min(maximum, Math.max(0, seconds));
    if (mediaElement) mediaElement.currentTime = target;
    set({ currentTime: target });
    return true;
  },

  seekBy: (seconds) => {
    if (!Number.isFinite(seconds)) return false;
    const { currentTime, mediaElement } = get();
    const liveTime =
      mediaElement && Number.isFinite(mediaElement.currentTime)
        ? mediaElement.currentTime
        : currentTime;
    return get().seekTo(liveTime + seconds);
  },

  setCurrentTime: (time) => {
    set({ currentTime: time });
  },

  setVolume: (volume) => {
    const { mediaElement } = get();
    set({ volume });
    void useSettingsStore
      .getState()
      .updateSettings({ playback: { volume } })
      .catch(() => undefined);
    if (mediaElement) {
      mediaElement.volume = volume / 100;
    }
  },

  toggleShuffle: () => {
    const { currentTrack, playlist, shuffleEnabled } = get();
    if (shuffleEnabled) {
      set({
        shuffleEnabled: false,
        shufflePendingIds: [],
        shuffleHistoryIds: [],
        playIndex: currentTrack
          ? playlist.findIndex((track) => track.id === currentTrack.id)
          : -1,
      });
      return;
    }

    set({
      shuffleEnabled: true,
      shufflePendingIds: currentTrack
        ? shuffleTrackIds(
            playlist.filter((track) => track.id !== currentTrack.id),
          )
        : [],
      shuffleHistoryIds: currentTrack ? [currentTrack.id] : [],
    });
  },

  cycleRepeatMode: () => {
    const nextMode: Record<RepeatMode, RepeatMode> = {
      off: "all",
      all: "one",
      one: "off",
    };
    set({ repeatMode: nextMode[get().repeatMode] });
  },

  handleTrackEnded: () => {
    const {
      currentTrack,
      mediaElement,
      playlist,
      playIndex,
      repeatMode,
      shuffleEnabled,
      shufflePendingIds,
    } = get();
    if (!currentTrack) return;

    if (repeatMode === "one") {
      if (mediaElement) {
        mediaElement.currentTime = 0;
        mediaElement
          .play()
          .catch((error) => console.warn("Repeat track failed:", error));
      }
      set({ currentTime: 0, isPlaying: true });
      return;
    }

    const hasShuffledTrack = shufflePendingIds.some((id) =>
      playlist.some((track) => track.id === id),
    );
    const isAtEnd = shuffleEnabled
      ? !hasShuffledTrack
      : playIndex >= playlist.length - 1;
    if (repeatMode === "off" && isAtEnd) {
      set({ isPlaying: false });
      return;
    }

    get().nextTrack();
  },

  nextTrack: () => {
    const {
      currentTrack,
      playlist,
      playIndex,
      shuffleEnabled,
      shuffleHistoryIds,
      shufflePendingIds,
      streamPort,
      streamToken,
      mediaElement,
    } = get();
    if (playlist.length === 0 || playIndex === -1) return;

    let nextIdx = (playIndex + 1) % playlist.length;
    let pendingIds = shufflePendingIds.filter((id) =>
      playlist.some((track) => track.id === id),
    );
    let historyIds = shuffleHistoryIds;

    if (shuffleEnabled && currentTrack) {
      if (pendingIds.length === 0) {
        pendingIds = shuffleTrackIds(
          playlist.filter((track) => track.id !== currentTrack.id),
        );
      }

      const nextId = pendingIds[0] ?? currentTrack.id;
      const shuffledIndex = playlist.findIndex((track) => track.id === nextId);
      if (shuffledIndex === -1) return;
      nextIdx = shuffledIndex;
      pendingIds = pendingIds.slice(1);
      const historyBase =
        historyIds.at(-1) === currentTrack.id
          ? historyIds
          : [...historyIds, currentTrack.id];
      historyIds = [...historyBase, nextId];
    }

    const track = playlist[nextIdx];
    if (!track) return;

    set({
      playIndex: nextIdx,
      currentTrack: track,
      isPlaying: true,
      currentTime: 0,
      isTheaterOpen: track.media_type === "video" ? get().isTheaterOpen : false,
      shufflePendingIds: shuffleEnabled ? pendingIds : [],
      shuffleHistoryIds: shuffleEnabled ? historyIds : [],
    });

    if (mediaElement && track) {
      const srcUrl = buildStreamUrl(streamPort, streamToken, track.path);
      mediaElement.src = srcUrl;
      mediaElement
        .play()
        .catch((err) => console.warn("Next track play failed:", err));
    }
  },

  prevTrack: () => {
    const {
      currentTrack,
      playlist,
      playIndex,
      shuffleEnabled,
      shuffleHistoryIds,
      shufflePendingIds,
      streamPort,
      streamToken,
      mediaElement,
    } = get();
    if (playlist.length === 0 || playIndex === -1) return;

    let prevIdx = (playIndex - 1 + playlist.length) % playlist.length;
    let pendingIds = shufflePendingIds;
    let historyIds = shuffleHistoryIds;
    if (shuffleEnabled && currentTrack && historyIds.length > 1) {
      const previousId = historyIds.at(-2);
      const shuffledIndex = playlist.findIndex(
        (track) => track.id === previousId,
      );
      if (shuffledIndex === -1) return;
      prevIdx = shuffledIndex;
      historyIds = historyIds.slice(0, -1);
      pendingIds = [
        currentTrack.id,
        ...pendingIds.filter((id) => id !== currentTrack.id),
      ];
    } else if (shuffleEnabled && currentTrack) {
      if (mediaElement) mediaElement.currentTime = 0;
      set({ currentTime: 0, isPlaying: true });
      void mediaElement
        ?.play()
        .catch((error) => console.warn("Restart track failed:", error));
      return;
    }

    const track = playlist[prevIdx];
    if (!track) return;

    set({
      playIndex: prevIdx,
      currentTrack: track,
      isPlaying: true,
      currentTime: 0,
      isTheaterOpen: track.media_type === "video" ? get().isTheaterOpen : false,
      shufflePendingIds: shuffleEnabled ? pendingIds : [],
      shuffleHistoryIds: shuffleEnabled ? historyIds : [],
    });

    if (mediaElement && track) {
      const srcUrl = buildStreamUrl(streamPort, streamToken, track.path);
      mediaElement.src = srcUrl;
      mediaElement
        .play()
        .catch((err) => console.warn("Prev track play failed:", err));
    }
  },

  setStreamPort: (port) => set({ streamPort: port }),
  setStreamConfig: ({ port, token }) =>
    set({ streamPort: port, streamToken: token }),
  setPlaylist: (tracks) => {
    const { currentTrack, shuffleEnabled } = get();
    const currentIndex = currentTrack
      ? tracks.findIndex((track) => track.id === currentTrack.id)
      : -1;
    set({
      playlist: tracks,
      playIndex: currentIndex,
      shufflePendingIds:
        shuffleEnabled && currentTrack
          ? shuffleTrackIds(
              tracks.filter((track) => track.id !== currentTrack.id),
            )
          : [],
      shuffleHistoryIds:
        shuffleEnabled && currentTrack ? [currentTrack.id] : [],
    });
  },
  addToQueue: (track) => {
    const { currentTrack, playlist, shuffleEnabled, shufflePendingIds } = get();
    const base =
      playlist.length > 0 ? playlist : currentTrack ? [currentTrack] : [];
    if (base.some((item) => item.id === track.id)) return;
    set({
      playlist: [...base, track],
      shufflePendingIds: shuffleEnabled
        ? shuffleTrackIds([
            ...base.filter((item) => shufflePendingIds.includes(item.id)),
            track,
          ])
        : [],
    });
  },
  removeQueueIndex: (index) => {
    const {
      isPlaying,
      mediaElement,
      playIndex,
      playlist,
      shuffleEnabled,
      shuffleHistoryIds,
      shufflePendingIds,
    } = get();
    if (!Number.isInteger(index) || index < 0 || index >= playlist.length) {
      return false;
    }
    const removed = playlist[index];
    if (!removed) return false;
    const updated = playlist.filter((_, itemIndex) => itemIndex !== index);
    const traversalPatch = {
      shufflePendingIds: shufflePendingIds.filter((id) => id !== removed.id),
      shuffleHistoryIds: shuffleHistoryIds.filter((id) => id !== removed.id),
    };
    if (index < playIndex) {
      set({ playlist: updated, playIndex: playIndex - 1, ...traversalPatch });
      return true;
    }
    if (index !== playIndex) {
      set({ playlist: updated, ...traversalPatch });
      return true;
    }

    const replacement = updated[Math.min(index, updated.length - 1)];
    if (!replacement) {
      mediaElement?.pause();
      set({
        playlist: [],
        playIndex: -1,
        currentTrack: null,
        currentTime: 0,
        isPlaying: false,
        isTheaterOpen: false,
        shufflePendingIds: [],
        shuffleHistoryIds: [],
      });
      return true;
    }
    set({
      playlist: updated,
      playIndex: Math.min(index, updated.length - 1),
      currentTrack: replacement,
      currentTime: 0,
      isPlaying,
      isTheaterOpen:
        replacement.media_type === "video" ? get().isTheaterOpen : false,
      shufflePendingIds: shuffleEnabled
        ? shuffleTrackIds(
            updated.filter((track) => track.id !== replacement.id),
          )
        : [],
      shuffleHistoryIds: shuffleEnabled ? [replacement.id] : [],
    });
    if (mediaElement) {
      mediaElement.src = buildStreamUrl(
        get().streamPort,
        get().streamToken,
        replacement.path,
      );
      if (isPlaying) {
        mediaElement
          .play()
          .catch((error) => console.warn("Queue replacement failed:", error));
      }
    }
    return true;
  },
  clearQueue: () => {
    const { currentTrack, shuffleEnabled } = get();
    set({
      playlist: currentTrack ? [currentTrack] : [],
      playIndex: currentTrack ? 0 : -1,
      shufflePendingIds: [],
      shuffleHistoryIds:
        shuffleEnabled && currentTrack ? [currentTrack.id] : [],
    });
  },
  playQueueIndex: (index) => {
    const { playlist } = get();
    if (!Number.isInteger(index) || index < 0 || index >= playlist.length) {
      return false;
    }
    const track = playlist[index];
    if (!track) return false;
    get().playTrack(track, playlist);
    return true;
  },
  setDrawerOpen: (open) => set({ isDrawerOpen: open }),
  toggleDrawer: () => set((state) => ({ isDrawerOpen: !state.isDrawerOpen })),
  setTheaterOpen: (open) => {
    const { currentTrack } = get();
    set({ isTheaterOpen: open && currentTrack?.media_type === "video" });
  },

  setMediaElement: (element) => {
    const {
      currentTime,
      currentTrack,
      isPlaying,
      mediaElement,
      streamPort,
      streamToken,
      volume,
    } = get();
    if (element) {
      element.volume = volume / 100;

      if (currentTrack && element !== mediaElement) {
        element.src = buildStreamUrl(
          streamPort,
          streamToken,
          currentTrack.path,
        );
        element.currentTime = currentTime;

        if (isPlaying) {
          element
            .play()
            .catch((err) => console.warn("Playback resume failed:", err));
        }
      }
    }
    set({ mediaElement: element });
  },

  clearMediaElement: (element) => {
    if (element && get().mediaElement === element) {
      set({ mediaElement: null });
    }
  },
}));

function buildStreamUrl(port: number, token: string, path: string): string {
  const encodedPath = encodeURIComponent(path);
  const encodedToken = encodeURIComponent(token);
  return `http://127.0.0.1:${port}/stream/${encodedPath}?token=${encodedToken}`;
}

/** Returns a Fisher-Yates shuffled copy without mutating the canonical queue. */
function shuffleTrackIds(tracks: Track[]): string[] {
  const ids = tracks.map((track) => track.id);
  for (let index = ids.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = ids[index];
    const replacement = ids[swapIndex];
    if (current === undefined || replacement === undefined) continue;
    ids[index] = replacement;
    ids[swapIndex] = current;
  }
  return ids;
}
