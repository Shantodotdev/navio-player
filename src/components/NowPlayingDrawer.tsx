import {
  Film,
  Captions,
  ChevronLeft,
  ChevronRight,
  FastForward,
  Languages,
  ListMusic,
  Maximize2,
  Music,
  MonitorPlay,
  Minimize2,
  Pause,
  Play,
  Rewind,
  Volume2,
  X,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import {
  buildStreamUrl,
  cancelMediaPreparation,
  createRequestId,
  findActiveSubtitle,
  isCopyCompatibleAudio,
  isTauri,
  MIN_RESUMABLE_VIDEO_DURATION_SECS,
  parseWebVtt,
  persistTheaterState,
  type SubtitleCue,
  type TheaterMediaInfo,
} from "../lib/theaterMedia";
import { type Track, usePlayerStore } from "../store/playerStore";
import {
  clampDrawerWidth,
  DEFAULT_DRAWER_WIDTH,
  DRAWER_WIDTH_STORAGE_KEY,
  getMaxDrawerWidth,
  getStoredDrawerWidth,
  MAX_DRAWER_WIDTH,
  MIN_DRAWER_WIDTH,
} from "../lib/nowPlayingDrawerSizing";

export function NowPlayingDrawer() {
  const navigate = useNavigate();
  const {
    currentTrack,
    playlist,
    isDrawerOpen,
    isTheaterOpen,
    isPlaying,
    setDrawerOpen,
    setTheaterOpen,
    playTrack,
    setMediaElement,
    clearMediaElement,
    setCurrentTime,
    setIsPlaying,
    nextTrack,
    prevTrack,
    currentTime,
    streamPort,
    streamToken,
    volume,
  } = usePlayerStore();

  const [drawerWidth, setDrawerWidth] = useState(DEFAULT_DRAWER_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [playbackError, setPlaybackError] = useState("");
  const [alternateAudioUrl, setAlternateAudioUrl] = useState<string | null>(
    null,
  );
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const alternateAudioRef = useRef<HTMLAudioElement>(null);
  const theaterRef = useRef<HTMLElement>(null);
  const consecutiveFailures = useRef(0);
  const activeAudioRequest = useRef<string | null>(null);
  const activeSubtitleRequest = useRef<string | null>(null);
  const subtitleCursor = useRef(-1);
  const latestPlaybackTime = useRef(0);
  const lastPlayerUpdate = useRef(0);
  const persistTimer = useRef<number | null>(null);

  const isVideo = currentTrack?.media_type === "video";
  const currentTrackPath = currentTrack?.path;
  const activeTrack: Track = currentTrack ?? {
    id: "",
    path: "",
    name: "",
    duration_secs: 0,
    media_type: "audio",
  };
  const activeQueue = currentTrack
    ? playlist.length > 0
      ? playlist
      : [currentTrack]
    : [];
  const duration = currentTrack?.duration_secs ?? 0;
  const activeSubtitle = findActiveSubtitle(
    subtitleCues,
    currentTime,
    subtitleCursor.current,
  );
  subtitleCursor.current = activeSubtitle.index;

  useEffect(() => {
    const media = videoRef.current;
    if (media) setMediaElement(media);
    return () => clearMediaElement(media);
  }, [clearMediaElement, setMediaElement]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncDrawerWidth = () => {
      setDrawerWidth((width) =>
        clampDrawerWidth(
          width || getStoredDrawerWidth(window.innerWidth),
          window.innerWidth,
        ),
      );
    };

    setDrawerWidth(getStoredDrawerWidth(window.innerWidth));
    window.addEventListener("resize", syncDrawerWidth);
    return () => window.removeEventListener("resize", syncDrawerWidth);
  }, []);

  useEffect(() => {
    setPlaybackError("");
  }, [currentTrack?.id]);

  useEffect(() => {
    let cancelled = false;
    const subtitleFetch = new AbortController();
    setAlternateAudioUrl(null);
    setSubtitleCues([]);
    subtitleCursor.current = -1;
    latestPlaybackTime.current = 0;
    activeAudioRequest.current = null;
    activeSubtitleRequest.current = null;

    if (!isVideo || !currentTrackPath || !isTauri) return;

    const loadSavedVideoState = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const info = await invoke<TheaterMediaInfo>("inspect_video_tracks", {
          path: currentTrackPath,
        });
        if (cancelled) return;

        const resumePosition =
          duration >= MIN_RESUMABLE_VIDEO_DURATION_SECS &&
          info.resume_position_secs >= 5 &&
          info.resume_position_secs < Math.max(duration - 15, 5)
            ? info.resume_position_secs
            : 0;
        latestPlaybackTime.current = resumePosition;
        if (resumePosition > 0 && videoRef.current) {
          videoRef.current.currentTime = resumePosition;
          setCurrentTime(resumePosition);
        }

        const defaultAudio =
          info.audio_tracks.find((track) => track.is_default) ??
          info.audio_tracks[0];
        const preferredAudio = info.audio_tracks.find(
          (track) => track.stream_index === info.preferred_audio_stream_index,
        );
        const audioTrack = preferredAudio ?? defaultAudio;
        const restoreAudio = async () => {
          if (
            !audioTrack ||
            !defaultAudio ||
            audioTrack.stream_index === defaultAudio.stream_index ||
            (!isCopyCompatibleAudio(audioTrack.codec) &&
              !info.cached_audio_stream_indexes.includes(
                audioTrack.stream_index,
              ))
          ) {
            return;
          }

          try {
            const requestId = createRequestId();
            activeAudioRequest.current = requestId;
            const audioPath = await invoke<string>("extract_audio_track", {
              path: currentTrackPath,
              streamIndex: audioTrack.stream_index,
              codec: audioTrack.codec,
              requestId,
            });
            if (!cancelled && activeAudioRequest.current === requestId) {
              setAlternateAudioUrl(
                buildStreamUrl(streamPort, streamToken, audioPath),
              );
            }
          } catch (error) {
            if (!cancelled) {
              console.warn("Loading saved sidebar audio failed:", error);
            }
          }
        };

        const subtitleTrack = info.subtitle_preference_set
          ? info.subtitle_tracks.find(
              (track) =>
                track.stream_index === info.preferred_subtitle_stream_index,
            )
          : info.subtitle_tracks.find((track) => track.is_default);
        const restoreSubtitles = async () => {
          if (!subtitleTrack || cancelled) return;

          try {
            const requestId = createRequestId();
            activeSubtitleRequest.current = requestId;
            const subtitlePath = await invoke<string>(
              "extract_subtitle_track",
              {
                path: currentTrackPath,
                streamIndex: subtitleTrack.stream_index,
                requestId,
              },
            );
            if (cancelled || activeSubtitleRequest.current !== requestId) {
              return;
            }

            const response = await fetch(
              buildStreamUrl(streamPort, streamToken, subtitlePath),
              { signal: subtitleFetch.signal },
            );
            if (!response.ok) {
              throw new Error(`Subtitle request failed: ${response.status}`);
            }
            const cues = parseWebVtt(await response.text());
            if (!cancelled) {
              subtitleCursor.current = -1;
              setSubtitleCues(cues);
            }
          } catch (error) {
            if (!cancelled && !subtitleFetch.signal.aborted) {
              console.warn("Loading saved sidebar subtitles failed:", error);
            }
          }
        };

        await Promise.all([restoreAudio(), restoreSubtitles()]);
      } catch (error) {
        if (!cancelled && !subtitleFetch.signal.aborted) {
          console.warn("Loading saved sidebar video state failed:", error);
        }
      }
    };

    void loadSavedVideoState();
    return () => {
      cancelled = true;
      subtitleFetch.abort();
      void cancelMediaPreparation(activeAudioRequest.current);
      void cancelMediaPreparation(activeSubtitleRequest.current);
    };
  }, [
    currentTrackPath,
    duration,
    isVideo,
    setCurrentTime,
    streamPort,
    streamToken,
  ]);

  useEffect(() => {
    const video = videoRef.current;
    const alternateAudio = alternateAudioRef.current;
    if (!video || !alternateAudio) return;

    video.muted = Boolean(alternateAudioUrl);
    alternateAudio.volume = volume / 100;
    if (!alternateAudioUrl) {
      alternateAudio.pause();
      alternateAudio.removeAttribute("src");
      alternateAudio.load();
      return;
    }

    if (alternateAudio.src !== alternateAudioUrl) {
      alternateAudio.src = alternateAudioUrl;
      alternateAudio.load();
    }

    const synchronize = () => {
      if (Math.abs(alternateAudio.currentTime - video.currentTime) > 0.5) {
        alternateAudio.currentTime = video.currentTime;
      }
      if (isPlaying) {
        void alternateAudio
          .play()
          .catch((error) =>
            console.warn("Sidebar alternate audio playback failed:", error),
          );
      } else {
        alternateAudio.pause();
      }
    };

    if (alternateAudio.readyState >= HTMLMediaElement.HAVE_METADATA) {
      synchronize();
    } else {
      alternateAudio.addEventListener("loadedmetadata", synchronize, {
        once: true,
      });
    }
    return () =>
      alternateAudio.removeEventListener("loadedmetadata", synchronize);
  }, [alternateAudioUrl, isPlaying, volume]);

  useEffect(() => {
    const path = currentTrackPath;
    return () => {
      if (persistTimer.current !== null) {
        window.clearTimeout(persistTimer.current);
        persistTimer.current = null;
      }
      if (
        path &&
        duration >= MIN_RESUMABLE_VIDEO_DURATION_SECS &&
        latestPlaybackTime.current > 0
      ) {
        void persistTheaterState({
          path,
          durationSecs: duration,
          positionSecs: latestPlaybackTime.current,
          savePreferences: false,
        });
      }
    };
  }, [currentTrackPath, duration]);

  const updateDrawerWidth = (nextWidth: number) => {
    const clampedWidth = clampDrawerWidth(nextWidth, window.innerWidth);
    setDrawerWidth(clampedWidth);
    window.localStorage.setItem(DRAWER_WIDTH_STORAGE_KEY, String(clampedWidth));
  };

  const handleResizePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizing(true);
  };

  const handleResizePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (isResizing) updateDrawerWidth(window.innerWidth - event.clientX);
  };

  const stopResizing = () => setIsResizing(false);

  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      updateDrawerWidth(drawerWidth + 20);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      updateDrawerWidth(drawerWidth - 20);
    }
  };

  const handleMediaError = () => {
    if (!currentTrack) return;

    console.warn("Playback failed for file path:", currentTrack.path);
    setPlaybackError(
      "This media could not be played. Moving to the next item.",
    );
    consecutiveFailures.current += 1;

    if (consecutiveFailures.current >= activeQueue.length) {
      setIsPlaying(false);
      consecutiveFailures.current = 0;
      return;
    }

    nextTrack();
  };

  const enterFullscreen = useCallback(() => {
    const target = isTheaterOpen ? theaterRef.current : videoRef.current;
    void target?.requestFullscreen().catch(() => undefined);
  }, [isTheaterOpen]);

  const openWatch = () => {
    if (!isVideo) return;
    setTheaterOpen(true);
    void navigate({ to: "/watch" });
  };

  useEffect(() => {
    if (!isTheaterOpen) return;

    const handleKeyboard = (event: globalThis.KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      const media = videoRef.current;
      if (!media) return;

      const seek = (seconds: number) => {
        const nextTime = Math.max(
          0,
          Math.min(media.duration || 0, media.currentTime + seconds),
        );
        media.currentTime = nextTime;
        setCurrentTime(nextTime);
      };

      if (event.key === " " || event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsPlaying(!isPlaying);
      } else if (event.key === "ArrowLeft" || event.key.toLowerCase() === "j") {
        event.preventDefault();
        seek(-10);
      } else if (
        event.key === "ArrowRight" ||
        event.key.toLowerCase() === "l"
      ) {
        event.preventDefault();
        seek(10);
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        enterFullscreen();
      } else if (event.key === "Escape") {
        if (document.fullscreenElement) {
          void document.exitFullscreen();
        } else {
          setTheaterOpen(false);
        }
      }
    };

    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [
    enterFullscreen,
    isPlaying,
    isTheaterOpen,
    setCurrentTime,
    setIsPlaying,
    setTheaterOpen,
  ]);

  const mediaPlayer = (
    <video
      ref={videoRef}
      className={
        isVideo
          ? `absolute inset-0 w-full h-full object-contain ${
              isTheaterOpen ? "z-20" : ""
            }`
          : "hidden"
      }
      onTimeUpdate={(event) => {
        const playbackTime = event.currentTarget.currentTime;
        const alternateAudio = alternateAudioRef.current;
        if (
          alternateAudioUrl &&
          alternateAudio &&
          Math.abs(alternateAudio.currentTime - playbackTime) > 0.5
        ) {
          alternateAudio.currentTime = playbackTime;
        }

        latestPlaybackTime.current = playbackTime;
        const now = performance.now();
        if (now - lastPlayerUpdate.current >= 250) {
          lastPlayerUpdate.current = now;
          setCurrentTime(playbackTime);
        }

        if (
          currentTrack &&
          duration >= MIN_RESUMABLE_VIDEO_DURATION_SECS &&
          persistTimer.current === null
        ) {
          persistTimer.current = window.setTimeout(() => {
            persistTimer.current = null;
            void persistTheaterState({
              path: currentTrack.path,
              durationSecs: duration,
              positionSecs: latestPlaybackTime.current,
              savePreferences: false,
            });
          }, 5_000);
        }
      }}
      onPlay={() => {
        setIsPlaying(true);
        consecutiveFailures.current = 0;
      }}
      onPause={() => {
        alternateAudioRef.current?.pause();
        setIsPlaying(false);
        if (currentTrack && duration >= MIN_RESUMABLE_VIDEO_DURATION_SECS) {
          void persistTheaterState({
            path: currentTrack.path,
            durationSecs: duration,
            positionSecs: latestPlaybackTime.current,
            savePreferences: false,
          });
        }
      }}
      onEnded={() => {
        if (currentTrack && duration >= MIN_RESUMABLE_VIDEO_DURATION_SECS) {
          void persistTheaterState({
            path: currentTrack.path,
            durationSecs: duration,
            positionSecs: 0,
            savePreferences: false,
          });
        }
        nextTrack();
      }}
      onError={handleMediaError}
    />
  );

  return (
    <aside
      ref={theaterRef}
      className={
        isTheaterOpen
          ? "fixed inset-0 z-70 flex h-screen w-screen flex-col overflow-hidden bg-black"
          : `absolute top-0 right-0 h-full bg-[#07070a]/98 backdrop-blur-3xl border-l border-white/5 shadow-[-15px_0_30px_-10px_rgba(0,0,0,0.8)] z-45 flex flex-col transition-transform duration-300 ease-out ${
              isDrawerOpen ? "translate-x-0" : "translate-x-full"
            } ${isResizing ? "select-none" : ""}`
      }
      style={isTheaterOpen ? undefined : { width: drawerWidth }}
      aria-label="Now playing"
    >
      {!isTheaterOpen && (
        <div
          role="separator"
          aria-label="Resize now playing"
          aria-orientation="vertical"
          aria-valuemin={MIN_DRAWER_WIDTH}
          aria-valuemax={
            typeof window === "undefined"
              ? MAX_DRAWER_WIDTH
              : getMaxDrawerWidth(window.innerWidth)
          }
          aria-valuenow={drawerWidth}
          tabIndex={0}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={stopResizing}
          onPointerCancel={stopResizing}
          onKeyDown={handleResizeKeyDown}
          className="absolute left-0 top-0 z-30 h-full w-2 -translate-x-1 cursor-ew-resize touch-none outline-none before:absolute before:inset-y-0 before:left-1/2 before:w-px before:bg-transparent hover:before:bg-brand/70 focus-visible:before:bg-brand"
        />
      )}

      <header
        className={
          isTheaterOpen
            ? "hidden"
            : "flex items-center justify-between p-5 border-b border-white/5 shrink-0"
        }
      >
        <div>
          <span className="text-sm font-medium text-brand-light">
            Now playing
          </span>
          {currentTrack && (
            <p className="text-xs text-zinc-500 mt-0.5 capitalize">
              {currentTrack.media_type}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setDrawerOpen(false)}
          aria-label="Close now playing"
          className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
        >
          <X size={15} />
        </button>
      </header>

      <div
        className={`${
          isTheaterOpen
            ? "absolute inset-0 min-h-0"
            : "flex-1 min-h-0 flex flex-col gap-6 p-5"
        } ${currentTrack ? "" : "hidden"}`}
      >
        <div
          className={
            isTheaterOpen ? "absolute inset-0" : "space-y-4 min-w-0 shrink-0"
          }
        >
          <div
            onDoubleClick={openWatch}
            className={`relative overflow-hidden group ${
              isTheaterOpen
                ? "absolute inset-0 z-10 bg-black"
                : isVideo
                  ? "aspect-video rounded-xl border border-white/5 shadow-lg bg-black"
                  : "aspect-video rounded-xl border border-white/5 shadow-lg bg-card-bg"
            }`}
          >
            {!isTheaterOpen && (
              <div className="absolute inset-0 bg-linear-to-tr from-brand-glow to-transparent z-10 mix-blend-color-dodge pointer-events-none" />
            )}
            {mediaPlayer}
            <audio ref={alternateAudioRef} className="hidden" />

            {isVideo && activeSubtitle.text && (
              <div
                className={`pointer-events-none absolute inset-x-4 z-30 flex justify-center text-center ${
                  isTheaterOpen ? "bottom-32" : "bottom-4"
                }`}
              >
                <p
                  className={`max-w-4xl whitespace-pre-line rounded-md bg-black/75 px-3 py-1.5 font-medium leading-snug text-white shadow-lg ${
                    isTheaterOpen ? "text-xl" : "text-sm"
                  }`}
                >
                  {activeSubtitle.text}
                </p>
              </div>
            )}

            {!isVideo && <AudioOrbit />}

            {isVideo && !isTheaterOpen && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/10 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    aria-label={isPlaying ? "Pause video" : "Play video"}
                    onClick={() => setIsPlaying(!isPlaying)}
                    className="w-12 h-12 rounded-full bg-black/65 hover:bg-brand text-white grid place-items-center border border-white/15 transition-colors cursor-pointer"
                  >
                    {isPlaying ? (
                      <Pause size={19} fill="currentColor" />
                    ) : (
                      <Play
                        size={19}
                        fill="currentColor"
                        className="translate-x-px"
                      />
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label="Open theater mode"
                    onClick={openWatch}
                    className="w-10 h-10 rounded-full bg-black/65 hover:bg-white/20 text-white grid place-items-center border border-white/15 transition-colors cursor-pointer"
                  >
                    <MonitorPlay size={17} />
                  </button>
                </div>
              </div>
            )}

            {isTheaterOpen && (
              <TheaterControls
                videoRef={videoRef}
                currentTime={currentTime}
                duration={currentTrack?.duration_secs ?? 0}
                isPlaying={isPlaying}
                onExit={() => setTheaterOpen(false)}
                onFullscreen={enterFullscreen}
                onPlayPause={() => setIsPlaying(!isPlaying)}
                onNext={nextTrack}
                onPrevious={prevTrack}
                onSeek={(seconds) => {
                  const media = videoRef.current;
                  if (!media) return;
                  const nextTime = Math.max(
                    0,
                    Math.min(media.duration || 0, media.currentTime + seconds),
                  );
                  media.currentTime = nextTime;
                  setCurrentTime(nextTime);
                }}
              />
            )}
          </div>

          <div className={isTheaterOpen ? "hidden" : "space-y-1 px-1"}>
            <h2 className="text-xl font-medium text-zinc-100 truncate">
              {activeTrack.title || activeTrack.name}
            </h2>
            <p className="text-sm text-zinc-400 capitalize">
              {activeTrack.media_type}
            </p>
            {playbackError && (
              <p role="alert" className="text-xs text-red-300 pt-1">
                {playbackError}
              </p>
            )}
          </div>
        </div>

        {!isTheaterOpen && (
          <Queue
            tracks={activeQueue}
            currentTrackId={activeTrack.id}
            onSelect={playTrack}
          />
        )}
      </div>

      {!currentTrack && (
        <div className="flex-1 grid place-items-center p-8 text-center">
          <div className="max-w-xs space-y-4">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-brand/10 border border-brand/20 text-brand-light grid place-items-center">
              <Music size={28} className="text-emerald-400" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-lg font-medium text-zinc-200">
                Nothing playing
              </h2>
              <p className="text-sm leading-relaxed text-zinc-500">
                Choose an item from your library to start playback.
              </p>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

function Queue({
  tracks,
  currentTrackId,
  onSelect,
}: {
  tracks: Track[];
  currentTrackId: string;
  onSelect: (track: Track, queue: Track[]) => void;
}) {
  if (tracks.length === 0) return null;

  return (
    <section className="flex-1 min-h-0 flex flex-col gap-3 pt-5 border-t border-white/5">
      <div className="flex items-center gap-2 text-sm font-medium text-zinc-400">
        <ListMusic size={16} className="text-brand-light" />
        <span>Up next</span>
      </div>
      <div className="flex-1 min-h-0 space-y-1.5 overflow-y-auto pr-1">
        {tracks.map((track) => {
          const isCurrent = currentTrackId === track.id;

          return (
            <button
              key={track.id}
              type="button"
              onClick={() => onSelect(track, tracks)}
              className={`w-full flex items-center gap-3 p-2.5 rounded-lg text-left border transition-all duration-150 group cursor-pointer ${
                isCurrent
                  ? "bg-brand/10 border-brand/20 text-brand-light font-medium"
                  : "bg-transparent border-transparent hover:bg-white/5 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <div className="w-9 h-9 rounded bg-white/5 flex items-center justify-center shrink-0">
                {track.media_type === "video" ? (
                  <Film size={13} className="text-purple-400" />
                ) : (
                  <Music size={13} className="text-emerald-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <span className="block text-sm truncate">
                  {track.title || track.name}
                </span>
                <span className="block text-xs text-zinc-500 truncate mt-0.5 capitalize">
                  {track.media_type}
                </span>
              </div>
              <span className="text-xs text-zinc-500 font-medium">
                {formatTime(track.duration_secs)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function AudioOrbit() {
  return (
    <div className="absolute inset-0 z-20 grid place-items-center overflow-hidden bg-linear-to-br from-[#100711] via-[#0b0b16] to-[#06121a]">
      <div className="relative w-40 aspect-square">
        <div className="absolute inset-0 rounded-full border border-brand/35 border-t-brand-light animate-spin-slow">
          <span className="absolute -top-1 left-1/2 w-2.5 h-2.5 rounded-full bg-brand-light shadow-[0_0_12px_rgba(199,44,78,0.9)]" />
        </div>
        <div className="absolute inset-5 rounded-full border border-white/10 border-b-brand/40 animate-[spin_8s_linear_infinite_reverse]" />
        <div className="absolute inset-11 rounded-full bg-brand/15 border border-brand/30 shadow-[0_0_38px_rgba(168,28,60,0.3)] grid place-items-center text-brand-light">
          <Music size={30} className="text-emerald-400" />
        </div>
      </div>
    </div>
  );
}

function TheaterControls({
  videoRef,
  currentTime,
  duration,
  isPlaying,
  onExit,
  onFullscreen,
  onPlayPause,
  onNext,
  onPrevious,
  onSeek,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onExit: () => void;
  onFullscreen: () => void;
  onPlayPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (seconds: number) => void;
}) {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-between bg-linear-to-b from-black/65 via-transparent to-black/80 px-10 py-8 opacity-100 transition-opacity duration-300">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onExit}
          className="flex items-center gap-2 rounded-lg bg-black/45 px-3 py-2 text-sm text-white hover:bg-white/15 transition-colors cursor-pointer"
        >
          <Minimize2 size={17} />
          Exit theater
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            title="Subtitles are loaded when available"
            className="p-2.5 rounded-full bg-black/45 text-white/60 hover:text-white hover:bg-white/15 transition-colors cursor-pointer"
          >
            <Captions size={18} />
          </button>
          <button
            type="button"
            title="Audio languages are loaded when available"
            className="p-2.5 rounded-full bg-black/45 text-white/60 hover:text-white hover:bg-white/15 transition-colors cursor-pointer"
          >
            <Languages size={18} />
          </button>
        </div>
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
          }}
          aria-label="Seek video"
          className="w-full accent-brand cursor-pointer"
          style={{ backgroundSize: `${progress}% 100%` }}
        />
        <div className="flex items-center justify-between text-white">
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={onPrevious}
              aria-label="Previous video"
              className="hover:text-brand-light transition-colors cursor-pointer"
            >
              <ChevronLeft size={24} />
            </button>
            <button
              type="button"
              onClick={() => onSeek(-10)}
              aria-label="Rewind 10 seconds"
              className="hover:text-brand-light transition-colors cursor-pointer"
            >
              <Rewind size={23} />
            </button>
            <button
              type="button"
              onClick={onPlayPause}
              aria-label={isPlaying ? "Pause video" : "Play video"}
              className="w-12 h-12 rounded-full bg-white text-black grid place-items-center hover:bg-brand-light hover:text-white transition-colors cursor-pointer"
            >
              {isPlaying ? (
                <Pause size={20} fill="currentColor" />
              ) : (
                <Play
                  size={20}
                  fill="currentColor"
                  className="translate-x-px"
                />
              )}
            </button>
            <button
              type="button"
              onClick={() => onSeek(10)}
              aria-label="Forward 10 seconds"
              className="hover:text-brand-light transition-colors cursor-pointer"
            >
              <FastForward size={23} />
            </button>
            <button
              type="button"
              onClick={onNext}
              aria-label="Next video"
              className="hover:text-brand-light transition-colors cursor-pointer"
            >
              <ChevronRight size={24} />
            </button>
          </div>
          <div className="flex items-center gap-4">
            <Volume2 size={18} />
            <button
              type="button"
              onClick={onFullscreen}
              aria-label="Enter fullscreen"
              className="hover:text-brand-light transition-colors cursor-pointer"
            >
              <Maximize2 size={20} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatTime(secs: number): string {
  if (!secs || Number.isNaN(secs)) return "0:00";
  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const seconds = Math.floor(secs % 60);
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
}
