import {
  Volume2,
  SkipForward,
  SkipBack,
  Play,
  Pause,
  Repeat,
  Shuffle,
  Music,
  Maximize2,
  PanelRight,
} from "lucide-react";
import { useEffect, useState } from "react";
import { usePlayerStore } from "../store/playerStore";

/// Global bottom player controller bar (full viewport width).
export function PlayerBar() {
  const {
    currentTrack,
    isPlaying,
    setIsPlaying,
    nextTrack,
    prevTrack,
    toggleDrawer,
    isDrawerOpen,
    currentTime,
    setCurrentTime,
    volume,
    setVolume,
    mediaElement,
  } = usePlayerStore();

  const [coverUrl, setCoverUrl] = useState("");

  // Resolve local cached cover art files using Tauri convertFileSrc (safe for browser rendering)
  useEffect(() => {
    if (currentTrack?.cover_cache_path) {
      const convertPath = async () => {
        try {
          const { convertFileSrc } = await import("@tauri-apps/api/core");
          setCoverUrl(convertFileSrc(currentTrack.cover_cache_path!));
        } catch (err) {
          setCoverUrl("");
        }
      };
      convertPath();
    } else {
      setCoverUrl("");
    }
  }, [currentTrack]);

  // MouseDown handler to support smooth dragging/scrubbing on the timeline
  const handleTimelineMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!currentTrack || !mediaElement || currentTrack.duration_secs <= 0)
      return;

    // Capture the target element to get its bounding box during moves
    const timelineContainer = e.currentTarget;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const rect = timelineContainer.getBoundingClientRect();
      const clickX = moveEvent.clientX - rect.left;
      const clickPercent = Math.max(0, Math.min(1, clickX / rect.width));
      const targetTime = clickPercent * currentTrack.duration_secs;

      // Update both HTML5 audio and store state immediately
      mediaElement.currentTime = targetTime;
      setCurrentTime(targetTime);
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    // Trigger initial click position immediately
    handleMouseMove(e.nativeEvent);

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // MouseDown handler to support smooth dragging on the volume bar
  const handleVolumeMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const volumeContainer = e.currentTarget;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const rect = volumeContainer.getBoundingClientRect();
      const clickX = moveEvent.clientX - rect.left;
      const clickPercent = Math.max(0, Math.min(1, clickX / rect.width));
      const targetVol = Math.round(clickPercent * 100);

      setVolume(targetVol);
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    // Trigger initial click position immediately
    handleMouseMove(e.nativeEvent);

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const progressPercent =
    currentTrack && currentTrack.duration_secs > 0
      ? (currentTime / currentTrack.duration_secs) * 100
      : 0;

  return (
    <div className="w-full h-24 bg-[#050507]/98 backdrop-blur-2xl border-t border-white/5 px-8 flex items-center justify-between shadow-[0_-15px_30px_-15px_rgba(0,0,0,0.8)] z-50 shrink-0 select-none">
      {/* Left: Active Track Details */}
      <div className="flex items-center gap-4 w-1/3">
        <div className="w-14 h-14 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden group relative shrink-0">
          {coverUrl ? (
            <img src={coverUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <Music size={22} className="text-zinc-400" />
          )}
          {currentTrack && (
            <button
              onClick={toggleDrawer}
              className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
            >
              <Maximize2 size={14} className="text-zinc-200" />
            </button>
          )}
        </div>
        <div
          className="flex flex-col truncate max-w-50 cursor-pointer"
          onClick={toggleDrawer}
          title="Click to toggle Now Playing"
        >
          <span className="text-sm font-medium text-zinc-200 truncate hover:text-brand-light transition-colors">
            {currentTrack
              ? currentTrack.title || currentTrack.name
              : "No track playing"}
          </span>
          <span className="text-xs text-zinc-400 truncate mt-0.5 font-medium">
            {currentTrack
              ? currentTrack.artist || "Unknown Artist"
              : "Select a file to play"}
          </span>
        </div>
      </div>

      {/* Center: Controls & Timeline */}
      <div className="flex flex-col items-center gap-2 w-1/3">
        <div className="flex items-center gap-5">
          <button className="text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer">
            <Shuffle size={16} />
          </button>
          <button
            onClick={prevTrack}
            disabled={!currentTrack}
            className="text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <SkipBack size={18} />
          </button>
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            disabled={!currentTrack}
            className="w-10 h-10 rounded-full bg-brand hover:bg-brand-light flex items-center justify-center text-zinc-200 transition-all shadow-md shadow-brand-glow transform active:scale-95 animate-none cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isPlaying ? (
              <Pause size={18} fill="currentColor" />
            ) : (
              <Play size={18} className="translate-x-px" fill="currentColor" />
            )}
          </button>
          <button
            onClick={nextTrack}
            disabled={!currentTrack}
            className="text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <SkipForward size={18} />
          </button>
          <button className="text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer">
            <Repeat size={16} />
          </button>
        </div>

        {/* Progress timeline bar */}
        <div className="w-full flex items-center gap-2 text-2xs text-zinc-500 font-medium">
          <span>{formatTime(currentTime)}</span>
          <div
            onMouseDown={handleTimelineMouseDown}
            className="flex-1 h-4 flex items-center cursor-pointer relative group"
          >
            <div className="w-full h-1 bg-white/10 rounded-full relative">
              <div
                className="h-full bg-brand group-hover:bg-brand-light rounded-full relative transition-all duration-75"
                style={{ width: `${progressPercent}%` }}
              >
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-md shadow-brand-glow"></div>
              </div>
            </div>
          </div>
          <span>
            {currentTrack ? formatTime(currentTrack.duration_secs) : "0:00"}
          </span>
        </div>
      </div>

      {/* Right: Audio Volume Controller & Now Playing Sidebar Toggle */}
      <div className="flex items-center justify-end gap-5 w-1/3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setVolume(volume === 0 ? 80 : 0)}
            className="text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
          >
            <Volume2 size={18} />
          </button>
          <div
            onMouseDown={handleVolumeMouseDown}
            className="w-24 h-4 flex items-center cursor-pointer relative group"
          >
            <div className="w-full h-1 bg-white/10 rounded-full relative">
              <div
                className="h-full bg-white/40 group-hover:bg-brand rounded-full transition-all duration-75"
                style={{ width: `${volume}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* Now Playing Right-Sidebar Toggle Button */}
        <button
          onClick={toggleDrawer}
          className={`p-2 rounded-lg border transition-all cursor-pointer ${
            isDrawerOpen
              ? "bg-brand/10 border-brand/20 text-brand-light shadow-inner shadow-brand-glow"
              : "bg-white/5 border-white/5 text-zinc-450 hover:text-zinc-200"
          }`}
          title="Toggle Now Playing view"
        >
          <PanelRight size={15} />
        </button>
      </div>
    </div>
  );
}

// Convert seconds to clean display format MM:SS
function formatTime(secs: number): string {
  if (!secs || isNaN(secs)) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}
