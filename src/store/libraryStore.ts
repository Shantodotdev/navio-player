import { create } from "zustand";
import type { Track } from "./playerStore";
import type { MediaActivity } from "../lib/smartPlaylists";

export interface Playlist {
  id: string;
  name: string;
  tracks: Track[];
}

interface LibraryDatabase {
  scanned_directories: string[];
}

interface LibraryView {
  scanned_directories: string[];
  tracks: Track[];
  activity: Record<string, MediaActivity>;
}

interface PlaylistsDatabase {
  playlists: Playlist[];
}

export interface LibraryScanOperation {
  /** Null while the native folder picker is open, then the selected path. */
  folder: string | null;
}

/**
 * Interface representing the state and actions of our local media library catalog.
 * This state is shared globally across the frontend.
 */
interface LibraryState {
  /** The current media files derived from the configured folders. */
  tracks: Track[];
  /** The list of absolute paths of directories scanned by the user. */
  scannedDirs: string[];
  /** List of custom user-defined playlists. */
  playlists: Playlist[];
  /** Durable activity records keyed by the stable media ID. */
  activity: Record<string, MediaActivity>;
  /** Flag showing if the library has been loaded from disk at least once in this session. */
  isInitialized: boolean;
  /** True when a background I/O database operation (saving or directory scanning) is active. */
  isLoading: boolean;
  /** The user-triggered folder selection or scan currently in progress. */
  activeScan: LibraryScanOperation | null;
  /** Folder paths whose removal is awaiting durable persistence. */
  removingFolders: string[];

  /**
   * Loads configured folders from disk and derives current tracks from the filesystem.
   * Skips loading if the state is already initialized, unless `force` is set to true.
   *
   * @param force Set true to ignore initialization cache and load fresh from disk.
   */
  fetchLibrary: (force?: boolean) => Promise<void>;

  /**
   * Opens the native OS directory picker. If a directory is selected, this triggers
   * the backend scanner, saves only the folder configuration, and updates the live view.
   */
  addFolder: () => Promise<string | null>;

  /**
   * Removes a directory from the configured folder list, writes the change to disk,
   * and removes its current files from the live view.
   * Keeps playlists intact.
   *
   * @param folder The absolute folder path string to remove.
   */
  deleteFolder: (folder: string) => Promise<void>;

  createPlaylist: (name: string) => Promise<void>;
  renamePlaylist: (playlistId: string, name: string) => Promise<void>;
  deletePlaylist: (playlistId: string) => Promise<void>;
  addTrackToPlaylist: (playlistId: string, track: Track) => Promise<void>;
  removeTrackFromPlaylist: (
    playlistId: string,
    trackId: string,
  ) => Promise<void>;
  /** Persists a track's new position within one user-created playlist. */
  reorderPlaylistTracks: (
    playlistId: string,
    fromIndex: number,
    toIndex: number,
  ) => Promise<void>;
  /** Merges one backend activity update without forcing a filesystem scan. */
  updateActivity: (entry: MediaActivity) => void;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  tracks: [],
  scannedDirs: [],
  playlists: [],
  activity: {},
  isInitialized: false,
  isLoading: false,
  activeScan: null,
  removingFolders: [],

  fetchLibrary: async (force = false) => {
    // Prevent redundant load calls unless force parameter is set to true
    if (get().isInitialized && !force) return;
    set({ isLoading: true });
    try {
      const { invoke } = await import("@tauri-apps/api/core");

      // Load the live library view and independent playlist catalog from AppData.
      const db = await invoke<LibraryView>("get_library");
      set({
        tracks: db.tracks || [],
        scannedDirs: db.scanned_directories || [],
        activity: db.activity || {},
        isInitialized: true,
      });

      try {
        const playlistsDb = await invoke<PlaylistsDatabase>("get_playlists");
        set({ playlists: playlistsDb.playlists || [] });
      } catch (err) {
        console.warn("Failed to load playlists database from disk:", err);
      }
    } catch (err) {
      console.warn("Failed to load library database from disk:", err);
    } finally {
      set({ isLoading: false });
    }
  },

  addFolder: async () => {
    if (get().activeScan) return null;
    set({ activeScan: { folder: null } });
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { invoke } = await import("@tauri-apps/api/core");

      // Open the system native directory dialog selector
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select media folder to scan",
      });

      if (selected) {
        // Resolve target folder path (supports array fallbacks if dialog returns lists)
        const folderPath = Array.isArray(selected) ? selected[0] : selected;
        if (folderPath) {
          set({ isLoading: true, activeScan: { folder: folderPath } });

          // Invoke the heavy I/O lofty recursive scanner in Rust
          const db = await invoke<LibraryView>("scan_folder", {
            folderPath,
          });

          // Update the global memory cache
          set({
            tracks: db.tracks || [],
            scannedDirs: db.scanned_directories || [],
            activity: db.activity || {},
            isInitialized: true,
          });
          return folderPath;
        }
      }
      return null;
    } finally {
      set({ isLoading: false, activeScan: null });
    }
  },

  deleteFolder: async (folder) => {
    if (get().removingFolders.includes(folder)) return;
    set((state) => ({
      removingFolders: [...state.removingFolders, folder],
    }));

    try {
      const { invoke } = await import("@tauri-apps/api/core");

      const { scannedDirs } = get();

      // Filter out the selected folder and all tracks residing within its path
      const updatedDirs = scannedDirs.filter((d) => d !== folder);
      const db: LibraryDatabase = { scanned_directories: updatedDirs };

      // Persist the changes to disk
      await invoke("save_library", { db });

      // Update memory store state
      set({
        scannedDirs: updatedDirs,
        tracks: get().tracks.filter(
          (track) => !isPathWithinDirectory(track.path, folder),
        ),
      });
    } finally {
      set((state) => ({
        removingFolders: state.removingFolders.filter(
          (pendingFolder) => pendingFolder !== folder,
        ),
      }));
    }
  },

  createPlaylist: async (name) => {
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error("Playlist name cannot be empty.");
    if (
      get().playlists.some(
        (playlist) => playlist.name.toLowerCase() === trimmedName.toLowerCase(),
      )
    ) {
      throw new Error("A playlist with this name already exists.");
    }

    const playlist: Playlist = {
      id: createPlaylistId(),
      name: trimmedName,
      tracks: [],
    };
    await savePlaylists([...get().playlists, playlist]);
    set((state) => ({ playlists: [...state.playlists, playlist] }));
  },

  renamePlaylist: async (playlistId, name) => {
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error("Playlist name cannot be empty.");
    if (
      get().playlists.some(
        (playlist) =>
          playlist.id !== playlistId &&
          playlist.name.toLowerCase() === trimmedName.toLowerCase(),
      )
    ) {
      throw new Error("A playlist with this name already exists.");
    }

    const updated = get().playlists.map((playlist) =>
      playlist.id === playlistId
        ? { ...playlist, name: trimmedName }
        : playlist,
    );
    await savePlaylists(updated);
    set({ playlists: updated });
  },

  deletePlaylist: async (playlistId) => {
    const updated = get().playlists.filter(
      (playlist) => playlist.id !== playlistId,
    );
    await savePlaylists(updated);
    set({ playlists: updated });
  },

  addTrackToPlaylist: async (playlistId, track) => {
    const updated = get().playlists.map((playlist) => {
      if (
        playlist.id !== playlistId ||
        playlist.tracks.some((item) => item.id === track.id)
      ) {
        return playlist;
      }
      return { ...playlist, tracks: [...playlist.tracks, { ...track }] };
    });
    await savePlaylists(updated);
    set({ playlists: updated });
  },

  removeTrackFromPlaylist: async (playlistId, trackId) => {
    const updated = get().playlists.map((playlist) =>
      playlist.id === playlistId
        ? {
            ...playlist,
            tracks: playlist.tracks.filter((track) => track.id !== trackId),
          }
        : playlist,
    );
    await savePlaylists(updated);
    set({ playlists: updated });
  },

  reorderPlaylistTracks: async (playlistId, fromIndex, toIndex) => {
    const playlists = get().playlists;
    const playlist = playlists.find((item) => item.id === playlistId);
    if (
      !playlist ||
      !Number.isInteger(fromIndex) ||
      !Number.isInteger(toIndex) ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= playlist.tracks.length ||
      toIndex >= playlist.tracks.length ||
      fromIndex === toIndex
    ) {
      return;
    }

    const tracks = [...playlist.tracks];
    const [movedTrack] = tracks.splice(fromIndex, 1);
    if (!movedTrack) return;
    tracks.splice(toIndex, 0, movedTrack);

    const updated = playlists.map((item) =>
      item.id === playlistId ? { ...item, tracks } : item,
    );
    // Keep the visible order unchanged if durable persistence fails.
    await savePlaylists(updated);
    set({ playlists: updated });
  },

  updateActivity: (entry) => {
    set((state) => {
      const existing = state.activity[entry.media_id];
      return {
        activity: {
          ...state.activity,
          [entry.media_id]: existing
            ? mergeActivityEntry(existing, entry)
            : entry,
        },
      };
    });
  },
}));

/** Preserves monotonic activity when concurrent Tauri responses arrive out of order. */
function mergeActivityEntry(
  existing: MediaActivity,
  incoming: MediaActivity,
): MediaActivity {
  const existingProgress = existing.progress_updated_at_ms ?? -1;
  const incomingProgress = incoming.progress_updated_at_ms ?? -1;
  const latestProgress =
    incomingProgress >= existingProgress ? incoming : existing;
  const addedAt =
    existing.added_at_ms === null
      ? incoming.added_at_ms
      : incoming.added_at_ms === null
        ? existing.added_at_ms
        : Math.min(existing.added_at_ms, incoming.added_at_ms);

  return {
    ...incoming,
    added_at_ms: addedAt,
    last_played_at_ms:
      Math.max(
        existing.last_played_at_ms ?? -1,
        incoming.last_played_at_ms ?? -1,
      ) >= 0
        ? Math.max(
            existing.last_played_at_ms ?? -1,
            incoming.last_played_at_ms ?? -1,
          )
        : null,
    play_count: Math.max(existing.play_count, incoming.play_count),
    resume_position_secs: latestProgress.resume_position_secs,
    duration_secs: latestProgress.duration_secs,
    progress_updated_at_ms: latestProgress.progress_updated_at_ms,
    last_seen_at_ms: Math.max(
      existing.last_seen_at_ms,
      incoming.last_seen_at_ms,
    ),
  };
}

async function savePlaylists(playlists: Playlist[]): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("save_playlists", { db: { playlists } });
}

function createPlaylistId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `playlist-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Checks folder membership without treating similarly named sibling folders as children. */
function isPathWithinDirectory(
  filePath: string,
  directoryPath: string,
): boolean {
  const normalizedFile = filePath.replace(/[\\/]+$/, "").toLowerCase();
  const normalizedDirectory = directoryPath
    .replace(/[\\/]+$/, "")
    .toLowerCase();

  return (
    normalizedFile === normalizedDirectory ||
    normalizedFile.startsWith(`${normalizedDirectory}\\`) ||
    normalizedFile.startsWith(`${normalizedDirectory}/`)
  );
}
