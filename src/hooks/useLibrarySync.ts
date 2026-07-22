import { useEffect } from "react";
import { useLibraryStore } from "../store/libraryStore";
import type { MediaActivity } from "../lib/smartPlaylists";

/**
 * Keeps the in-memory library catalog synchronized with Navio's Rust backend.
 *
 * This hook is mounted once by the application shell instead of by individual
 * pages. As a result, downloads and filesystem changes received while the
 * Downloader page is open still refresh the shared library before the user
 * returns to the Library page.
 */
export function useLibrarySync() {
  const fetchLibrary = useLibraryStore((state) => state.fetchLibrary);
  const updateActivity = useLibraryStore((state) => state.updateActivity);

  /** Loads the initial catalog once, while the store avoids redundant reads. */
  useEffect(() => {
    fetchLibrary();
  }, [fetchLibrary]);

  /** Subscribes once to backend changes for the whole lifetime of the app shell. */
  useEffect(() => {
    let isActive = true;
    let unlistenFn: (() => void) | null = null;

    async function setupListener() {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const unlisten = await listen("library-updated", () => {
          // Ignore the initialization cache: the backend has confirmed a change.
          void fetchLibrary(true);
        });

        if (isActive) {
          unlistenFn = unlisten;
        } else {
          // React may unmount before Tauri finishes creating the subscription.
          unlisten();
        }
      } catch (err) {
        console.warn("Failed to subscribe to library-updated events:", err);
      }
    }

    void setupListener();

    return () => {
      isActive = false;
      unlistenFn?.();
    };
  }, [fetchLibrary]);

  /** Merges lightweight playback checkpoints without rebuilding the library. */
  useEffect(() => {
    let isActive = true;
    let unlistenFn: (() => void) | null = null;

    async function setupActivityListener() {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const unlisten = await listen<MediaActivity>(
          "activity-updated",
          (event) => updateActivity(event.payload),
        );
        if (isActive) unlistenFn = unlisten;
        else unlisten();
      } catch (error) {
        console.warn("Failed to subscribe to activity updates:", error);
      }
    }

    void setupActivityListener();
    return () => {
      isActive = false;
      unlistenFn?.();
    };
  }, [updateActivity]);
}
