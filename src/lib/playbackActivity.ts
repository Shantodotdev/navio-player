export type PlaybackMilestone = "recently_played" | "play_count";

export interface PlaybackActivitySession {
  readonly trackId: string;
  observe: (mediaTime: number, duration: number) => PlaybackMilestone[];
  resetPosition: (mediaTime: number) => void;
  accumulatedSeconds: () => number;
}

const MAX_FORWARD_SAMPLE_DELTA_SECS = 3;

/**
 * Creates one meaningful-playback accumulator for a single active track.
 * Large media-time jumps are treated as seeks instead of listened time.
 */
export function createPlaybackActivitySession(
  trackId: string,
): PlaybackActivitySession {
  let lastMediaTime: number | null = null;
  let accumulated = 0;
  let recentlyPlayedEmitted = false;
  let playCountEmitted = false;

  return {
    trackId,
    observe(mediaTime, duration) {
      if (!Number.isFinite(mediaTime) || mediaTime < 0) return [];
      if (lastMediaTime === null) {
        lastMediaTime = mediaTime;
        return [];
      }

      const delta = mediaTime - lastMediaTime;
      lastMediaTime = mediaTime;
      if (delta <= 0 || delta > MAX_FORWARD_SAMPLE_DELTA_SECS) return [];
      accumulated += delta;

      const finiteDuration =
        Number.isFinite(duration) && duration > 0 ? duration : null;
      const recentlyPlayedThreshold = finiteDuration
        ? Math.min(10, finiteDuration / 2)
        : 10;
      const playCountThreshold = finiteDuration
        ? Math.min(4 * 60, finiteDuration / 2)
        : 4 * 60;
      const milestones: PlaybackMilestone[] = [];

      if (!recentlyPlayedEmitted && accumulated >= recentlyPlayedThreshold) {
        recentlyPlayedEmitted = true;
        milestones.push("recently_played");
      }
      if (!playCountEmitted && accumulated >= playCountThreshold) {
        playCountEmitted = true;
        milestones.push("play_count");
      }
      return milestones;
    },
    resetPosition(mediaTime) {
      lastMediaTime = Number.isFinite(mediaTime) ? mediaTime : null;
    },
    accumulatedSeconds() {
      return accumulated;
    },
  };
}
