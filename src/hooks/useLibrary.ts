import { useLibraryStore } from "../store/libraryStore";
import { deriveSmartPlaylists } from "../lib/smartPlaylists";

/**
 * Custom React hook to interact with the local media library database.
 * Encapsulates library writes, folder scanning actions, and derived lists.
 * Backend synchronization is owned once by `useLibrarySync` in the app shell.
 *
 * @returns An object containing live track lists, folders catalog, actions, and calculated stats.
 */
export function useLibrary() {
  const {
    tracks,
    scannedDirs,
    playlists,
    activity,
    isLoading,
    addFolder,
    deleteFolder,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    addTrackToPlaylist,
    removeTrackFromPlaylist,
  } = useLibraryStore();

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
  const smartPlaylists = deriveSmartPlaylists(tracks, activity);

  return {
    tracks,
    scannedDirs,
    playlists,
    activity,
    smartPlaylists,
    isLoading,
    addFolder,
    deleteFolder,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    addTrackToPlaylist,
    removeTrackFromPlaylist,
    stats,
    recentTracks,
  };
}
