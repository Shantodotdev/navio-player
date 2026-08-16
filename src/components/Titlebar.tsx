import { useEffect, useState } from "react";
import { Minus, Square, X } from "lucide-react";
import type { Window } from "@tauri-apps/api/window";

// Check if we are running inside the Tauri shell environment
const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Renders Navio's window controls only when the native shell has no decorations. */
export function Titlebar() {
  const [appWindow, setAppWindow] = useState<Window | null>(null);
  const [usesCustomTitlebar, setUsesCustomTitlebar] = useState(!isTauri);

  // The window's real decoration state is the source of truth across platforms.
  useEffect(() => {
    if (!isTauri) return;

    let cancelled = false;

    /** Resolves native window chrome without importing Tauri APIs in the browser. */
    async function loadWindowChrome() {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const currentWindow = getCurrentWindow();
        const isDecorated = await currentWindow.isDecorated();
        if (cancelled) return;

        setAppWindow(currentWindow);
        setUsesCustomTitlebar(!isDecorated);
      } catch (error) {
        if (cancelled) return;
        console.warn("Could not determine Navio window decorations:", error);
        // Keep frameless Windows windows usable if the decoration query fails.
        setUsesCustomTitlebar(true);
      }
    }

    void loadWindowChrome();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleMinimize = () => {
    if (appWindow) {
      appWindow.minimize();
    }
  };

  const handleMaximize = () => {
    if (appWindow) {
      appWindow.toggleMaximize();
    }
  };

  const handleClose = () => {
    if (appWindow) {
      appWindow.close();
    }
  };

  if (!usesCustomTitlebar) return null;

  return (
    <div className="w-full h-8 bg-[#09090c] border-b border-white/5 flex items-center justify-between select-none z-100 shrink-0">
      {/* Left side: Draggable window region (title text removed for minimalist style) */}
      <div data-tauri-drag-region className="flex-1 h-full cursor-default" />

      {/* Right side: Control buttons (outside drag region) */}
      <div className="flex h-full items-center">
        {/* Minimize Button */}
        <button
          type="button"
          onClick={handleMinimize}
          className="w-11 h-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
        >
          <Minus size={14} strokeWidth={2} />
        </button>

        {/* Maximize Button */}
        <button
          type="button"
          onClick={handleMaximize}
          className="w-11 h-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
        >
          <Square size={12} strokeWidth={2} />
        </button>

        {/* Close Button */}
        <button
          type="button"
          onClick={handleClose}
          className="w-11 h-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-red-600 transition-colors cursor-pointer"
        >
          <X size={15} strokeWidth={3} />
        </button>
      </div>
    </div>
  );
}
