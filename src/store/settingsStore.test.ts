import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./settingsStore";

describe("Navio settings defaults", () => {
  it("starts with the requested player and library preferences", () => {
    expect(DEFAULT_SETTINGS.playback.volume).toBe(80);
    expect(DEFAULT_SETTINGS.playback.playVideoInSidebar).toBe(false);
    expect(DEFAULT_SETTINGS.library.viewMode).toBe("list");
    expect(DEFAULT_SETTINGS.library.showThumbnails).toBe(true);
    expect(DEFAULT_SETTINGS.library.showFileExtensions).toBe(false);
  });
});
