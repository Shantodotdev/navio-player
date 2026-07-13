import type { Track } from "../store/playerStore";

const MEDIA_EXTENSION_PATTERN =
  /\.(?:aac|avi|flac|m4a|m4v|mkv|mov|mp3|mp4|ogg|opus|webm|wav|wmv)$/i;

/** Returns a media filename with its recognized media extension optionally removed. */
export function getMediaDisplayName(
  label: string,
  showFileExtensions: boolean,
): string {
  return showFileExtensions
    ? label
    : label.replace(MEDIA_EXTENSION_PATTERN, "");
}

/** Selects the visible title for a library track using the global extension preference. */
export function getTrackDisplayName(
  track: Track,
  showFileExtensions: boolean,
): string {
  return getMediaDisplayName(track.title || track.name, showFileExtensions);
}
