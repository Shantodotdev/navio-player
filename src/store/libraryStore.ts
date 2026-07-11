import { create } from "zustand";
import type { Track } from "./playerStore";

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
}

interface PlaylistsDatabase {
  playlists: Playlist[];
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
  /** Flag showing if the library has been loaded from disk at least once in this session. */
  isInitialized: boolean;
  /** True when a background I/O database operation (saving or directory scanning) is active. */
  isLoading: boolean;

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
  addFolder: () => Promise<void>;

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

      // Load the live library view and independent playlist catalog from AppData.
      const db = await invoke<LibraryView>("get_library");
      set({
        tracks: db.tracks || [],
        scannedDirs: db.scanned_directories || [],
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
          const db = await invoke<LibraryView>("scan_folder", {
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

      const { scannedDirs } = get();

      // Filter out the selected folder and all tracks residing within its path
      const updatedDirs = scannedDirs.filter((d) => d !== folder);
      const db: LibraryDatabase = { scanned_directories: updatedDirs };

      // Persist the changes to disk
      await invoke("save_library", { db });

      // Update memory store state
      set({
        scannedDirs: updatedDirs,
        tracks: get().tracks.filter((track) => !isPathWithinDirectory(track.path, folder)),
      });
    } catch (err) {
      console.error("Error deleting folder from library catalog:", err);
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

/** Checks folder membership without treating similarly named sibling folders as children. */
function isPathWithinDirectory(filePath: string, directoryPath: string): boolean {
  const normalizedFile = filePath.replace(/[\\/]+$/, "").toLowerCase();
  const normalizedDirectory = directoryPath.replace(/[\\/]+$/, "").toLowerCase();

  return (
    normalizedFile === normalizedDirectory ||
    normalizedFile.startsWith(`${normalizedDirectory}\\`) ||
    normalizedFile.startsWith(`${normalizedDirectory}/`)
  );
}
