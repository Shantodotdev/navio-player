const PLAYLIST_VALIDATION_MESSAGES = new Set([
  "Playlist name cannot be empty.",
  "A playlist with this name already exists.",
]);

/** Distinguishes fixable naming feedback from persistence and filesystem failures. */
export function isPlaylistValidationMessage(message: string): boolean {
  return PLAYLIST_VALIDATION_MESSAGES.has(message);
}
