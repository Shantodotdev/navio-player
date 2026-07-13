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
  /// Seek to a specific progress timestamp.
  setCurrentTime: (time: number) => void;
  /// Set audio volume.
  setVolume: (volume: number) => void;
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
  isDrawerOpen: false,
  isTheaterOpen: false,
  mediaElement: null,

  playTrack: (track, fromPlaylist = []) => {
    const { streamPort, streamToken, mediaElement } = get();
    const list = fromPlaylist.length > 0 ? fromPlaylist : [track];
    const idx = list.findIndex((t) => t.id === track.id);

    set({
      playlist: list,
      currentTrack: track,
      playIndex: idx !== -1 ? idx : 0,
      isPlaying: true,
      currentTime: 0,
      isDrawerOpen: true,
      isTheaterOpen: false,
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

  setCurrentTime: (time) => {
    set({ currentTime: time });
  },

  setVolume: (volume) => {
    const { mediaElement } = get();
    set({ volume });
    void useSettingsStore.getState().updateSettings({ playback: { volume } });
    if (mediaElement) {
      mediaElement.volume = volume / 100;
    }
  },

  nextTrack: () => {
    const { playlist, playIndex, streamPort, streamToken, mediaElement } =
      get();
    if (playlist.length === 0 || playIndex === -1) return;
    const nextIdx = (playIndex + 1) % playlist.length;
    const track = playlist[nextIdx];

    set({
      playIndex: nextIdx,
      currentTrack: track,
      isPlaying: true,
      currentTime: 0,
      isTheaterOpen: track.media_type === "video" ? get().isTheaterOpen : false,
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
    const { playlist, playIndex, streamPort, streamToken, mediaElement } =
      get();
    if (playlist.length === 0 || playIndex === -1) return;
    const prevIdx = (playIndex - 1 + playlist.length) % playlist.length;
    const track = playlist[prevIdx];

    set({
      playIndex: prevIdx,
      currentTrack: track,
      isPlaying: true,
      currentTime: 0,
      isTheaterOpen: track.media_type === "video" ? get().isTheaterOpen : false,
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
  setPlaylist: (tracks) => set({ playlist: tracks }),
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
