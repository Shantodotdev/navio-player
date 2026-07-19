import { beforeEach, describe, expect, it } from "vitest";
import {
  dispatchMcpCommand,
  handleDownloadAutoplay,
  NO_MUSIC_FOUND,
  resolveLocalTrack,
  searchLocalTracks,
} from "./mcpControl";
import { usePlayerStore, type Track } from "../store/playerStore";
import { useLibraryStore } from "../store/libraryStore";
import type { DownloadJob } from "./downloads";

const audioOne: Track = {
  id: "audio-one",
  path: "C:\\Music\\Midnight Drive.mp3",
  name: "Midnight Drive.mp3",
  title: "Midnight Drive",
  duration_secs: 180,
  media_type: "audio",
};

const audioTwo: Track = {
  id: "audio-two",
  path: "C:\\Music\\Drive Home.flac",
  name: "Drive Home.flac",
  duration_secs: 220,
  media_type: "audio",
};

const video: Track = {
  id: "video-one",
  path: "C:\\Videos\\Midnight Drive.mp4",
  name: "Midnight Drive.mp4",
  title: "Midnight Drive Live",
  duration_secs: 300,
  media_type: "video",
};

/**
 * Creates the narrow HTML media surface required by player-store unit tests.
 * The fixture implements only the playback members exercised in Node, avoiding a
 * browser dependency while preserving observable seek, pause, and source changes.
 */
function createMediaElement(currentTime: number): HTMLVideoElement {
  return {
    currentTime,
    duration: 180,
    pause: () => undefined,
    play: () => Promise.resolve(),
    src: "",
    volume: 0.8,
  } as unknown as HTMLVideoElement;
}

describe("local MCP library lookup", () => {
  it("ranks an exact title ahead of partial matches without case sensitivity", () => {
    expect(
      searchLocalTracks([video, audioTwo, audioOne], "midnight drive").map(
        (track) => track.id,
      ),
    ).toEqual(["audio-one", "video-one"]);
  });

  it("filters media type and caps the number of returned tracks", () => {
    expect(
      searchLocalTracks(
        [audioOne, audioTwo, video],
        "drive",
        "audio",
        1,
      ),
    ).toEqual([audioTwo]);
  });

  it("resolves stable IDs or exact local names and never invents an online result", () => {
    expect(resolveLocalTrack([audioOne], { trackId: "audio-one" })).toBe(
      audioOne,
    );
    expect(
      resolveLocalTrack([audioOne], { name: "MIDNIGHT DRIVE.MP3" }),
    ).toBe(audioOne);
    expect(resolveLocalTrack([audioOne], { name: "unknown song" })).toBeNull();
    expect(NO_MUSIC_FOUND).toBe("No music found.");
  });
});

describe("MCP player actions", () => {
  beforeEach(() => {
    usePlayerStore.setState({
      currentTrack: null,
      playlist: [],
      playIndex: -1,
      isPlaying: false,
      currentTime: 0,
      mediaElement: null,
    });
  });

  it("stops playback and resets both renderer and store position", () => {
    const media = createMediaElement(42);
    usePlayerStore.setState({
      currentTrack: audioOne,
      playlist: [audioOne],
      playIndex: 0,
      isPlaying: true,
      currentTime: 42,
      mediaElement: media,
    });

    usePlayerStore.getState().stopPlayback();

    expect(media.currentTime).toBe(0);
    expect(usePlayerStore.getState()).toMatchObject({
      isPlaying: false,
      currentTime: 0,
    });
  });

  it("seeks absolutely and relatively while rejecting non-finite input", () => {
    const media = createMediaElement(10);
    usePlayerStore.setState({
      currentTrack: audioOne,
      currentTime: 10,
      mediaElement: media,
    });

    expect(usePlayerStore.getState().seekTo(25)).toBe(true);
    expect(media.currentTime).toBe(25);
    expect(usePlayerStore.getState().seekBy(-5)).toBe(true);
    expect(media.currentTime).toBe(20);
    expect(usePlayerStore.getState().seekTo(Number.NaN)).toBe(false);
  });

  it("keeps the active track stable when removing an earlier queue item", () => {
    usePlayerStore.setState({
      currentTrack: audioTwo,
      playlist: [audioOne, audioTwo, video],
      playIndex: 1,
    });

    expect(usePlayerStore.getState().removeQueueIndex(0)).toBe(true);
    expect(usePlayerStore.getState()).toMatchObject({
      currentTrack: audioTwo,
      playlist: [audioTwo, video],
      playIndex: 0,
    });
  });

  it("keeps the current track as the only item when clearing upcoming media", () => {
    usePlayerStore.setState({
      currentTrack: audioTwo,
      playlist: [audioOne, audioTwo, video],
      playIndex: 1,
    });

    usePlayerStore.getState().clearQueue();

    expect(usePlayerStore.getState()).toMatchObject({
      currentTrack: audioTwo,
      playlist: [audioTwo],
      playIndex: 0,
    });
  });
});

describe("MCP command dispatcher", () => {
  beforeEach(() => {
    usePlayerStore.setState({
      currentTrack: null,
      playlist: [],
      playIndex: -1,
      isPlaying: false,
      currentTime: 0,
      volume: 80,
      isDrawerOpen: false,
      isTheaterOpen: false,
      mediaElement: null,
    });
    useLibraryStore.setState({
      tracks: [audioOne, audioTwo, video],
      isInitialized: true,
      isLoading: false,
    });
  });

  it("searches and plays only local tracks through shared stores", async () => {
    const dependencies = createDispatcherDependencies();
    const search = await dispatchMcpCommand(
      { type: "search_library", query: "midnight", media_type: "audio" },
      dependencies,
    );
    expect(search.success).toBe(true);
    expect(search.data).toMatchObject({
      tracks: [{ id: "audio-one", media_type: "audio" }],
    });

    const played = await dispatchMcpCommand(
      { type: "play_media", track_id: "audio-one" },
      dependencies,
    );
    expect(played.success).toBe(true);
    expect(usePlayerStore.getState().currentTrack).toBe(audioOne);

    const missing = await dispatchMcpCommand(
      { type: "play_media", name: "not in this library" },
      dependencies,
    );
    expect(missing).toEqual({ success: false, message: NO_MUSIC_FOUND });
  });

  it("inspects an explicit URL before starting a durable autoplay job", async () => {
    const calls: string[] = [];
    const pending = new Set<string>();
    const dependencies = createDispatcherDependencies({
      createId: () => "download-id",
      inspectDownloadUrl: async (url) => {
        calls.push(`inspect:${url}`);
        return { is_collection: false };
      },
      startDownload: async (job) => {
        calls.push(`start:${job.id}:${job.format}`);
      },
      registerAutoplay: (id) => {
        pending.add(id);
      },
    });

    const result = await dispatchMcpCommand(
      {
        type: "download_and_play_url",
        url: "https://example.test/song",
        media_type: "audio",
      },
      dependencies,
    );

    expect(calls).toEqual([
      "inspect:https://example.test/song",
      "start:download-id:bestaudio",
    ]);
    expect(pending.has("download-id")).toBe(true);
    expect(result.data).toEqual({ job_id: "download-id", status: "queued" });
  });

  it("reports download progress without exposing completed filesystem paths", async () => {
    const completed = createDownloadJob("completed", [
      "C:\\Users\\private\\Downloads\\song.mp3",
    ]);
    const result = await dispatchMcpCommand(
      { type: "get_downloads" },
      createDispatcherDependencies({ loadDownloads: async () => [completed] }),
    );

    expect(result.data).toMatchObject({
      downloads: [
        {
          id: "download-id",
          status: "completed",
          completed_file_count: 1,
        },
      ],
    });
    expect(JSON.stringify(result.data)).not.toContain("C:\\Users\\private");
    expect(JSON.stringify(result.data)).not.toContain("completed_paths");
  });
});

describe("completed MCP download autoplay", () => {
  it("plays the first validated completed path exactly once", async () => {
    const pending = new Set(["download-id"]);
    const played: Track[] = [];
    const completed = createDownloadJob("completed", ["C:\\Downloads\\song.mp3"]);

    expect(
      await handleDownloadAutoplay(
        completed,
        pending,
        async () => audioOne,
        (track) => played.push(track),
      ),
    ).toBe(true);
    expect(played).toEqual([audioOne]);
    expect(pending.has("download-id")).toBe(false);
    expect(
      await handleDownloadAutoplay(
        completed,
        pending,
        async () => audioOne,
        (track) => played.push(track),
      ),
    ).toBe(false);
    expect(played).toEqual([audioOne]);
  });
});

type DispatcherDependencies = Parameters<typeof dispatchMcpCommand>[1];

/**
 * Creates dispatcher dependencies backed by real Zustand stores while keeping
 * network and process operations inert. Individual tests override only the
 * boundary whose calls or return values they need to observe.
 */
function createDispatcherDependencies(
  overrides: Partial<DispatcherDependencies> = {},
): DispatcherDependencies {
  return {
    getPlayerState: usePlayerStore.getState,
    getLibraryState: useLibraryStore.getState,
    inspectDownloadUrl: async () => ({ is_collection: false }),
    startDownload: async () => undefined,
    loadDownloads: async () => [],
    createId: () => "generated-id",
    registerAutoplay: () => undefined,
    ...overrides,
  };
}

/**
 * Builds a complete durable download record for dispatcher and autoplay tests.
 * Status and completed paths remain parameters so tests can model terminal and
 * non-terminal downloader events without duplicating the persistence contract.
 */
function createDownloadJob(
  status: DownloadJob["status"],
  completedPaths: string[],
): DownloadJob {
  return {
    id: "download-id",
    url: "https://example.test/song",
    format: "bestaudio",
    no_playlist: true,
    quality: "best",
    video_container: "auto",
    audio_format: "original",
    subtitle_mode: "none",
    subtitle_languages: [],
    playlist_start: null,
    playlist_end: null,
    status,
    title: "Song",
    progress: status === "completed" ? 100 : 0,
    speed: "Finished",
    eta: "00:00",
    size: "1 MiB",
    error: null,
    current_item: null,
    total_items: null,
    completed_paths: completedPaths,
    created_at_ms: 1,
    updated_at_ms: 2,
  };
}
