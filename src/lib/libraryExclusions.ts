/** Parses a compact comma/newline list into stable case-insensitive folder names. */
export function parseLibraryExclusions(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(/[,\n]/)
    .map((name) => name.trim())
    .filter((name) => {
      const key = name.toLocaleLowerCase();
      if (!name || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
