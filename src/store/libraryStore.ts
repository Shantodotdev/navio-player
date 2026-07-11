import { create } from "zustand";
import type { Track } from "./playerStore";

export interface Playlist {
  id: string;
  name: string;
  tracks: Track[];
}

interface LibraryDatabase {
  scanned_directories: string[];
  tracks: Track[];
}

interface PlaylistsDatabase {
  playlists: Playlist[];
}

/**
 * Interface representing the state and actions of our local media library catalog.
 * This state is shared globally across the frontend.
 */
interface LibraryState {
  /** The list of all recursively indexed tracks (audio and video files). */
  tracks: Track[];
  /** The list of absolute paths of directories scanned by the user. */
  scannedDirs: string[];
  /** List of custom user-defined playlists. */
  playlists: Playlist[];
  /** Flag showing if the library has been loaded from disk at least once in this session. */
  isInitialized: boolean;
  /** True when a background I/O database operation (saving or directory scanning) is active. */
  isLoading: boolean;

  /**
   * Loads the current library catalog state (scanned directories, playlists, and tracks)
   * from the database file on disk (`$APPDATA/navio-player/library.json`).
   * Skips loading if the state is already initialized, unless `force` is set to true.
   *
   * @param force Set true to ignore initialization cache and load fresh from disk.
   */
  fetchLibrary: (force?: boolean) => Promise<void>;

  /**
   * Opens the native OS directory picker. If a directory is selected, this triggers
   * the backend lofty scanner, merges the indexed files, saves the database to disk,
   * and updates the local store state.
   */
  addFolder: () => Promise<void>;

  /**
   * Removes a directory from the allowed registry list, purges all indexed tracks
   * belonging to that path from the catalog, writes the changes to disk, and updates state.
   * Keeps playlists intact.
   *
   * @param folder The absolute folder path string to remove.
   */
  deleteFolder: (folder: string) => Promise<void>;

  /**
   * Iterates through all previously scanned directories and invokes the backend lofty scanner
   * sequentially to synchronize the catalog with any file additions/deletions on the host disk.
   */
  rescanAll: () => Promise<void>;

  createPlaylist: (name: string) => Promise<void>;
  renamePlaylist: (playlistId: string, name: string) => Promise<void>;
  deletePlaylist: (playlistId: string) => Promise<void>;
  addTrackToPlaylist: (playlistId: string, track: Track) => Promise<void>;
  removeTrackFromPlaylist: (
    playlistId: string,
    trackId: string,
  ) => Promise<void>;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  tracks: [],
  scannedDirs: [],
  playlists: [],
  isInitialized: false,
  isLoading: false,

  fetchLibrary: async (force = false) => {
    // Prevent redundant load calls unless force parameter is set to true
    if (get().isInitialized && !force) return;
    set({ isLoading: true });
    try {
      const { invoke } = await import("@tauri-apps/api/core");

      // Load the library and independent playlist catalog from AppData.
      const db = await invoke<LibraryDatabase>("get_library");
      const playlistsDb = await invoke<PlaylistsDatabase>("get_playlists");
      set({
        tracks: db.tracks || [],
        scannedDirs: db.scanned_directories || [],
        playlists: playlistsDb.playlists || [],
        isInitialized: true,
      });
    } catch (err) {
      console.warn("Failed to load library database from disk:", err);
    } finally {
      set({ isLoading: false });
    }
  },

  addFolder: async () => {
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
          set({ isLoading: true });

          // Invoke the heavy I/O lofty recursive scanner in Rust
          const db = await invoke<LibraryDatabase>("scan_folder", {
            folderPath,
          });

          // Update the global memory cache
          set({
            tracks: db.tracks || [],
            scannedDirs: db.scanned_directories || [],
            isInitialized: true,
          });
        }
      }
    } catch (err) {
      console.error("Error adding folder to library catalog:", err);
    } finally {
      set({ isLoading: false });
    }
  },

  deleteFolder: async (folder) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");

      // Fetch full database from disk to retrieve playlists (prevents losing playlist relations)
      const db = await invoke<LibraryDatabase>("get_library");

      const { scannedDirs, tracks } = get();

      // Filter out the selected folder and all tracks residing within its path
      const updatedDirs = scannedDirs.filter((d) => d !== folder);
      const updatedTracks = tracks.filter((t) => !t.path.startsWith(folder));

      db.scanned_directories = updatedDirs;
      db.tracks = updatedTracks;

      // Persist the changes to disk
      await invoke("save_library", { db });

      // Update memory store state
      set({
        scannedDirs: updatedDirs,
        tracks: updatedTracks,
      });
    } catch (err) {
      console.error("Error deleting folder from library catalog:", err);
    }
  },

  rescanAll: async () => {
    const { scannedDirs } = get();
    if (scannedDirs.length === 0) return;

    set({ isLoading: true });
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      let latestDb = null;

      // Rescan folders sequentially to keep IO and RAM usage flat
      for (const dir of scannedDirs) {
        latestDb = await invoke<LibraryDatabase>("scan_folder", {
          folderPath: dir,
        });
      }

      // Sync the latest scanned results
      if (latestDb) {
        set({
          tracks: latestDb.tracks || [],
          scannedDirs: latestDb.scanned_directories || [],
        });
      }
    } catch (err) {
      console.error("Error rescanning library directories:", err);
    } finally {
      set({ isLoading: false });
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
}));

async function savePlaylists(playlists: Playlist[]): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("save_playlists", { db: { playlists } });
}

function createPlaylistId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `playlist-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
