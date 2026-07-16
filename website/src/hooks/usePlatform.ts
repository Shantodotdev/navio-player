import { useEffect, useState } from "react";

export type DesktopPlatform = "Windows" | "macOS" | "Linux";

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    platform?: string;
  };
};

/** Returns the visitor's supported desktop platform after client hydration. */
export function usePlatform(): DesktopPlatform | null {
  const [platform, setPlatform] = useState<DesktopPlatform | null>(null);

  useEffect(() => {
    const browserNavigator = navigator as NavigatorWithUserAgentData;
    const platformHint =
      browserNavigator.userAgentData?.platform ?? browserNavigator.platform;

    setPlatform(
      detectDesktopPlatform(
        browserNavigator.userAgent,
        platformHint,
        browserNavigator.maxTouchPoints,
      ),
    );
  }, []);

  return platform;
}

/** Detects supported desktop platforms from browser platform hints. */
function detectDesktopPlatform(
  userAgent: string,
  platform: string,
  maxTouchPoints: number,
): DesktopPlatform | null {
  const identity = `${platform} ${userAgent}`.toLowerCase();

  if (
    identity.includes("android") ||
    identity.includes("iphone") ||
    identity.includes("ipad") ||
    identity.includes("ipod") ||
    (identity.includes("mac") && maxTouchPoints > 1)
  ) {
    return null;
  }
  if (identity.includes("win")) {
    return "Windows";
  }
  if (identity.includes("mac")) {
    return "macOS";
  }
  if (identity.includes("linux") || identity.includes("x11")) {
    return "Linux";
  }

  return null;
}
