import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  FastForward,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Rewind,
  Volume2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { usePlayerStore } from "../store/playerStore";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const Route = createFileRoute("/watch")({
  component: WatchView,
});

function WatchView() {
  const navigate = useNavigate();
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideControlsTimer = useRef<number | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);

  const {
    currentTrack,
    currentTime,
    isPlaying,
    nextTrack,
    prevTrack,
    setCurrentTime,
    setIsPlaying,
    setMediaElement,
    clearMediaElement,
    setTheaterOpen,
    setVolume,
    volume,
  } = usePlayerStore();

  const isVideo = currentTrack?.media_type === "video";
  const duration = currentTrack?.duration_secs ?? 0;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  useEffect(() => {
    setTheaterOpen(isVideo);
    stageRef.current?.focus();
    const media = videoRef.current;
    if (media) setMediaElement(media);

    if (isVideo && isTauri) {
      const enterNativeFullscreen = async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("set_theater_fullscreen", { fullscreen: true });
          setIsNativeFullscreen(true);
        } catch (error) {
          console.warn("Entering native fullscreen failed:", error);
        }
      };

      void enterNativeFullscreen();
    }

    return () => {
      setTheaterOpen(false);
      clearMediaElement(media);
      if (isTauri) {
        void import("@tauri-apps/api/core")
          .then(({ invoke }) =>
            invoke("set_theater_fullscreen", { fullscreen: false }),
          )
          .catch(() => undefined);
      }
    };
  }, [clearMediaElement, isVideo, setMediaElement, setTheaterOpen]);

  useEffect(() => {
    if (isVideo) return;
    void navigate({ to: "/library", replace: true });
  }, [isVideo, navigate]);

  useEffect(() => {
    if (!showControls || !isPlaying) return;

    if (hideControlsTimer.current) {
      window.clearTimeout(hideControlsTimer.current);
    }

    hideControlsTimer.current = window.setTimeout(() => {
      setShowControls(false);
    }, 2800);

    return () => {
      if (hideControlsTimer.current) {
        window.clearTimeout(hideControlsTimer.current);
      }
    };
  }, [isPlaying, showControls]);

  const revealControls = () => setShowControls(true);

  const leaveNativeFullscreen = async () => {
    if (!isTauri) return;

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_theater_fullscreen", { fullscreen: false });
      setIsNativeFullscreen(false);
    } catch (error) {
      console.warn("Leaving native fullscreen failed:", error);
    }
  };

  const exitWatch = async () => {
    await leaveNativeFullscreen();
    setTheaterOpen(false);
    await navigate({ to: "/library" });
  };

  const seekBy = (seconds: number) => {
    const media = videoRef.current;
    if (!media) return;

    const nextTime = Math.max(
      0,
      Math.min(media.duration || duration || 0, media.currentTime + seconds),
    );
    media.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const toggleFullscreen = async () => {
    if (isTauri) {
      if (isNativeFullscreen) {
        await exitWatch();
        return;
      }

      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const nextFullscreen = await invoke<boolean>(
          "toggle_theater_fullscreen",
        );
        setIsNativeFullscreen(nextFullscreen);
      } catch (error) {
        console.warn("Native fullscreen failed:", error);
      }
      return;
    }

    if (document.fullscreenElement) {
      await exitWatch();
    } else {
      await stageRef.current?.requestFullscreen().catch(() => undefined);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    revealControls();

    if (event.key === " " || event.key.toLowerCase() === "k") {
      event.preventDefault();
      setIsPlaying(!isPlaying);
    } else if (event.key === "ArrowLeft" || event.key.toLowerCase() === "j") {
      event.preventDefault();
      seekBy(-10);
    } else if (event.key === "ArrowRight" || event.key.toLowerCase() === "l") {
      event.preventDefault();
      seekBy(10);
    } else if (event.key.toLowerCase() === "m") {
      event.preventDefault();
      setVolume(volume === 0 ? 80 : 0);
    } else if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      void toggleFullscreen();
    } else if (event.key === "Escape") {
      if (isNativeFullscreen) {
        void leaveNativeFullscreen();
      } else if (document.fullscreenElement) {
        void document.exitFullscreen();
      } else {
        void exitWatch();
      }
    }
  };

  if (!isVideo || !currentTrack) {
    return (
      <main className="grid h-screen w-screen place-items-center bg-black text-white">
        <button
          type="button"
          onClick={() => void navigate({ to: "/library" })}
          className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10 transition-colors cursor-pointer"
        >
          Back to library
        </button>
      </main>
    );
  }

  return (
    <main
      ref={stageRef}
      tabIndex={0}
      onMouseMove={revealControls}
      onPointerMove={revealControls}
      onKeyDown={handleKeyDown}
      className="watch-stage fixed inset-0 overflow-hidden bg-black text-white outline-none"
    >
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        onClick={() => setIsPlaying(!isPlaying)}
        onTimeUpdate={(event) =>
          setCurrentTime(event.currentTarget.currentTime)
        }
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onWaiting={() => setIsBuffering(true)}
        onCanPlay={() => setIsBuffering(false)}
        onEnded={nextTrack}
      />

      {isBuffering && (
        <div className="absolute inset-0 grid place-items-center bg-black/30">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/25 border-t-white" />
        </div>
      )}

      <div
        onClick={(event) => {
          if (event.target === event.currentTarget) setIsPlaying(!isPlaying);
        }}
        className={`absolute inset-0 flex flex-col justify-between bg-linear-to-b from-black/80 via-transparent to-black/85 px-8 py-7 transition-opacity duration-300 ${
          showControls || !isPlaying
            ? "opacity-100"
            : "pointer-events-none opacity-0"
        }`}
      >
        <div className="flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => void exitWatch()}
            className="grid h-10 w-10 place-items-center rounded-full bg-black/55 text-white hover:bg-white/15 transition-colors cursor-pointer"
            aria-label="Exit theater"
          >
            <X size={20} />
          </button>

          <div className="min-w-0 flex-1 px-2">
            <h1 className="truncate text-xl font-medium text-white">
              {currentTrack.title || currentTrack.name}
            </h1>
            <p className="mt-1 text-sm text-white/55">Theater mode</p>
          </div>

          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            className="grid h-10 w-10 place-items-center rounded-full bg-black/55 text-white hover:bg-white/15 transition-colors cursor-pointer"
            aria-label="Enter fullscreen"
          >
            <Maximize2 size={19} />
          </button>
        </div>

        <div className="space-y-4">
          <input
            type="range"
            min="0"
            max={duration || 0}
            value={Math.min(currentTime, duration || 0)}
            onChange={(event) => {
              const nextTime = Number(event.target.value);
              if (videoRef.current) videoRef.current.currentTime = nextTime;
              setCurrentTime(nextTime);
            }}
            aria-label="Seek video"
            className="theater-progress w-full cursor-pointer"
            style={{
              background: `linear-gradient(to right, #c72c4e 0%, #c72c4e ${progress}%, rgba(255, 255, 255, 0.55) ${progress}%, rgba(255, 255, 255, 0.55) 100%)`,
            }}
          />

          <div className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-5">
              <button
                type="button"
                onClick={prevTrack}
                aria-label="Previous video"
                className="hover:text-brand-light transition-colors cursor-pointer"
              >
                <ChevronLeft size={28} />
              </button>
              <button
                type="button"
                onClick={() => seekBy(-10)}
                aria-label="Rewind 10 seconds"
                className="hover:text-brand-light transition-colors cursor-pointer"
              >
                <Rewind size={26} />
              </button>
              <button
                type="button"
                onClick={() => setIsPlaying(!isPlaying)}
                aria-label={isPlaying ? "Pause video" : "Play video"}
                className="grid h-14 w-14 place-items-center rounded-full bg-white text-black hover:bg-brand-light hover:text-white transition-colors cursor-pointer"
              >
                {isPlaying ? (
                  <Pause size={22} fill="currentColor" />
                ) : (
                  <Play
                    size={22}
                    fill="currentColor"
                    className="translate-x-px"
                  />
                )}
              </button>
              <button
                type="button"
                onClick={() => seekBy(10)}
                aria-label="Forward 10 seconds"
                className="hover:text-brand-light transition-colors cursor-pointer"
              >
                <FastForward size={26} />
              </button>
              <button
                type="button"
                onClick={nextTrack}
                aria-label="Next video"
                className="hover:text-brand-light transition-colors cursor-pointer"
              >
                <ChevronRight size={28} />
              </button>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setVolume(volume === 0 ? 80 : 0)}
                className="hover:text-brand-light transition-colors cursor-pointer"
                aria-label="Toggle mute"
              >
                <Volume2 size={20} />
              </button>
              <span className="w-20 text-right text-sm tabular-nums text-white/70">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
              <button
                type="button"
                onClick={() => void exitWatch()}
                className="hidden items-center gap-2 rounded-lg bg-black/45 px-3 py-2 text-sm text-white hover:bg-white/15 transition-colors cursor-pointer sm:flex"
              >
                <Minimize2 size={17} />
                Exit
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function formatTime(secs: number): string {
  if (!secs || Number.isNaN(secs)) return "0:00";
  const minutes = Math.floor(secs / 60);
  const seconds = Math.floor(secs % 60);
  return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
}
