import { useEffect } from "react";
import { useLibraryStore } from "../store/libraryStore";

/**
 * Custom React hook to interact with the local media library database.
 * Encapsulates mounting loader cycles, database writes, and folder scanning actions.
 * Automatically derives library stats and recently added track lists.
 *
 * @returns An object containing live track lists, folders catalog, actions, and calculated stats.
 */
export function useLibrary() {
  const {
    tracks,
    scannedDirs,
    playlists,
    isLoading,
    fetchLibrary,
    addFolder,
    deleteFolder,
    rescanAll,
  } = useLibraryStore();

  // Automatically fetch database catalog on hook initialization (skips if already cached)
  useEffect(() => {
    fetchLibrary();
  }, [fetchLibrary]);

  // Listen to Tauri background watcher events and trigger database force-refresh
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;

    const setupListener = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const unlisten = await listen("library-updated", () => {
          fetchLibrary(true); // Force reload database state!
        });
        unlistenFn = unlisten;
      } catch (err) {
        console.warn("Failed to subscribe to library-updated events:", err);
      }
    };

    setupListener();

    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, [fetchLibrary]);

  // Filter tracks by media type for stats computations
  const audioList = tracks.filter((t) => t.media_type === "audio");
  const videoList = tracks.filter((t) => t.media_type === "video");

  // Derive memoized library metrics
  const stats = {
    audioCount: audioList.length,
    videoCount: videoList.length,
    playlistCount: playlists ? playlists.length : 0,
    scannedFolders: scannedDirs.length,
  };

  // Extract recently added tracks (last 3 items indexed in reverse order)
  const recentTracks = tracks.slice(-3).reverse();

  return {
    tracks,
    scannedDirs,
    playlists,
    isLoading,
    addFolder,
    deleteFolder,
    rescanAll,
    stats,
    recentTracks,
  };
}
