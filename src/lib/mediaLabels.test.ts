import { describe, expect, it } from "vitest";
import { getMediaDisplayName } from "./mediaLabels";

describe("getMediaDisplayName", () => {
  it("hides a media extension even when no metadata title is available", () => {
    expect(
      getMediaDisplayName("Hailee Steinfeld - Love Myself.mp4", false),
    ).toBe("Hailee Steinfeld - Love Myself");
  });

  it("preserves extensions when the setting is enabled", () => {
    expect(getMediaDisplayName("Song.mp3", true)).toBe("Song.mp3");
  });
});
