import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLibraryStore } from "./libraryStore";
import type { MediaActivity } from "../lib/smartPlaylists";
import type { Track } from "./playerStore";

const { invokeMock, openMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  openMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openMock }));

const updated: MediaActivity = {
  media_id: "media-1",
  path: "C:\\Media\\movie.mp4",
  added_at_ms: null,
  last_played_at_ms: 100,
  play_count: 1,
  resume_position_secs: 30,
  duration_secs: 600,
  progress_updated_at_ms: 100,
  last_seen_at_ms: 100,
};

const playlistTracks: Track[] = [
  createTrack("one"),
  createTrack("two"),
  createTrack("three"),
];

describe("library activity state", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    openMock.mockReset();
    useLibraryStore.setState({
      activity: {},
      tracks: [],
      scannedDirs: [],
      playlists: [],
      isInitialized: false,
      isLoading: false,
      activeScan: null,
      removingFolders: [],
    });
  });

  it("rejects a failed user-triggered folder scan and restores loading state", async () => {
    openMock.mockResolvedValue("C:\\Media");
    invokeMock.mockRejectedValue(new Error("Folder cannot be read."));

    await expect(useLibraryStore.getState().addFolder()).rejects.toThrow(
      "Folder cannot be read.",
    );
    expect(useLibraryStore.getState().isLoading).toBe(false);
  });

  it("returns null when folder selection is cancelled", async () => {
    openMock.mockResolvedValue(null);

    await expect(useLibraryStore.getState().addFolder()).resolves.toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("reports the selected folder while its scan is running", async () => {
    const scan = createDeferred<{
      scanned_directories: string[];
      tracks: Track[];
      activity: Record<string, MediaActivity>;
    }>();
    openMock.mockResolvedValue("C:\\Media");
    invokeMock.mockReturnValue(scan.promise);

    const result = useLibraryStore.getState().addFolder();
    await vi.waitFor(() => {
      expect(useLibraryStore.getState().activeScan).toEqual({
        folder: "C:\\Media",
      });
    });

    scan.resolve({
      scanned_directories: ["C:\\Media"],
      tracks: [],
      activity: {},
    });
    await result;
    expect(useLibraryStore.getState().activeScan).toBeNull();
  });

  it("rejects a failed folder removal without changing the catalog", async () => {
    useLibraryStore.setState({ scannedDirs: ["C:\\Media"] });
    invokeMock.mockRejectedValue(new Error("Could not save library."));

    await expect(
      useLibraryStore.getState().deleteFolder("C:\\Media"),
    ).rejects.toThrow("Could not save library.");
    expect(useLibraryStore.getState().scannedDirs).toEqual(["C:\\Media"]);
  });

  it("reports a folder as pending until its removal finishes", async () => {
    const removal = createDeferred<void>();
    useLibraryStore.setState({ scannedDirs: ["C:\\Media"] });
    invokeMock.mockReturnValue(removal.promise);

    const result = useLibraryStore.getState().deleteFolder("C:\\Media");
    await vi.waitFor(() => {
      expect(useLibraryStore.getState().removingFolders).toEqual([
        "C:\\Media",
      ]);
    });

    removal.resolve();
    await result;
    expect(useLibraryStore.getState().removingFolders).toEqual([]);
  });

  it("merges a returned activity entry without replacing other records", () => {
    useLibraryStore.setState({
      activity: {
        existing: { ...updated, media_id: "existing" },
      },
    });

    useLibraryStore.getState().updateActivity(updated);

    expect(Object.keys(useLibraryStore.getState().activity).sort()).toEqual([
      "existing",
      "media-1",
    ]);
    expect(useLibraryStore.getState().activity["media-1"]).toEqual(updated);
  });

  it("does not let an older asynchronous response roll activity backward", () => {
    useLibraryStore.setState({
      activity: {
        "media-1": {
          ...updated,
          last_played_at_ms: 500,
          play_count: 3,
          resume_position_secs: 120,
          progress_updated_at_ms: 500,
        },
      },
    });

    useLibraryStore.getState().updateActivity({
      ...updated,
      last_played_at_ms: 100,
      play_count: 1,
      resume_position_secs: 30,
      progress_updated_at_ms: 100,
    });

    const activity = useLibraryStore.getState().activity["media-1"];
    expect(activity?.last_played_at_ms).toBe(500);
    expect(activity?.play_count).toBe(3);
    expect(activity?.resume_position_secs).toBe(120);
  });

  it("persists reordered tracks before updating a playlist", async () => {
    invokeMock.mockResolvedValue(undefined);
    useLibraryStore.setState({
      playlists: [{ id: "favorites", name: "Favorites", tracks: playlistTracks }],
    });

    await useLibraryStore
      .getState()
      .reorderPlaylistTracks("favorites", 2, 0);

    expect(
      useLibraryStore.getState().playlists[0]?.tracks.map((track) => track.id),
    ).toEqual(["three", "one", "two"]);
    expect(invokeMock).toHaveBeenCalledWith("save_playlists", {
      db: {
        playlists: [
          {
            id: "favorites",
            name: "Favorites",
            tracks: [playlistTracks[2], playlistTracks[0], playlistTracks[1]],
          },
        ],
      },
    });
  });

  it("keeps the prior playlist order when reordering cannot be saved", async () => {
    invokeMock.mockRejectedValue(new Error("Could not save playlists."));
    useLibraryStore.setState({
      playlists: [{ id: "favorites", name: "Favorites", tracks: playlistTracks }],
    });

    await expect(
      useLibraryStore.getState().reorderPlaylistTracks("favorites", 0, 2),
    ).rejects.toThrow("Could not save playlists.");
    expect(
      useLibraryStore.getState().playlists[0]?.tracks.map((track) => track.id),
    ).toEqual(["one", "two", "three"]);
  });
});

/** Creates a compact audio fixture for playlist ordering tests. */
function createTrack(id: string): Track {
  return {
    id,
    path: `C:\\Media\\${id}.mp3`,
    name: `${id}.mp3`,
    duration_secs: 120,
    media_type: "audio",
  };
}

/** Creates a controllable promise for observing state during asynchronous work. */
function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
