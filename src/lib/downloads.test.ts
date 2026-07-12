import { describe, expect, it } from "vitest";
import { getDownloadActions, type DownloadJob } from "./downloads";

/** Builds a minimal job record for testing the exhaustive action policy. */
function createJob(status: DownloadJob["status"]): DownloadJob {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    url: "https://example.test/video",
    format: "best",
    no_playlist: true,
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
