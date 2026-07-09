import { X, Music, Play, ListMusic } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePlayerStore } from "../store/playerStore";
import type { Track } from "../store/playerStore";

export function NowPlayingDrawer() {
  const {
    currentTrack,
    playlist,
    isDrawerOpen,
    setDrawerOpen,
    playTrack,
    setMediaElement,
    setCurrentTime,
    setIsPlaying,
    nextTrack,
  } = usePlayerStore();

  const [coverUrl, setCoverUrl] = useState<string>("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const consecutiveFailures = useRef(0);

  // Define some default tracks in case the active play queue is empty
  const mockQueue: Track[] = [
    {
      id: "mock-1",
      name: "Lost in the Echo.mp3",
      path: "",
      title: "Lost in the Echo",
      artist: "Linkin Park",
      album: "Living Things",
      duration_secs: 205,
      media_type: "audio",
    },
    {
      id: "mock-2",
      name: "Starlight.mp3",
      path: "",
      title: "Starlight",
      artist: "Muse",
      album: "Black Holes and Revelations",
      duration_secs: 240,
      media_type: "audio",
    },
  ];

  const activeTrack = currentTrack || mockQueue[0];
  const activeQueue = playlist.length > 0 ? playlist : mockQueue;

  // Sync the HTML5 video element ref with Zustand store for global playback actions
  useEffect(() => {
    if (videoRef.current) {
      setMediaElement(videoRef.current);
    }
    return () => {
      setMediaElement(null);
    };
  }, [setMediaElement]);

  // Safely resolve local cached cover art files using Tauri convertFileSrc (prevents SSR errors)
  useEffect(() => {
    if (activeTrack && activeTrack.cover_cache_path) {
      const convertCachePath = async () => {
        try {
          const { convertFileSrc } = await import("@tauri-apps/api/core");
          setCoverUrl(convertFileSrc(activeTrack.cover_cache_path!));
        } catch (err) {
          console.warn("Tauri convertFileSrc asset resolution failed:", err);
          setCoverUrl("");
        }
      };
      convertCachePath();
    } else {
      setCoverUrl("");
    }
  }, [activeTrack]);

  return (
    <div
      className={`absolute top-0 right-0 h-full w-96 bg-[#07070a]/98 backdrop-blur-3xl border-l border-white/5 shadow-[-15px_0_30px_-10px_rgba(0,0,0,0.8)] z-45 flex flex-col transition-transform duration-300 ease-out transform ${
        isDrawerOpen ? "translate-x-0" : "translate-x-full"
      }`}
    >
      {/* Drawer Header */}
      <div className="flex items-center justify-between p-5 border-b border-white/5 shrink-0">
        <span className="text-sm font-medium text-brand-light">
          Now playing
        </span>
        <button
          onClick={() => setDrawerOpen(false)}
          className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
        >
          <X size={15} />
        </button>
      </div>

      {/* Scrollable Content Container */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {/* Top Part: Large Cover Art & Details */}
        <div className="space-y-4">
          <div className="w-full aspect-square rounded-xl bg-card-bg border border-white/5 flex items-center justify-center shadow-lg overflow-hidden relative group">
            <div className="absolute inset-0 bg-linear-to-tr from-brand-glow to-transparent z-10 mix-blend-color-dodge pointer-events-none"></div>

            {/* Core Background Player Tag */}
            <video
              ref={videoRef}
              className={`w-full h-full object-cover z-20 ${
                activeTrack.media_type === "video" ? "block" : "hidden"
              }`}
              onTimeUpdate={(e) => {
                setCurrentTime(e.currentTarget.currentTime);
              }}
              onPlay={() => {
                setIsPlaying(true);
                consecutiveFailures.current = 0;
              }}
              onPause={() => setIsPlaying(false)}
              onEnded={nextTrack}
              onError={() => {
                console.warn(
                  "Playback failed for file path:",
                  activeTrack.path,
                  ". Auto-skipping...",
                );
                consecutiveFailures.current += 1;
                if (consecutiveFailures.current >= activeQueue.length) {
                  console.warn(
                    "All tracks in queue failed to play. Stopping playback.",
                  );
                  setIsPlaying(false);
                  consecutiveFailures.current = 0;
                } else {
                  nextTrack();
                }
              }}
            />

            {/* Audio Art Elements (shown only when playing audio) */}
            {activeTrack.media_type === "audio" && (
              <>
                {coverUrl ? (
                  <img
                    src={coverUrl}
                    alt={activeTrack.title || activeTrack.name}
                    className="absolute inset-0 w-full h-full object-cover z-20 pointer-events-none"
                  />
                ) : (
                  // Spinning vinyl disc fallback when cover art is missing
                  <div className="absolute w-72 h-72 rounded-full border border-black/40 bg-zinc-950 flex items-center justify-center shadow-2xl animate-spin-slow">
                    <div className="w-28 h-28 rounded-full border border-white/5 bg-zinc-900 flex items-center justify-center">
                      <div className="w-8 h-8 rounded-full bg-brand"></div>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Video overlay controls indicator */}
            {activeTrack.media_type === "video" && (
              <div className="absolute inset-0 bg-black/20 z-10 flex items-center justify-center pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                <Play size={26} className="text-zinc-200" fill="currentColor" />
              </div>
            )}
          </div>

          <div className="space-y-1 px-1">
            <h3 className="text-lg font-medium text-zinc-200 truncate">
              {activeTrack.title || activeTrack.name}
            </h3>
            <p className="text-sm text-zinc-400 truncate font-medium">
              {activeTrack.artist || "Unknown Artist"}{" "}
              <span className="text-zinc-700 px-1.5">•</span>{" "}
              <span className="text-zinc-500">
                {activeTrack.album || "Unknown Album"}
              </span>
            </p>
          </div>
        </div>

        {/* Bottom Part: Playlist Queue */}
        <div className="space-y-3 pt-4 border-t border-white/5">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-400">
            <ListMusic size={16} className="text-brand-light" />
            <span>Up next</span>
          </div>

          {/* Queue List */}
          <div className="space-y-1.5">
            {activeQueue.map((track) => {
              const isCurrent = activeTrack.id === track.id;

              return (
                <div
                  key={track.id}
                  onClick={() => playTrack(track, activeQueue)}
                  className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer border transition-all duration-150 group ${
                    isCurrent
                      ? "bg-brand/10 border-brand/20 text-brand-light font-medium"
                      : "bg-transparent border-transparent hover:bg-white/5 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <div className="w-9 h-9 rounded bg-white/5 flex items-center justify-center shrink-0 relative overflow-hidden">
                    <Music
                      size={13}
                      className="text-zinc-400 group-hover:opacity-0"
                    />
                    <div className="absolute inset-0 bg-brand opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <Play
                        size={10}
                        fill="currentColor"
                        className="text-zinc-200"
                      />
                    </div>
                  </div>

                  <div className="flex-1 flex flex-col min-w-0">
                    <span className="text-xs truncate">
                      {track.title || track.name}
                    </span>
                    <span className="text-3xs text-zinc-500 truncate mt-0.5">
                      {track.artist || "Unknown Artist"}
                    </span>
                  </div>

                  <span className="text-xs text-zinc-500 font-medium">
                    {formatTime(track.duration_secs)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatTime(secs: number): string {
  if (!secs || isNaN(secs)) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}
