import { beforeEach, describe, expect, it } from "vitest";
import { useLibraryStore } from "./libraryStore";
import type { MediaActivity } from "../lib/smartPlaylists";

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

describe("library activity state", () => {
  beforeEach(() => {
    useLibraryStore.setState({ activity: {} });
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
});
