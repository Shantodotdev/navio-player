import { useEffect, useRef } from "react";
import {
  createPlaybackActivitySession,
  type PlaybackActivitySession,
  type PlaybackMilestone,
} from "../lib/playbackActivity";
import type { MediaActivity } from "../lib/smartPlaylists";
import { useLibraryStore } from "../store/libraryStore";
import { usePlayerStore } from "../store/playerStore";

/** Tracks meaningful playback once across Navio's sidebar and theater surfaces. */
export function usePlaybackActivity() {
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const mediaElement = usePlayerStore((state) => state.mediaElement);
  const updateActivity = useLibraryStore((state) => state.updateActivity);
  const sessionRef = useRef<PlaybackActivitySession | null>(null);

  if (currentTrack && sessionRef.current?.trackId !== currentTrack.id) {
    sessionRef.current = createPlaybackActivitySession(currentTrack.id);
  } else if (!currentTrack) {
    sessionRef.current = null;
  }

  useEffect(() => {
    if (!currentTrack || !mediaElement || !sessionRef.current) return;
    const track = currentTrack;
    const element = mediaElement;
    const session = sessionRef.current;
    session.resetPosition(element.currentTime);

    async function persistMilestone(milestone: PlaybackMilestone) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const entry = await invoke<MediaActivity>(
          "record_playback_milestone",
          {
            mediaId: track.id,
            path: track.path,
            milestone,
          },
        );
        updateActivity(entry);
      } catch (error) {
        console.warn("Could not persist playback activity:", error);
      }
    }

    function handleTimeUpdate() {
      if (element.paused || element.seeking) return;
      const milestones = session.observe(
        element.currentTime,
        element.duration,
      );
      for (const milestone of milestones) void persistMilestone(milestone);
    }

    function resetPosition() {
      session.resetPosition(element.currentTime);
    }

    element.addEventListener("timeupdate", handleTimeUpdate);
    element.addEventListener("seeking", resetPosition);
    element.addEventListener("seeked", resetPosition);
    return () => {
      element.removeEventListener("timeupdate", handleTimeUpdate);
      element.removeEventListener("seeking", resetPosition);
      element.removeEventListener("seeked", resetPosition);
    };
  }, [currentTrack, mediaElement, updateActivity]);
}
