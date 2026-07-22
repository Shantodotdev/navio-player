const GENERIC_ERROR_MESSAGE = "Something went wrong.";
const MAX_USER_MESSAGE_LENGTH = 240;
const ABSOLUTE_PATH_PATTERN =
  /(?:[a-z]:[\\/]|\\\\[^\\]|\/(?:users|home|tmp|var|etc|mnt|opt|volumes|private|usr|root|run|srv|dev|proc|sys)\/)/i;
const TECHNICAL_DIAGNOSTIC_PATTERN =
  /(?:\b(?:sqlstate|sqlite_[a-z_]+|enoent|eacces|eperm|econn\w*|typeerror|referenceerror|syntaxerror|rangeerror|runtimeerror|panic(?:ked)?|stack trace|exit code|stderr|stdout)\b|(?:database|parse|parser|process|runtime|serializ(?:ation|e)|deserializ(?:ation|e)) error:|(?:^|\s)at\s+[\w$.<>]+\s*\()/i;

/** Accepts concise single-line messages that do not reveal absolute local paths. */
function isSafeUserMessage(message: string): boolean {
  return (
    message.length <= MAX_USER_MESSAGE_LENGTH &&
    !/[\r\n]/.test(message) &&
    !ABSOLUTE_PATH_PATTERN.test(message) &&
    !TECHNICAL_DIAGNOSTIC_PATTERN.test(message)
  );
}

/** Narrows an unknown failure to safe user-facing text with a stable fallback. */
export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message && isSafeUserMessage(message)) return message;
  }
  if (typeof error === "string") {
    const message = error.trim();
    if (message && isSafeUserMessage(message)) return message;
  }
  return fallback.trim() || GENERIC_ERROR_MESSAGE;
}
