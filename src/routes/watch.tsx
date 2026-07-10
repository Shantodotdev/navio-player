import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Captions,
  ChevronLeft,
  ChevronRight,
  FastForward,
  Languages,
  Pause,
  Play,
  Rewind,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
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
  type EmbeddedTrack,
  type SubtitleCue,
  type TheaterMediaInfo,
  type VideoTrackInfo,
} from "../lib/theaterMedia";
import { usePlayerStore } from "../store/playerStore";

const emptyTrackInfo: VideoTrackInfo = {
  audio_tracks: [],
  subtitle_tracks: [],
};

export const Route = createFileRoute("/watch")({
  component: WatchView,
});

function WatchView() {
  const navigate = useNavigate();
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const alternateAudioRef = useRef<HTMLAudioElement>(null);
  const hideControlsTimer = useRef<number | null>(null);
  const activeAudioRequest = useRef<string | null>(null);
  const activeSubtitleRequest = useRef<string | null>(null);
  const lastPlayerUpdate = useRef(0);
  const latestPlaybackTime = useRef(0);
  const persistTimer = useRef<number | null>(null);
  const subtitleCursor = useRef(-1);
  const [showControls, setShowControls] = useState(true);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const [trackInfo, setTrackInfo] = useState<VideoTrackInfo>(emptyTrackInfo);
  const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null);
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
  const [selectedSubtitle, setSelectedSubtitle] = useState<number | null>(null);
  const [selectedAudio, setSelectedAudio] = useState<number | null>(null);
  const [alternateAudioUrl, setAlternateAudioUrl] = useState<string | null>(
    null,
  );
  const [isPreparingAudio, setIsPreparingAudio] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<"audio" | "subtitles" | null>(null);
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [subtitleError, setSubtitleError] = useState<string | null>(null);
  const [dismissNextUp, setDismissNextUp] = useState(false);
  const menuCloseTimer = useRef<number | null>(null);

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
    playlist,
    playIndex,
    streamPort,
    streamToken,
  } = usePlayerStore();

  const isVideo = currentTrack?.media_type === "video";
  const duration = currentTrack?.duration_secs ?? 0;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const nextUp =
    playlist.length > 1 && playIndex >= 0
      ? playlist[(playIndex + 1) % playlist.length]
      : null;
  const isNearEnd = duration > 0 && currentTime >= Math.max(duration - 30, 15);
  const activeSubtitle = findActiveSubtitle(
    subtitleCues,
    currentTime,
    subtitleCursor.current,
  );
  subtitleCursor.current = activeSubtitle.index;
  const activeSubtitleText = activeSubtitle.text;

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
    let cancelled = false;
    setTrackInfo(emptyTrackInfo);
    setSubtitleUrl(null);
    setSubtitleCues([]);
    setSelectedSubtitle(null);
    setSelectedAudio(null);
    setAlternateAudioUrl(null);
    setIsPreparingAudio(false);
    setAudioError(null);
    setSubtitleError(null);
    setDismissNextUp(false);
    subtitleCursor.current = -1;
    latestPlaybackTime.current = 0;

    if (!isVideo || !currentTrack || !isTauri) return;

    const loadMediaState = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const info = await invoke<TheaterMediaInfo>("inspect_video_tracks", {
          path: currentTrack.path,
        });
        if (cancelled) return;
        setTrackInfo(info);

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
          (track) =>
            track.stream_index === info.preferred_audio_stream_index,
        );
        const audioTrack = preferredAudio ?? defaultAudio;
        setSelectedAudio(audioTrack?.stream_index ?? null);

        if (
          audioTrack &&
          defaultAudio &&
          audioTrack.stream_index !== defaultAudio.stream_index &&
          (isCopyCompatibleAudio(audioTrack.codec) ||
            info.cached_audio_stream_indexes.includes(audioTrack.stream_index))
        ) {
          const requestId = createRequestId();
          activeAudioRequest.current = requestId;
          setIsPreparingAudio(true);
          try {
            const audioPath = await invoke<string>("extract_audio_track", {
              path: currentTrack.path,
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
              console.warn("Preferred audio preparation failed:", error);
              setSelectedAudio(defaultAudio.stream_index);
            }
          } finally {
            if (!cancelled && activeAudioRequest.current === requestId) {
              setIsPreparingAudio(false);
            }
          }
        } else if (preferredAudio && audioTrack !== defaultAudio) {
          setSelectedAudio(defaultAudio?.stream_index ?? null);
        }

        const subtitleTrack = info.subtitle_preference_set
          ? info.subtitle_tracks.find(
              (track) =>
                track.stream_index === info.preferred_subtitle_stream_index,
            )
          : info.subtitle_tracks.find((track) => track.is_default);
        if (!subtitleTrack) return;

        const requestId = createRequestId();
        activeSubtitleRequest.current = requestId;
        setSelectedSubtitle(subtitleTrack.stream_index);
        try {
          const subtitlePath = await invoke<string>("extract_subtitle_track", {
            path: currentTrack.path,
            streamIndex: subtitleTrack.stream_index,
            requestId,
          });
          if (!cancelled && activeSubtitleRequest.current === requestId) {
            setSubtitleUrl(
              buildStreamUrl(streamPort, streamToken, subtitlePath),
            );
          }
        } catch (error) {
          if (!cancelled) {
            console.warn("Preferred subtitle extraction failed:", error);
          }
        }
      } catch (error) {
        if (!cancelled) console.warn("Video track inspection failed:", error);
      }
    };

    void loadMediaState();

    return () => {
      cancelled = true;
      void cancelMediaPreparation(activeAudioRequest.current);
      void cancelMediaPreparation(activeSubtitleRequest.current);
    };
  }, [
    currentTrack,
    duration,
    isVideo,
    setCurrentTime,
    streamPort,
    streamToken,
  ]);

  useEffect(() => {
    if (!subtitleUrl) {
      setSubtitleCues([]);
      subtitleCursor.current = -1;
      return;
    }

    const controller = new AbortController();
    void fetch(subtitleUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok)
          throw new Error(`Subtitle request failed: ${response.status}`);
        return response.text();
      })
      .then((vtt) => {
        subtitleCursor.current = -1;
        setSubtitleCues(parseWebVtt(vtt));
      })
      .catch((error) => {
        if (error.name === "AbortError") return;
        console.warn("Subtitle loading failed:", error);
        setSubtitleError("Could not load that subtitle track.");
      });

    return () => controller.abort();
  }, [subtitleUrl]);

  useEffect(() => {
    const path = currentTrack?.path;
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
  }, [currentTrack?.path, duration]);

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
            console.warn("Alternate audio playback failed:", error),
          );
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

  const showTrackMenu = (menu: "audio" | "subtitles") => {
    if (menuCloseTimer.current) window.clearTimeout(menuCloseTimer.current);
    setOpenMenu(menu);
    setIsMenuVisible(false);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setIsMenuVisible(true));
    });
  };

  const hideTrackMenu = () => {
    setIsMenuVisible(false);
    menuCloseTimer.current = window.setTimeout(() => setOpenMenu(null), 180);
  };

  const togglePlayback = () => {
    const media = videoRef.current;
    if (!media) return;

    if (media.paused) {
      void media.play().catch((error) => console.warn("Play failed:", error));
    } else {
      media.pause();
    }
  };

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
    if (alternateAudioRef.current)
      alternateAudioRef.current.currentTime = nextTime;
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

  const chooseSubtitle = async (track: EmbeddedTrack | null) => {
    setOpenMenu(null);
    setSubtitleError(null);
    await cancelMediaPreparation(activeSubtitleRequest.current);

    if (!track) {
      activeSubtitleRequest.current = null;
      setSelectedSubtitle(null);
      setSubtitleUrl(null);
      setSubtitleCues([]);
      if (currentTrack) {
        void persistTheaterState({
          path: currentTrack.path,
          durationSecs: duration,
          positionSecs: latestPlaybackTime.current,
          audioStreamIndex: selectedAudio,
          subtitleStreamIndex: null,
          subtitleEnabled: false,
          savePreferences: true,
        });
      }
      return;
    }

    if (!currentTrack || !isTauri) return;
    const requestId = createRequestId();
    activeSubtitleRequest.current = requestId;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const subtitlePath = await invoke<string>("extract_subtitle_track", {
        path: currentTrack.path,
        streamIndex: track.stream_index,
        requestId,
      });
      if (activeSubtitleRequest.current !== requestId) return;
      setSelectedSubtitle(track.stream_index);
      setSubtitleUrl(buildStreamUrl(streamPort, streamToken, subtitlePath));
      void persistTheaterState({
        path: currentTrack.path,
        durationSecs: duration,
        positionSecs: latestPlaybackTime.current,
        audioStreamIndex: selectedAudio,
        subtitleStreamIndex: track.stream_index,
        subtitleEnabled: true,
        savePreferences: true,
      });
    } catch (error) {
      if (activeSubtitleRequest.current !== requestId) return;
      console.warn("Subtitle extraction failed:", error);
      setSubtitleError("That subtitle track is not supported.");
    }
  };

  const chooseAudio = async (track: EmbeddedTrack) => {
    setOpenMenu(null);
    setAudioError(null);
    await cancelMediaPreparation(activeAudioRequest.current);
    activeAudioRequest.current = null;

    const defaultTrack =
      trackInfo.audio_tracks.find((candidate) => candidate.is_default) ??
      trackInfo.audio_tracks[0];
    if (!currentTrack || !defaultTrack) return;

    if (track.stream_index === defaultTrack.stream_index) {
      setSelectedAudio(track.stream_index);
      setAlternateAudioUrl(null);
      void persistTheaterState({
        path: currentTrack.path,
        durationSecs: duration,
        positionSecs: latestPlaybackTime.current,
        audioStreamIndex: track.stream_index,
        subtitleStreamIndex: selectedSubtitle,
        subtitleEnabled: selectedSubtitle !== null,
        savePreferences: true,
      });
      return;
    }

    const requestId = createRequestId();
    activeAudioRequest.current = requestId;
    try {
      setIsPreparingAudio(true);
      const { invoke } = await import("@tauri-apps/api/core");
      const audioPath = await invoke<string>("extract_audio_track", {
        path: currentTrack.path,
        streamIndex: track.stream_index,
        codec: track.codec,
        requestId,
      });
      if (activeAudioRequest.current !== requestId) return;
      setSelectedAudio(track.stream_index);
      setAlternateAudioUrl(buildStreamUrl(streamPort, streamToken, audioPath));
      void persistTheaterState({
        path: currentTrack.path,
        durationSecs: duration,
        positionSecs: latestPlaybackTime.current,
        audioStreamIndex: track.stream_index,
        subtitleStreamIndex: selectedSubtitle,
        subtitleEnabled: selectedSubtitle !== null,
        savePreferences: true,
      });
    } catch (error) {
      if (activeAudioRequest.current !== requestId) return;
      console.warn("Audio track preparation failed:", error);
      setAudioError("That audio track could not be prepared.");
    } finally {
      if (activeAudioRequest.current === requestId) {
        setIsPreparingAudio(false);
      }
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
        onClick={togglePlayback}
        onDoubleClick={() => void toggleFullscreen()}
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
        onPlay={() => setIsPlaying(true)}
        onPause={() => {
          alternateAudioRef.current?.pause();
          setIsPlaying(false);
          if (duration >= MIN_RESUMABLE_VIDEO_DURATION_SECS) {
            void persistTheaterState({
              path: currentTrack.path,
              durationSecs: duration,
              positionSecs: latestPlaybackTime.current,
              savePreferences: false,
            });
          }
        }}
        onEnded={() => {
          if (duration >= MIN_RESUMABLE_VIDEO_DURATION_SECS) {
            void persistTheaterState({
              path: currentTrack.path,
              durationSecs: duration,
              positionSecs: 0,
              savePreferences: false,
            });
          }
          nextTrack();
        }}
      />
      <audio ref={alternateAudioRef} className="hidden" />

      <div
        className="absolute inset-0 z-10"
        onClick={togglePlayback}
        onDoubleClick={() => void toggleFullscreen()}
        aria-label="Toggle video playback"
        role="button"
        tabIndex={-1}
      />

      <div
        className={`pointer-events-none absolute inset-0 z-20 flex flex-col justify-between bg-linear-to-b from-black/80 via-transparent to-black/85 px-8 py-7 transition-opacity duration-300 ${
          showControls || !isPlaying
            ? "opacity-100"
            : "pointer-events-none opacity-0"
        }`}
      >
        <div className="pointer-events-auto flex items-center justify-between gap-4">
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
          </div>
        </div>

        <div className="pointer-events-auto space-y-4">
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
                className="grid h-11 w-11 place-items-center rounded-full hover:bg-white/10 hover:text-brand-light transition-colors cursor-pointer"
                aria-label="Toggle mute"
              >
                {volume === 0 ? <VolumeX size={24} /> : <Volume2 size={24} />}
              </button>
              <input
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={(event) => setVolume(Number(event.target.value))}
                aria-label="Volume"
                className="theater-volume w-24 cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #c72c4e 0%, #c72c4e ${volume}%, #34343d ${volume}%, #34343d 100%)`,
                }}
              />
              <div
                className="relative flex items-center gap-1"
                onMouseEnter={() => showTrackMenu("subtitles")}
                onMouseLeave={hideTrackMenu}
              >
                <button
                  type="button"
                  onMouseEnter={() => showTrackMenu("subtitles")}
                  className="grid h-11 w-11 place-items-center rounded-full hover:bg-white/10 transition-colors cursor-default disabled:cursor-default disabled:opacity-40"
                  aria-label="Subtitles"
                  aria-expanded={openMenu === "subtitles"}
                  disabled={trackInfo.subtitle_tracks.length === 0}
                >
                  <Captions size={24} />
                </button>
                <button
                  type="button"
                  onMouseEnter={() => showTrackMenu("audio")}
                  className="grid h-11 w-11 place-items-center rounded-full hover:bg-white/10 transition-colors cursor-default disabled:cursor-default disabled:opacity-40"
                  aria-label="Audio language"
                  aria-expanded={openMenu === "audio"}
                  disabled={trackInfo.audio_tracks.length === 0}
                >
                  <Languages size={24} />
                </button>

                {openMenu && (
                  <div
                    className={`absolute bottom-11 right-0 w-72 overflow-hidden rounded-xl border border-white/15 bg-black/65 p-2 shadow-2xl backdrop-blur-2xl transition-all duration-180 ease-out ${isMenuVisible ? "translate-y-0 scale-100 opacity-100" : "translate-y-2 scale-95 opacity-0 pointer-events-none"}`}
                  >
                    <p className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-white/45">
                      {openMenu === "subtitles"
                        ? "Subtitles"
                        : "Audio & language"}
                    </p>
                    {openMenu === "subtitles" && (
                      <button
                        type="button"
                        onClick={() => void chooseSubtitle(null)}
                        className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors cursor-pointer ${selectedSubtitle === null ? "bg-brand/20 text-brand-light" : "text-white/75 hover:bg-white/10"}`}
                      >
                        Off
                      </button>
                    )}
                    {(openMenu === "subtitles"
                      ? trackInfo.subtitle_tracks
                      : trackInfo.audio_tracks
                    ).map((track) => {
                      const isSelected =
                        openMenu === "subtitles"
                          ? selectedSubtitle === track.stream_index
                          : selectedAudio === track.stream_index;
                      return (
                        <button
                          key={track.stream_index}
                          type="button"
                          onClick={() =>
                            openMenu === "subtitles"
                              ? void chooseSubtitle(track)
                              : void chooseAudio(track)
                          }
                          className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors cursor-pointer ${isSelected ? "bg-brand/20 text-brand-light" : "text-white/75 hover:bg-white/10"}`}
                        >
                          <span className="truncate text-sm">
                            {formatTrackLabel(track)}
                          </span>
                          {track.is_default && (
                            <span className="shrink-0 text-xs text-white/40">
                              Default
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <span className="whitespace-nowrap text-base tabular-nums text-white/75">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {activeSubtitleText && (
        <div className="pointer-events-none absolute inset-x-8 bottom-44 z-15 flex justify-center text-center">
          <p className="max-w-4xl whitespace-pre-line rounded-md bg-black/75 px-4 py-2 text-xl font-medium leading-snug text-white shadow-lg">
            {activeSubtitleText}
          </p>
        </div>
      )}

      {subtitleError && (
        <div className="absolute left-1/2 top-24 z-30 -translate-x-1/2 rounded-full bg-black/75 px-4 py-2 text-sm text-white shadow-lg">
          {subtitleError}
        </div>
      )}

      {audioError && (
        <div className="absolute left-1/2 top-24 z-30 -translate-x-1/2 rounded-full bg-black/75 px-4 py-2 text-sm text-white shadow-lg">
          {audioError}
        </div>
      )}

      {isPreparingAudio && (
        <div className="absolute left-1/2 top-24 z-30 -translate-x-1/2 rounded-full bg-black/75 px-4 py-2 text-sm text-white shadow-lg">
          Switching audio track…
        </div>
      )}

      {nextUp && isNearEnd && !dismissNextUp && (
        <aside className="absolute bottom-32 right-8 z-30 w-80 overflow-hidden rounded-xl border border-white/10 bg-zinc-950/90 shadow-2xl backdrop-blur">
          <div className="p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-white/50">
              Up next
            </p>
            <p className="mt-2 line-clamp-2 text-base font-medium text-white">
              {nextUp.title || nextUp.name}
            </p>
            <p className="mt-1 text-sm text-white/55">
              Starts when this video ends
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={nextTrack}
                className="rounded-md bg-white px-3 py-2 text-sm font-medium text-black hover:bg-brand-light hover:text-white transition-colors cursor-pointer"
              >
                Play now
              </button>
              <button
                type="button"
                onClick={() => setDismissNextUp(true)}
                className="rounded-md bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/15 transition-colors cursor-pointer"
              >
                Not now
              </button>
            </div>
          </div>
        </aside>
      )}
    </main>
  );
}

function formatTrackLabel(track: EmbeddedTrack): string {
  const language = formatLanguage(track.language);
  const title = track.title?.trim();
  return title || language || `${track.codec.toUpperCase()} track`;
}

function formatLanguage(language: string | null): string | null {
  if (!language?.trim()) return null;

  const names: Record<string, string> = {
    ara: "Arabic",
    ben: "Bengali",
    deu: "German",
    eng: "English",
    fra: "French",
    hin: "Hindi",
    ita: "Italian",
    jpn: "Japanese",
    kor: "Korean",
    por: "Portuguese",
    rus: "Russian",
    spa: "Spanish",
    tam: "Tamil",
    tel: "Telugu",
    und: "Unknown language",
    urd: "Urdu",
    zho: "Chinese",
  };

  const normalized = language.trim().toLowerCase();
  return names[normalized] || language.trim();
}

function formatTime(secs: number): string {
  if (!secs || Number.isNaN(secs)) return "0:00";
  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor(secs / 60);
  const seconds = Math.floor(secs % 60);
  if (hours > 0) {
    return `${hours}:${String(Math.floor((secs % 3600) / 60)).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
