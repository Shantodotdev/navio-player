export const DEFAULT_DRAWER_WIDTH = 640;
export const MIN_DRAWER_WIDTH = 480;
export const MAX_DRAWER_WIDTH = 860;
export const DRAWER_WIDTH_STORAGE_KEY = "navio.now-playing.width";

export function getMaxDrawerWidth(viewportWidth: number) {
  return Math.max(
    MIN_DRAWER_WIDTH,
    Math.min(MAX_DRAWER_WIDTH, Math.floor(viewportWidth * 0.7)),
  );
}

export function clampDrawerWidth(width: number, viewportWidth: number) {
  return Math.min(
    getMaxDrawerWidth(viewportWidth),
    Math.max(MIN_DRAWER_WIDTH, Math.round(width)),
  );
}

export function getStoredDrawerWidth(viewportWidth: number) {
  const storedWidth = Number(
    window.localStorage.getItem(DRAWER_WIDTH_STORAGE_KEY),
  );

  return clampDrawerWidth(
    Number.isFinite(storedWidth) && storedWidth > 0
      ? storedWidth
      : DEFAULT_DRAWER_WIDTH,
    viewportWidth,
  );
}
