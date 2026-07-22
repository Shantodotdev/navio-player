import type { Track } from "../store/playerStore";
import type { MediaActivity } from "./smartPlaylists";

export type LibrarySortMode =
  | "name-asc"
  | "name-desc"
  | "added-desc"
  | "added-asc"
  | "duration-desc"
  | "duration-asc"
  | "size-desc"
  | "size-asc";

export const LIBRARY_SORT_OPTIONS: Array<{
  value: LibrarySortMode;
  label: string;
}> = [
  { value: "name-asc", label: "Name: A–Z" },
  { value: "name-desc", label: "Name: Z–A" },
  { value: "added-desc", label: "Recently added" },
  { value: "added-asc", label: "Oldest added" },
  { value: "duration-desc", label: "Duration: longest" },
  { value: "duration-asc", label: "Duration: shortest" },
  { value: "size-desc", label: "Size: largest" },
  { value: "size-asc", label: "Size: smallest" },
];

const nameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/** Returns a sorted copy of visible library tracks without mutating store order. */
export function sortLibraryTracks(
  tracks: Track[],
  activity: Record<string, MediaActivity>,
  mode: LibrarySortMode,
): Track[] {
  return tracks
    .map((track, index) => ({ track, index }))
    .sort((left, right) => {
      const difference = compareTracks(left.track, right.track, activity, mode);
      return difference || left.index - right.index;
    })
    .map(({ track }) => track);
}

/** Compares two tracks using the selected user-facing library field. */
function compareTracks(
  left: Track,
  right: Track,
  activity: Record<string, MediaActivity>,
  mode: LibrarySortMode,
): number {
  switch (mode) {
    case "name-asc":
      return nameCollator.compare(getDisplayName(left), getDisplayName(right));
    case "name-desc":
      return nameCollator.compare(getDisplayName(right), getDisplayName(left));
    case "added-desc":
      return compareOptionalNumbers(
        activity[left.id]?.added_at_ms,
        activity[right.id]?.added_at_ms,
        "desc",
      );
    case "added-asc":
      return compareOptionalNumbers(
        activity[left.id]?.added_at_ms,
        activity[right.id]?.added_at_ms,
        "asc",
      );
    case "duration-desc":
      return right.duration_secs - left.duration_secs;
    case "duration-asc":
      return left.duration_secs - right.duration_secs;
    case "size-desc":
      return compareOptionalNumbers(
        left.file_size_bytes,
        right.file_size_bytes,
        "desc",
      );
    case "size-asc":
      return compareOptionalNumbers(
        left.file_size_bytes,
        right.file_size_bytes,
        "asc",
      );
  }
}

/** Uses the visible title when available and falls back to the filename. */
function getDisplayName(track: Track): string {
  return track.title?.trim() || track.name;
}

/** Sorts optional numeric metadata while consistently leaving unknown values last. */
function compareOptionalNumbers(
  left: number | null | undefined,
  right: number | null | undefined,
  direction: "asc" | "desc",
): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return direction === "asc" ? left - right : right - left;
}
