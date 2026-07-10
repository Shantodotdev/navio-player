/**
 * Shared theater-media contracts and lightweight client utilities.
 *
 * Both the full watch route and the now-playing sidebar use this module so
 * stream URLs, persisted state, extraction cancellation, and subtitle parsing
 * behave consistently across player surfaces.
 */

/** Minimum video duration eligible for resume-position persistence. */
export const MIN_RESUMABLE_VIDEO_DURATION_SECS = 10 * 60;

/** Whether the current renderer is running inside the Tauri desktop shell. */
export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Selectable audio or subtitle stream embedded in a video container. */
export type EmbeddedTrack = {
  /** Absolute FFmpeg stream index used by `-map 0:<index>`. */
  stream_index: number;
  /** Container-provided language code, commonly ISO 639-2. */
  language: string | null;
  /** Optional human-readable stream title. */
  title: string | null;
  /** Whether the container marks this stream as its default. */
  is_default: boolean;
  /** FFmpeg codec identifier used to choose remuxing or transcoding. */
  codec: string;
};

/** Audio and subtitle streams discovered in one source video. */
export type VideoTrackInfo = {
  audio_tracks: EmbeddedTrack[];
  subtitle_tracks: EmbeddedTrack[];
};

/** Track metadata and persisted preferences required to initialize a player. */
export type TheaterMediaInfo = VideoTrackInfo & {
  /** Last saved playback position in seconds. */
  resume_position_secs: number;
  /** User-selected audio stream, if one was saved. */
  preferred_audio_stream_index: number | null;
  /** Distinguishes no saved choice from an explicit subtitles-off choice. */
  subtitle_preference_set: boolean;
  /** Saved subtitle stream; null means off when a preference is set. */
  preferred_subtitle_stream_index: number | null;
  /** Audio streams already prepared on disk and safe to restore immediately. */
  cached_audio_stream_indexes: number[];
};

/** Parsed WebVTT cue used by the custom subtitle overlay. */
export type SubtitleCue = {
  /** Inclusive cue start time in seconds. */
  start: number;
  /** Exclusive cue end time in seconds. */
  end: number;
  /** Plain text displayed by the subtitle overlay. */
  text: string;
};

type TheaterStateUpdate = {
  /** Canonical library path understood by the Rust backend. */
  path: string;
  /** Source duration, used by Rust to enforce the ten-minute resume rule. */
  durationSecs: number;
  /** Current playback position in seconds. */
  positionSecs: number;
  /** Audio stream to save when preferences are included. */
  audioStreamIndex?: number | null;
  /** Subtitle stream to save when subtitles are enabled. */
  subtitleStreamIndex?: number | null;
  /** False records an explicit subtitles-off preference. */
  subtitleEnabled?: boolean;
  /** False updates progress without overwriting newer track choices. */
  savePreferences: boolean;
};

/** Builds a token-authenticated URL for the local streaming server. */
export function buildStreamUrl(
  port: number,
  token: string,
  path: string,
): string {
  return `http://127.0.0.1:${port}/stream/${encodeURIComponent(path)}?token=${encodeURIComponent(token)}`;
}

/** Creates a unique ID used to join or cancel a backend preparation request. */
export function createRequestId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Releases one extraction request and lets Rust stop unneeded FFmpeg work. */
export async function cancelMediaPreparation(requestId: string | null) {
  if (!requestId || !isTauri) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("cancel_media_preparation", { requestId });
  } catch (error) {
    console.warn("Cancelling media preparation failed:", error);
  }
}

/** Persists playback progress and optionally the user's track preferences. */
export async function persistTheaterState(update: TheaterStateUpdate) {
  if (!isTauri) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_theater_state", {
      path: update.path,
      durationSecs: update.durationSecs,
      positionSecs: update.positionSecs,
      audioStreamIndex: update.audioStreamIndex ?? null,
      subtitleStreamIndex: update.subtitleStreamIndex ?? null,
      subtitleEnabled: update.subtitleEnabled ?? false,
      savePreferences: update.savePreferences,
    });
  } catch (error) {
    console.warn("Saving theater state failed:", error);
  }
}

/** Returns whether a codec can be exposed through a cheap stream-copy remux. */
export function isCopyCompatibleAudio(codec: string): boolean {
  return ["aac", "mp3", "opus", "vorbis"].includes(codec.toLowerCase());
}

/**
 * Finds subtitle text active at `time` using the previous cue as a fast path
 * and binary search after seeks or discontinuities.
 *
 * The returned index should be supplied as `cursor` on the next lookup.
 */
export function findActiveSubtitle(
  cues: SubtitleCue[],
  time: number,
  cursor: number,
): { index: number; text: string } {
  if (cues.length === 0) return { index: -1, text: "" };

  let index = cursor;
  if (
    index < 0 ||
    index >= cues.length ||
    time < cues[index].start ||
    time >= cues[index].end
  ) {
    // Locate the final cue whose start time is not later than playback time.
    let low = 0;
    let high = cues.length - 1;
    index = -1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      if (cues[middle].start <= time) {
        index = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
  }

  if (index < 0 || time >= cues[index].end) {
    return { index, text: "" };
  }

  let first = index;
  // Walk back and forward around the match to preserve overlapping cues.
  while (
    first > 0 &&
    cues[first - 1].start <= time &&
    cues[first - 1].end > time
  ) {
    first -= 1;
  }
  const text: string[] = [];
  for (let cueIndex = first; cueIndex < cues.length; cueIndex += 1) {
    const cue = cues[cueIndex];
    if (cue.start > time) break;
    if (cue.end > time) text.push(cue.text);
  }
  return { index, text: text.join("\n") };
}

/** Parses WebVTT text into sorted, plain-text cues for the custom overlay. */
export function parseWebVtt(vtt: string): SubtitleCue[] {
  return vtt
    .replace(/^\uFEFF?WEBVTT[^\n]*\r?\n/, "")
    .split(/\r?\n\r?\n/)
    .flatMap((block) => {
      const lines = block.split(/\r?\n/).filter(Boolean);
      const timingIndex = lines.findIndex((line) => line.includes("-->"));
      if (timingIndex === -1) return [];

      const [startText, endText] = lines[timingIndex]
        .split("-->")
        .map((time) => time.trim().split(/\s+/)[0]);
      const start = parseSubtitleTime(startText);
      const end = parseSubtitleTime(endText);
      const text = lines
        .slice(timingIndex + 1)
        .join("\n")
        // Styling tags are intentionally removed because React renders plain text.
        .replace(/<[^>]+>/g, "")
        .trim();
      return Number.isFinite(start) && Number.isFinite(end) && text
        ? [{ start, end, text }]
        : [];
    })
    .sort((left, right) => left.start - right.start);
}

/** Parses `MM:SS.mmm` and `HH:MM:SS.mmm` WebVTT timestamps. */
function parseSubtitleTime(value: string | undefined): number {
  if (!value) return Number.NaN;
  const parts = value.replace(",", ".").split(":").map(Number);
  if (parts.some(Number.isNaN) || parts.length < 2 || parts.length > 3) {
    return Number.NaN;
  }
  return parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts[0] * 60 + parts[1];
}
