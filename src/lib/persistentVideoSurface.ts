let drawerVideoSurfaceHost: HTMLDivElement | null = null;
let persistentVideoSurface: HTMLDivElement | null = null;

/** Registers the drawer placeholder that hosts the persistent video surface. */
export function setDrawerVideoSurfaceHost(host: HTMLDivElement | null): void {
  drawerVideoSurfaceHost = host;
}

/** Returns the current drawer placeholder for the persistent video surface. */
export function getDrawerVideoSurfaceHost(): HTMLDivElement | null {
  return drawerVideoSurfaceHost;
}

/** Creates one stable portal surface whose media children survive presentation changes. */
export function getPersistentVideoSurface(): HTMLDivElement | null {
  if (typeof document === "undefined") return null;

  if (!persistentVideoSurface) {
    persistentVideoSurface = document.createElement("div");
    persistentVideoSurface.className = "absolute inset-0";
    persistentVideoSurface.dataset.persistentVideoSurface = "true";
  }

  return persistentVideoSurface;
}

/** Moves the stable portal container while preserving every media child node. */
export function movePersistentVideoSurface(
  surface: HTMLDivElement | null,
  destination: HTMLElement | null,
): void {
  if (!surface || !destination || surface.parentElement === destination) {
    return;
  }

  destination.prepend(surface);
}
