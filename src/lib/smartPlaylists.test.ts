import { describe, expect, it } from "vitest";
import type { Track } from "../store/playerStore";
import {
  deriveSmartPlaylists,
  type MediaActivity,
} from "./smartPlaylists";

function track(id: string, mediaType: Track["media_type"] = "audio"): Track {
  return {
    id,
    path: `C:\\Media\\${id}.${mediaType === "video" ? "mp4" : "mp3"}`,
    name: id,
    duration_secs: mediaType === "video" ? 600 : 180,
    media_type: mediaType,
  };
}

function activity(
  id: string,
  update: Partial<MediaActivity>,
): MediaActivity {
  return {
    media_id: id,
    path: `C:\\Media\\${id}`,
    added_at_ms: null,
    last_played_at_ms: null,
    play_count: 0,
    resume_position_secs: 0,
    duration_secs: 0,
    progress_updated_at_ms: null,
    last_seen_at_ms: 0,
    ...update,
  };
}

describe("deriveSmartPlaylists", () => {
  it("orders recently added and recently played by their activity timestamps", () => {
    const tracks = [track("older"), track("newer")];
    const playlists = deriveSmartPlaylists(tracks, {
      older: activity("older", {
        added_at_ms: 100,
        last_played_at_ms: 400,
      }),
      newer: activity("newer", {
        added_at_ms: 200,
        last_played_at_ms: 300,
      }),
    });

    expect(playlists.find((item) => item.id === "recently-added")?.tracks.map((item) => item.id)).toEqual([
      "newer",
      "older",
    ]);
    expect(playlists.find((item) => item.id === "recently-played")?.tracks.map((item) => item.id)).toEqual([
      "older",
      "newer",
    ]);
  });

  it("keeps only unfinished videos in Continue Watching", () => {
    const tracks = [track("active", "video"), track("complete", "video"), track("audio")];
    const playlists = deriveSmartPlaylists(tracks, {
      active: activity("active", {
        resume_position_secs: 120,
        duration_secs: 600,
        progress_updated_at_ms: 300,
      }),
      complete: activity("complete", {
        resume_position_secs: 590,
        duration_secs: 600,
        progress_updated_at_ms: 400,
      }),
      audio: activity("audio", {
        resume_position_secs: 30,
        duration_secs: 180,
        progress_updated_at_ms: 500,
      }),
    });

    expect(playlists.find((item) => item.id === "continue-watching")?.tracks.map((item) => item.id)).toEqual([
      "active",
    ]);
  });

  it("orders Most Played by count and then latest playback", () => {
    const tracks = [track("low"), track("older"), track("newer")];
    const playlists = deriveSmartPlaylists(tracks, {
      low: activity("low", { play_count: 1, last_played_at_ms: 900 }),
      older: activity("older", { play_count: 4, last_played_at_ms: 100 }),
      newer: activity("newer", { play_count: 4, last_played_at_ms: 200 }),
    });

    expect(playlists.find((item) => item.id === "most-played")?.tracks.map((item) => item.id)).toEqual([
      "newer",
      "older",
      "low",
    ]);
  });

  it("limits every collection to thirty currently available tracks", () => {
    const tracks = Array.from({ length: 35 }, (_, index) => track(String(index)));
    const records = Object.fromEntries(
      tracks.map((item, index) => [
        item.id,
        activity(item.id, {
          added_at_ms: index + 1,
          last_played_at_ms: index + 1,
          play_count: index + 1,
        }),
      ]),
    );

    for (const playlist of deriveSmartPlaylists(tracks, records)) {
      expect(playlist.tracks.length).toBeLessThanOrEqual(30);
    }
  });
});
