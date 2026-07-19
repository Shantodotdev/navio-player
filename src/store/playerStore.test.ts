import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore, type Track } from "./playerStore";

const trackOne: Track = {
  id: "one",
  path: "C:\\Media\\one.mp3",
  name: "One",
  duration_secs: 120,
  media_type: "audio",
};

const trackTwo: Track = {
  id: "two",
  path: "C:\\Media\\two.mp3",
  name: "Two",
  duration_secs: 150,
  media_type: "audio",
};

const trackThree: Track = {
  id: "three",
  path: "C:\\Media\\three.mp3",
  name: "Three",
  duration_secs: 180,
  media_type: "audio",
};

const trackFour: Track = {
  id: "four",
  path: "C:\\Media\\four.mp3",
  name: "Four",
  duration_secs: 210,
  media_type: "audio",
};

const playlist = [trackOne, trackTwo, trackThree];

/** Creates the media surface needed to observe playback transitions in the store. */
function createMediaElement(): HTMLVideoElement {
  return {
    currentTime: 0,
    duration: 180,
    pause: vi.fn(),
    play: vi.fn(() => Promise.resolve()),
    src: "",
    volume: 0.8,
  } as unknown as HTMLVideoElement;
}

/** Seeds one canonical playlist position without invoking autoplay setup. */
function seedPlayer(track: Track, playIndex: number): HTMLVideoElement {
  const mediaElement = createMediaElement();
  usePlayerStore.setState({
    currentTrack: track,
    playlist,
    playIndex,
    isPlaying: true,
    currentTime: 0,
    mediaElement,
    shuffleEnabled: false,
    repeatMode: "off",
    shufflePendingIds: [],
    shuffleHistoryIds: [],
  });
  return mediaElement;
}

describe("player shuffle and repeat modes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    usePlayerStore.setState({
      currentTrack: null,
      playlist: [],
      playIndex: -1,
      isPlaying: false,
      currentTime: 0,
      mediaElement: null,
      shuffleEnabled: false,
      repeatMode: "off",
      shufflePendingIds: [],
      shuffleHistoryIds: [],
    });
  });

  it("cycles repeat from off to all to one and back to off", () => {
    const player = usePlayerStore.getState();

    player.cycleRepeatMode();
    expect(usePlayerStore.getState().repeatMode).toBe("all");
    usePlayerStore.getState().cycleRepeatMode();
    expect(usePlayerStore.getState().repeatMode).toBe("one");
    usePlayerStore.getState().cycleRepeatMode();
    expect(usePlayerStore.getState().repeatMode).toBe("off");
  });

  it("stops at the final track when repeat is off", () => {
    seedPlayer(trackThree, 2);

    usePlayerStore.getState().handleTrackEnded();

    expect(usePlayerStore.getState()).toMatchObject({
      currentTrack: trackThree,
      playIndex: 2,
      isPlaying: false,
    });
  });

  it("wraps after natural completion when repeat-all is active", () => {
    seedPlayer(trackThree, 2);
    usePlayerStore.setState({ repeatMode: "all" });

    usePlayerStore.getState().handleTrackEnded();

    expect(usePlayerStore.getState()).toMatchObject({
      currentTrack: trackOne,
      playIndex: 0,
      isPlaying: true,
    });
  });

  it("restarts repeat-one on natural completion but manual Next advances", () => {
    const media = seedPlayer(trackOne, 0);
    media.currentTime = 120;
    usePlayerStore.setState({ repeatMode: "one", currentTime: 120 });

    usePlayerStore.getState().handleTrackEnded();

    expect(media.currentTime).toBe(0);
    expect(usePlayerStore.getState()).toMatchObject({
      currentTrack: trackOne,
      currentTime: 0,
      isPlaying: true,
    });

    usePlayerStore.getState().nextTrack();
    expect(usePlayerStore.getState().currentTrack).toBe(trackTwo);
  });

  it("keeps the current track and follows shuffled playback history", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    seedPlayer(trackOne, 0);

    usePlayerStore.getState().toggleShuffle();
    expect(usePlayerStore.getState().currentTrack).toBe(trackOne);

    usePlayerStore.getState().nextTrack();
    const shuffledTrack = usePlayerStore.getState().currentTrack;
    expect(shuffledTrack).toBe(trackThree);

    usePlayerStore.getState().prevTrack();
    expect(usePlayerStore.getState().currentTrack).toBe(trackOne);

    usePlayerStore.getState().nextTrack();
    expect(usePlayerStore.getState().currentTrack).toBe(shuffledTrack);
  });

  it("returns to canonical navigation when shuffle is disabled", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    seedPlayer(trackOne, 0);
    usePlayerStore.getState().toggleShuffle();
    usePlayerStore.getState().nextTrack();
    expect(usePlayerStore.getState().currentTrack).toBe(trackThree);

    usePlayerStore.getState().toggleShuffle();
    usePlayerStore.getState().nextTrack();

    expect(usePlayerStore.getState().currentTrack).toBe(trackOne);
  });

  it("keeps shuffled traversal valid when the queue changes", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    seedPlayer(trackOne, 0);
    usePlayerStore.getState().toggleShuffle();

    usePlayerStore.getState().addToQueue(trackFour);
    expect(usePlayerStore.getState().shufflePendingIds).toContain("four");

    usePlayerStore.getState().removeQueueIndex(1);
    expect(usePlayerStore.getState().shufflePendingIds).not.toContain("two");

    usePlayerStore.getState().clearQueue();
    expect(usePlayerStore.getState()).toMatchObject({
      playlist: [trackOne],
      shufflePendingIds: [],
      shuffleHistoryIds: ["one"],
    });
  });
});
