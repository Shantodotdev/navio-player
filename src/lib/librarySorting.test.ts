import { describe, expect, it } from "vitest";
import type { Track } from "../store/playerStore";
import type { MediaActivity } from "./smartPlaylists";
import { sortLibraryTracks } from "./librarySorting";

const tracks: Track[] = [
  {
    id: "episode-10",
    path: "C:\\Media\\episode-10.mp4",
    name: "episode-10.mp4",
    title: "Episode 10",
    duration_secs: 600,
    file_size_bytes: 1_000,
    media_type: "video",
  },
  {
    id: "episode-2",
    path: "C:\\Media\\episode-2.mp4",
    name: "episode-2.mp4",
    title: "Episode 2",
    duration_secs: 1_200,
    file_size_bytes: 2_000,
    media_type: "video",
  },
  {
    id: "unknown",
    path: "C:\\Media\\alpha.mp3",
    name: "Alpha.mp3",
    duration_secs: 180,
    media_type: "audio",
  },
];

const activity: Record<string, MediaActivity> = {
  "episode-10": createActivity("episode-10", 100),
  "episode-2": createActivity("episode-2", 200),
};

describe("sortLibraryTracks", () => {
  it("sorts display names naturally in either direction", () => {
    expect(ids(sortLibraryTracks(tracks, activity, "name-asc"))).toEqual([
      "unknown",
      "episode-2",
      "episode-10",
    ]);
    expect(ids(sortLibraryTracks(tracks, activity, "name-desc"))).toEqual([
      "episode-10",
      "episode-2",
      "unknown",
    ]);
  });

  it("sorts recently added media while keeping missing activity last", () => {
    expect(ids(sortLibraryTracks(tracks, activity, "added-desc"))).toEqual([
      "episode-2",
      "episode-10",
      "unknown",
    ]);
    expect(ids(sortLibraryTracks(tracks, activity, "added-asc"))).toEqual([
      "episode-10",
      "episode-2",
      "unknown",
    ]);
  });

  it("sorts duration and file size without mutating the source list", () => {
    expect(ids(sortLibraryTracks(tracks, activity, "duration-desc"))).toEqual([
      "episode-2",
      "episode-10",
      "unknown",
    ]);
    expect(ids(sortLibraryTracks(tracks, activity, "size-asc"))).toEqual([
      "episode-10",
      "episode-2",
      "unknown",
    ]);
    expect(ids(tracks)).toEqual(["episode-10", "episode-2", "unknown"]);
  });
});

/** Builds the minimum complete activity record needed by sorting tests. */
function createActivity(mediaId: string, addedAt: number): MediaActivity {
  return {
    media_id: mediaId,
    path: mediaId,
    added_at_ms: addedAt,
    last_played_at_ms: null,
    play_count: 0,
    resume_position_secs: 0,
    duration_secs: 0,
    progress_updated_at_ms: null,
    last_seen_at_ms: addedAt,
  };
}

/** Extracts track IDs to keep ordering expectations concise. */
function ids(items: Track[]): string[] {
  return items.map((track) => track.id);
}
