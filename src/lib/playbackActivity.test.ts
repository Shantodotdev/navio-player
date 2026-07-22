import { describe, expect, it } from "vitest";
import { createPlaybackActivitySession } from "./playbackActivity";

function advance(
  session: ReturnType<typeof createPlaybackActivitySession>,
  from: number,
  to: number,
  duration: number,
) {
  const milestones = [];
  session.observe(from, duration);
  for (let second = from + 1; second <= to; second += 1) {
    milestones.push(...session.observe(second, duration));
  }
  return milestones;
}

describe("createPlaybackActivitySession", () => {
  it("emits Recently Played after ten seconds of forward playback", () => {
    const session = createPlaybackActivitySession("track");

    expect(advance(session, 0, 9, 180)).toEqual([]);
    expect(session.observe(10, 180)).toEqual(["recently_played"]);
  });

  it("emits Play Count at half the duration when that is below four minutes", () => {
    const session = createPlaybackActivitySession("track");

    const milestones = advance(session, 0, 90, 180);

    expect(milestones.filter((item) => item === "play_count")).toHaveLength(1);
  });

  it("uses four minutes as the maximum play-count threshold", () => {
    const session = createPlaybackActivitySession("track");

    const milestones = advance(session, 0, 240, 1_200);

    expect(milestones.at(-1)).toBe("play_count");
  });

  it("does not count a forward seek as playback", () => {
    const session = createPlaybackActivitySession("track");
    session.observe(0, 180);
    session.resetPosition(100);

    expect(session.observe(101, 180)).toEqual([]);
    expect(session.accumulatedSeconds()).toBe(1);
  });

  it("emits each milestone at most once per session", () => {
    const session = createPlaybackActivitySession("track");

    const milestones = advance(session, 0, 180, 180);

    expect(milestones.filter((item) => item === "recently_played")).toHaveLength(1);
    expect(milestones.filter((item) => item === "play_count")).toHaveLength(1);
  });

  it("allows short media to reach both meaningful thresholds", () => {
    const session = createPlaybackActivitySession("short");

    const milestones = advance(session, 0, 2, 4);

    expect(milestones).toEqual(["recently_played", "play_count"]);
  });
});
