import { useRouterState } from "@tanstack/react-router";
import { Keyboard, X } from "lucide-react";
import { useEffect, useState } from "react";
import { usePlayerStore } from "../store/playerStore";

const SHORTCUTS = [
  { keys: "Space / K", action: "Play or pause" },
  { keys: "← / →", action: "Seek backward or forward 10 seconds" },
  { keys: "↑ / ↓", action: "Volume up or down" },
  { keys: "Q", action: "Toggle Now Playing" },
  { keys: "?", action: "Show keyboard shortcuts" },
  { keys: "Ctrl + F", action: "Focus library search" },
  { keys: "Ctrl + O", action: "Add a library folder" },
  { keys: "Ctrl + N", action: "Create a playlist" },
] as const;

/** Releases pointer-created button focus without affecting keyboard navigation. */
function blurPointerActivatedButton(event: PointerEvent) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest("button");
  if (button instanceof HTMLButtonElement) button.blur();
}

/** Provides Navio's fixed app-wide shortcuts and their reference overlay. */
export function KeyboardShortcuts() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    // Pointerup occurs before click, so actions still fire without retaining focus.
    window.addEventListener("pointerup", blurPointerActivatedButton, true);
    return () =>
      window.removeEventListener("pointerup", blurPointerActivatedButton, true);
  }, []);

  useEffect(() => {
    /** Routes one key press while preserving native behavior for focused controls. */
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.defaultPrevented) return;

      if (isOpen) {
        if (event.key === "Escape" || event.key === "?") {
          event.preventDefault();
          event.stopImmediatePropagation();
          setIsOpen(false);
        } else if (
          [
            " ",
            "k",
            "q",
            "f",
            "arrowleft",
            "arrowright",
            "arrowup",
            "arrowdown",
          ].includes(event.key.toLowerCase())
        ) {
          // Keep media controls behind the modal inert while it has focus.
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        return;
      }

      const target = event.target;
      const isInteractive =
        target instanceof Element &&
        target.closest(
          "input, textarea, select, button, a, [contenteditable='true'], [role='button'], [role='slider']",
        ) !== null;

      if (
        pathname === "/library" &&
        event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        event.key.toLowerCase() === "f"
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const searchInput = document.getElementById("library-search");
        if (searchInput instanceof HTMLInputElement) {
          searchInput.focus();
          searchInput.select();
        }
        return;
      }

      if (
        pathname === "/library" &&
        event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        event.key.toLowerCase() === "o" &&
        !event.repeat
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        document.getElementById("add-library-folder")?.click();
        return;
      }

      if (isInteractive || event.altKey || event.metaKey) return;

      if (event.ctrlKey) {
        if (event.repeat) return;

        if (pathname === "/playlists" && event.key.toLowerCase() === "n") {
          event.preventDefault();
          event.stopImmediatePropagation();
          document.getElementById("create-playlist")?.click();
        }
        return;
      }

      const player = usePlayerStore.getState();
      const key = event.key.toLowerCase();
      const theaterHandlesKey = pathname === "/watch" || player.isTheaterOpen;

      if ((event.key === " " || key === "k") && player.currentTrack) {
        if (theaterHandlesKey || event.repeat) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        player.setIsPlaying(!player.isPlaying);
      } else if (event.key === "ArrowLeft" && player.currentTrack) {
        if (theaterHandlesKey) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        player.seekBy(-10);
      } else if (event.key === "ArrowRight" && player.currentTrack) {
        if (theaterHandlesKey) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        player.seekBy(10);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopImmediatePropagation();
        player.setVolume(Math.min(100, player.volume + 5));
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopImmediatePropagation();
        player.setVolume(Math.max(0, player.volume - 5));
      } else if (key === "q" && !event.repeat) {
        event.preventDefault();
        event.stopImmediatePropagation();
        player.toggleDrawer();
      } else if (event.key === "?" && !event.repeat) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setIsOpen(true);
      }
    }

    // Capture prevents view-specific listeners from applying the same shortcut twice.
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, pathname]);

  return (
    <div
      aria-hidden={!isOpen}
      className={`fixed inset-0 z-120 flex items-center justify-center bg-black/50 p-4 select-none transition-opacity duration-200 ${
        isOpen
          ? "pointer-events-auto opacity-100"
          : "pointer-events-none opacity-0"
      }`}
      role="presentation"
      onClick={() => setIsOpen(false)}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-shortcuts-title"
        onClick={(event) => event.stopPropagation()}
        className={`w-full max-w-lg space-y-4 rounded-2xl border border-white/10 bg-[#0e0e12]/85 p-6 shadow-2xl backdrop-blur-sm transition-all duration-200 transform ${
          isOpen ? "scale-100 opacity-100" : "scale-95 opacity-0"
        }`}
      >
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Keyboard size={20} className="text-brand-light" />
            <h2
              id="keyboard-shortcuts-title"
              className="text-xl font-medium text-zinc-200"
            >
              Keyboard shortcuts
            </h2>
          </div>
          <button
            type="button"
            tabIndex={isOpen ? 0 : -1}
            onClick={(event) => {
              event.currentTarget.blur();
              setIsOpen(false);
            }}
            aria-label="Close keyboard shortcuts"
            className="rounded-full p-2 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
          >
            <X size={18} />
          </button>
        </header>

        <div className="grid gap-2 pt-2">
          {SHORTCUTS.map((shortcut) => (
            <div
              key={shortcut.keys}
              className="flex items-center justify-between gap-6 rounded-lg px-3 py-2.5 hover:bg-white/3"
            >
              <span className="text-sm text-zinc-400">{shortcut.action}</span>
              <kbd className="shrink-0 rounded-md border border-white/10 bg-black/40 px-2.5 py-1 text-sm font-medium font-[inherit] text-zinc-200 shadow-sm">
                {shortcut.keys}
              </kbd>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
