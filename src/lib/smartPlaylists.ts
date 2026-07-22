import type { Track } from "../store/playerStore";

export type SmartPlaylistId =
  | "recently-added"
  | "recently-played"
  | "continue-watching"
  | "most-played";

/** Activity data persisted locally by Navio's Rust activity service. */
export interface MediaActivity {
  media_id: string;
  path: string;
  added_at_ms: number | null;
  last_played_at_ms: number | null;
  play_count: number;
  resume_position_secs: number;
  duration_secs: number;
  progress_updated_at_ms: number | null;
  last_seen_at_ms: number;
}

/** One generated, read-only collection backed by current local activity. */
export interface SmartPlaylist {
  id: SmartPlaylistId;
  name: string;
  description: string;
  emptyDescription: string;
  tracks: Track[];
}

const COLLECTION_LIMIT = 30;

/** Derives Navio's fixed smart playlists from currently available media only. */
export function deriveSmartPlaylists(
  tracks: Track[],
  activity: Record<string, MediaActivity>,
): SmartPlaylist[] {
  const available = tracks.filter((track) => activity[track.id] !== undefined);

  const recentlyAdded = sortByActivity(
    available.filter((track) => activity[track.id]?.added_at_ms != null),
    activity,
    (entry) => entry.added_at_ms ?? 0,
  );
  const recentlyPlayed = sortByActivity(
    available.filter((track) => activity[track.id]?.last_played_at_ms != null),
    activity,
    (entry) => entry.last_played_at_ms ?? 0,
  );
  const continueWatching = sortByActivity(
    available.filter((track) => {
      const entry = activity[track.id];
      return (
        track.media_type === "video" &&
        entry !== undefined &&
        entry.resume_position_secs >= 5 &&
        entry.duration_secs > 0 &&
        entry.resume_position_secs < entry.duration_secs - 15
      );
    }),
    activity,
    (entry) => entry.progress_updated_at_ms ?? 0,
  );
  const mostPlayed = [...available]
    .filter((track) => (activity[track.id]?.play_count ?? 0) > 0)
    .sort((left, right) => {
      const leftEntry = activity[left.id];
      const rightEntry = activity[right.id];
      const countDifference =
        (rightEntry?.play_count ?? 0) - (leftEntry?.play_count ?? 0);
      if (countDifference !== 0) return countDifference;
      const playedDifference =
        (rightEntry?.last_played_at_ms ?? 0) -
        (leftEntry?.last_played_at_ms ?? 0);
      return playedDifference || left.id.localeCompare(right.id);
    })
    .slice(0, COLLECTION_LIMIT);

  return [
    {
      id: "recently-added",
      name: "Recently Added",
      description: "Media Navio discovered most recently.",
      emptyDescription: "New files discovered after activity tracking began will appear here.",
      tracks: recentlyAdded,
    },
    {
      id: "recently-played",
      name: "Recently Played",
      description: "Your latest meaningful playback sessions.",
      emptyDescription: "Play something for at least ten seconds to begin this collection.",
      tracks: recentlyPlayed,
    },
    {
      id: "continue-watching",
      name: "Continue Watching",
      description: "Videos with saved progress that are not yet complete.",
      emptyDescription: "Partially watched longer videos will appear here.",
      tracks: continueWatching,
    },
    {
      id: "most-played",
      name: "Most Played",
      description: "Media that has reached Navio's meaningful play threshold most often.",
      emptyDescription: "Frequently played media will appear here over time.",
      tracks: mostPlayed,
    },
  ];
}

/** Returns a clamped watch-progress percentage for smart-playlist presentation. */
export function getWatchProgress(
  track: Track,
  activity: Record<string, MediaActivity>,
): number {
  const entry = activity[track.id];
  if (!entry || entry.duration_secs <= 0) return 0;
  return Math.min(
    100,
    Math.max(0, (entry.resume_position_secs / entry.duration_secs) * 100),
  );
}

function sortByActivity(
  tracks: Track[],
  activity: Record<string, MediaActivity>,
  selectTimestamp: (entry: MediaActivity) => number,
): Track[] {
  return [...tracks]
    .sort((left, right) => {
      const leftEntry = activity[left.id];
      const rightEntry = activity[right.id];
      const timestampDifference =
        (rightEntry ? selectTimestamp(rightEntry) : 0) -
        (leftEntry ? selectTimestamp(leftEntry) : 0);
      return timestampDifference || left.id.localeCompare(right.id);
    })
    .slice(0, COLLECTION_LIMIT);
}
