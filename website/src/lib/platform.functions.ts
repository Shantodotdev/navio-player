import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";

export type DesktopPlatform = "Windows" | "macOS" | "Linux";

/** Returns the current request's desktop platform for platform-aware SSR. */
export const getRequestPlatform = createServerFn({ method: "GET" }).handler(
  () => detectDesktopPlatform(getRequestHeader("user-agent") ?? ""),
);

/** Detects supported desktop platforms from a request user-agent. */
function detectDesktopPlatform(userAgent: string): DesktopPlatform | null {
  const identity = userAgent.toLowerCase();

  if (
    identity.includes("android") ||
    identity.includes("iphone") ||
    identity.includes("ipad") ||
    identity.includes("ipod")
  ) {
    return null;
  }
  if (identity.includes("windows")) {
    return "Windows";
  }
  if (identity.includes("macintosh") || identity.includes("mac os")) {
    return "macOS";
  }
  if (identity.includes("linux") || identity.includes("x11")) {
    return "Linux";
  }

  return null;
}
