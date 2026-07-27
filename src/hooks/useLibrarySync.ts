import { useEffect } from "react";
import {
  useLibraryStore,
  type LibraryScanProgress,
} from "../store/libraryStore";
import type { MediaActivity } from "../lib/smartPlaylists";
import { toast } from "../store/toastStore";

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
  const setScanProgress = useLibraryStore((state) => state.setScanProgress);
  const setScanStatuses = useLibraryStore((state) => state.setScanStatuses);

  /** Loads the initial catalog once, while the store avoids redundant reads. */
  useEffect(() => {
    fetchLibrary();
  }, [fetchLibrary]);

  /** Subscribes once to backend changes for the whole lifetime of the app shell. */
  useEffect(() => {
    let isActive = true;
    const unlistenFns: Array<() => void> = [];

    async function setupListener() {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const { invoke } = await import("@tauri-apps/api/core");
        const unlistenLibrary = await listen("library-updated", () => {
          // Ignore the initialization cache: the backend has confirmed a change.
          void fetchLibrary(true);
        });
        const unlistenScan = await listen<LibraryScanProgress>(
          "library-scan-progress",
          (event) => {
            const progress = event.payload;
            setScanProgress(progress);
            if (progress.phase === "failed") {
              toast.error("Library scan failed", {
                description:
                  progress.error ??
                  "Navio could not finish indexing this folder.",
                dedupeKey: `library-scan:${progress.job_id}`,
              });
            }
          },
        );

        if (!isActive) {
          unlistenLibrary();
          unlistenScan();
          return;
        }
        unlistenFns.push(unlistenLibrary, unlistenScan);

        // Registration precedes these reads so a fast startup reconciliation
        // cannot leave the renderer showing an older cached snapshot.
        const progress = await invoke<LibraryScanProgress[]>(
          "get_library_scan_status",
        );
        if (isActive) {
          setScanStatuses(progress);
          await fetchLibrary(true);
        }
      } catch (err) {
        console.warn("Failed to subscribe to library events:", err);
      }
    }

    void setupListener();

    return () => {
      isActive = false;
      unlistenFns.forEach((unlisten) => unlisten());
    };
  }, [fetchLibrary, setScanProgress, setScanStatuses]);

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
