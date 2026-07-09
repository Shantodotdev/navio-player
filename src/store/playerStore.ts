import { create } from "zustand";

/// Representation of a media file track on the client side.
export type Track = {
  id: string;
  path: string;
  name: string;
  title?: string;
  artist?: string;
  album?: string;
  duration_secs: number;
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
  /// Playback time in seconds.
  currentTime: number;
  /// App-wide volume percentage (0 - 100).
  volume: number;
  /// Now Playing sidebar drawer toggle state.
  isDrawerOpen: boolean;
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
  /// Override the queue list.
  setPlaylist: (tracks: Track[]) => void;
  /// Open/Close the Now Playing right drawer.
  setDrawerOpen: (open: boolean) => void;
  /// Toggle the Now Playing right drawer.
  toggleDrawer: () => void;
  /// Set the reference to the unified background video/audio element.
  setMediaElement: (element: HTMLVideoElement | null) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTrack: null,
  playlist: [],
  playIndex: -1,
  isPlaying: false,
  streamPort: 0,
  currentTime: 0,
  volume: 80,
  isDrawerOpen: false,
  mediaElement: null,

  playTrack: (track, fromPlaylist = []) => {
    const { streamPort, mediaElement } = get();
    const list = fromPlaylist.length > 0 ? fromPlaylist : [track];
    const idx = list.findIndex((t) => t.id === track.id);
    
    set({
      playlist: list,
      currentTrack: track,
      playIndex: idx !== -1 ? idx : 0,
      isPlaying: true,
      currentTime: 0,
    });

    if (mediaElement) {
      const srcUrl = `http://127.0.0.1:${streamPort}/stream/${encodeURIComponent(track.path)}`;
      mediaElement.src = srcUrl;
      mediaElement.play().catch(err => console.warn("Playback autoplay blocked or failed:", err));
    }
  },

  setIsPlaying: (playing) => {
    const { mediaElement } = get();
    set({ isPlaying: playing });
    if (mediaElement) {
      if (playing) {
        mediaElement.play().catch(err => console.warn("Play failed:", err));
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
    if (mediaElement) {
      mediaElement.volume = volume / 100;
    }
  },

  nextTrack: () => {
    const { playlist, playIndex, streamPort, mediaElement } = get();
    if (playlist.length === 0 || playIndex === -1) return;
    const nextIdx = (playIndex + 1) % playlist.length;
    const track = playlist[nextIdx];

    set({
      playIndex: nextIdx,
      currentTrack: track,
      isPlaying: true,
      currentTime: 0,
    });

    if (mediaElement && track) {
      const srcUrl = `http://127.0.0.1:${streamPort}/stream/${encodeURIComponent(track.path)}`;
      mediaElement.src = srcUrl;
      mediaElement.play().catch(err => console.warn("Next track play failed:", err));
    }
  },

  prevTrack: () => {
    const { playlist, playIndex, streamPort, mediaElement } = get();
    if (playlist.length === 0 || playIndex === -1) return;
    const prevIdx = (playIndex - 1 + playlist.length) % playlist.length;
    const track = playlist[prevIdx];

    set({
      playIndex: prevIdx,
      currentTrack: track,
      isPlaying: true,
      currentTime: 0,
    });

    if (mediaElement && track) {
      const srcUrl = `http://127.0.0.1:${streamPort}/stream/${encodeURIComponent(track.path)}`;
      mediaElement.src = srcUrl;
      mediaElement.play().catch(err => console.warn("Prev track play failed:", err));
    }
  },

  setStreamPort: (port) => set({ streamPort: port }),
  setPlaylist: (tracks) => set({ playlist: tracks }),
  setDrawerOpen: (open) => set({ isDrawerOpen: open }),
  toggleDrawer: () => set((state) => ({ isDrawerOpen: !state.isDrawerOpen })),
  
  setMediaElement: (element) => {
    const { volume } = get();
    if (element) {
      element.volume = volume / 100;
    }
    set({ mediaElement: element });
  },
}));
