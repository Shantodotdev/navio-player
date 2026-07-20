// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  getPersistentVideoSurface,
  movePersistentVideoSurface,
} from "./persistentVideoSurface";

describe("persistent video surface", () => {
  it("moves between drawer and watch hosts without replacing the media node", () => {
    const surface = getPersistentVideoSurface();
    const drawerHost = document.createElement("div");
    const watchHost = document.createElement("div");
    const video = document.createElement("video");

    expect(surface).not.toBeNull();
    surface?.replaceChildren(video);
    movePersistentVideoSurface(surface, drawerHost);
    movePersistentVideoSurface(surface, watchHost);

    expect(watchHost.firstElementChild).toBe(surface);
    expect(surface?.firstElementChild).toBe(video);
  });
});
