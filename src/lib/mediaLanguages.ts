/** The language codes Navio formats in the Watch player and exposes in Settings. */
export const NAVIO_LANGUAGE_OPTIONS = [
  ["ara", "Arabic"],
  ["ben", "Bengali"],
  ["deu", "German"],
  ["eng", "English"],
  ["fra", "French"],
  ["hin", "Hindi"],
  ["ita", "Italian"],
  ["jpn", "Japanese"],
  ["kor", "Korean"],
  ["por", "Portuguese"],
  ["rus", "Russian"],
  ["spa", "Spanish"],
  ["tam", "Tamil"],
  ["tel", "Telugu"],
  ["und", "Unknown language"],
  ["urd", "Urdu"],
  ["zho", "Chinese"],
] as const;

/** Formats an embedded stream language code consistently across Navio. */
export function formatLanguage(language: string | null): string | null {
  if (!language?.trim()) return null;
  const normalized = language.trim().toLowerCase();
  return (
    NAVIO_LANGUAGE_OPTIONS.find(([code]) => code === normalized)?.[1] ??
    language.trim()
  );
}
