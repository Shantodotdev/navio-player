import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOWNLOAD_OPTIONS,
  createStartDownloadPayload,
  getDownloadActions,
  mergeDownloadJob,
  type DownloadJob,
} from "./downloads";

/** Builds a minimal job record for testing the exhaustive action policy. */
function createJob(status: DownloadJob["status"]): DownloadJob {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    url: "https://example.test/video",
    format: "best",
    no_playlist: true,
    ...DEFAULT_DOWNLOAD_OPTIONS,
    status,
    title: "Example video",
    progress: 25,
    speed: "1 MiB/s",
    eta: "00:10",
    size: "10 MiB",
    error: null,
    current_item: null,
    total_items: null,
    completed_paths: [],
    created_at_ms: 1,
    updated_at_ms: 1,
  };
}

describe("getDownloadActions", () => {
  it("keeps retry separate from destructive cancellation", () => {
    expect(getDownloadActions(createJob("downloading"))).toEqual({
      pause: true,
      cancel: true,
      resume: false,
      remove: false,
    });
    expect(getDownloadActions(createJob("failed"))).toEqual({
      pause: false,
      cancel: false,
      resume: true,
      remove: true,
    });
    expect(getDownloadActions(createJob("cancelled"))).toEqual({
      pause: false,
      cancel: false,
      resume: false,
      remove: true,
    });
  });
});

describe("mergeDownloadJob", () => {
  it("keeps concurrent cards in creation order when progress updates arrive", () => {
    const older = {
      ...createJob("downloading"),
      id: "older",
      title: "Older download",
      progress: 10,
      created_at_ms: 1,
      updated_at_ms: 100,
    };
    const newer = {
      ...createJob("downloading"),
      id: "newer",
      title: "Newer download",
      progress: 40,
      created_at_ms: 2,
      updated_at_ms: 200,
    };

    const queue = mergeDownloadJob([newer, older], {
      ...older,
      progress: 11,
      // Event payload ordering metadata must never move an existing card.
      created_at_ms: 999,
      updated_at_ms: 300,
    });

    expect(queue.map((job) => job.id)).toEqual(["newer", "older"]);
    expect(queue.find((job) => job.id === "older")?.progress).toBe(11);
  });
});

describe("createStartDownloadPayload", () => {
  it("maps universal options to Tauri's camelCase arguments", () => {
    expect(
      createStartDownloadPayload({
        id: "00000000-0000-4000-8000-000000000001",
        url: "https://example.test/playlist",
        format: "best",
        no_playlist: false,
        ...DEFAULT_DOWNLOAD_OPTIONS,
      }),
    ).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      url: "https://example.test/playlist",
      format: "best",
      noPlaylist: false,
      quality: "best",
      videoContainer: "auto",
      audioFormat: "original",
      subtitleMode: "none",
      subtitleLanguages: [],
      playlistStart: null,
      playlistEnd: null,
    });
  });

  it("preserves curated advanced options", () => {
    expect(
      createStartDownloadPayload({
        id: "00000000-0000-4000-8000-000000000002",
        url: "https://example.test/collection",
        format: "bestaudio",
        no_playlist: false,
        quality: "1080p",
        video_container: "mkv",
        audio_format: "flac",
        subtitle_mode: "selected",
        subtitle_languages: ["en", "bn"],
        playlist_start: 2,
        playlist_end: 5,
      }),
    ).toMatchObject({
      quality: "1080p",
      videoContainer: "mkv",
      audioFormat: "flac",
      subtitleMode: "selected",
      subtitleLanguages: ["en", "bn"],
      playlistStart: 2,
      playlistEnd: 5,
    });
  });
});
