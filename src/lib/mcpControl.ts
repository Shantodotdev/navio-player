import { useLibraryStore } from "../store/libraryStore";
import { type Track, usePlayerStore } from "../store/playerStore";
import {
  DEFAULT_DOWNLOAD_OPTIONS,
  type DownloadInspection,
  type DownloadJob,
  type DownloadOptions,
} from "./downloads";

export const NO_MUSIC_FOUND = "No music found.";

export type MediaTypeFilter = "audio" | "video";

export interface LocalTrackSelector {
  trackId?: string;
  name?: string;
}

export type McpControlCommand =
  | { type: "get_playback_state" }
  | {
      type: "search_library";
      query: string;
      media_type?: MediaTypeFilter;
      limit?: number;
    }
  | { type: "play_media"; track_id?: string; name?: string }
  | {
      type: "control_playback";
      action:
        | "play"
        | "pause"
        | "stop"
        | "next"
        | "previous"
        | "seek_to"
        | "seek_by";
      seconds?: number;
    }
  | { type: "set_volume"; volume: number }
  | { type: "get_queue" }
  | {
      type: "edit_queue";
      action: "add" | "remove" | "clear" | "play_index";
      track_id?: string;
      index?: number;
    }
  | { type: "set_player_view"; view: "hidden" | "drawer" | "theater" }
  | {
      type: "download_and_play_url";
      url: string;
      media_type: MediaTypeFilter;
    }
  | { type: "get_downloads"; job_id?: string };

export interface McpControlReply {
  success: boolean;
  message?: string;
  data?: unknown;
}

type StartDownloadRequest = Pick<
  DownloadJob,
  "id" | "url" | "format" | "no_playlist" | keyof DownloadOptions
>;

export interface McpDispatcherDependencies {
  getPlayerState: typeof usePlayerStore.getState;
  getLibraryState: typeof useLibraryStore.getState;
  inspectDownloadUrl: (
    url: string,
  ) => Promise<Pick<DownloadInspection, "is_collection">>;
  startDownload: (job: StartDownloadRequest) => Promise<void>;
  loadDownloads: () => Promise<DownloadJob[]>;
  createId: () => string;
  registerAutoplay: (jobId: string) => void;
  unregisterAutoplay?: (jobId: string) => void;
}

/**
 * Searches only Navio's in-memory library using deterministic title/name ranking.
 * Exact matches precede prefixes and substrings, original library order resolves
 * ties, and optional media-type/result limits are applied without network access.
 */
export function searchLocalTracks(
  tracks: Track[],
  query: string,
  mediaType?: MediaTypeFilter,
  limit = 10,
): Track[] {
  const normalizedQuery = normalizeLookupText(query);
  if (!normalizedQuery) return [];
  const resultLimit = Math.min(50, Math.max(1, Math.trunc(limit)));

  return tracks
    .filter((track) => !mediaType || track.media_type === mediaType)
    .map((track, originalIndex) => ({
      track,
      originalIndex,
      score: getMatchScore(track, normalizedQuery),
    }))
    .filter((candidate) => candidate.score < Number.POSITIVE_INFINITY)
    .sort(
      (left, right) =>
        left.score - right.score || left.originalIndex - right.originalIndex,
    )
    .slice(0, resultLimit)
    .map(({ track }) => track);
}

/**
 * Resolves a stable local track ID or exact local filename/title.
 * Track IDs take precedence when both selectors exist, and a miss deliberately
 * returns `null` without trying a URL, downloader, or internet search.
 */
export function resolveLocalTrack(
  tracks: Track[],
  selector: LocalTrackSelector,
): Track | null {
  if (selector.trackId) {
    return tracks.find((track) => track.id === selector.trackId) ?? null;
  }
  const normalizedName = normalizeLookupText(selector.name ?? "");
  if (!normalizedName) return null;
  return (
    tracks.find((track) =>
      [track.title, track.name]
        .filter((value): value is string => Boolean(value))
        .some((value) => normalizeLookupText(value) === normalizedName),
    ) ?? null
  );
}

/**
 * Executes one validated MCP command against Navio's shared renderer state.
 *
 * The dispatcher is the single behavioral adapter between typed Rust commands
 * and Zustand/downloader APIs. It repeats boundary-sensitive validation and
 * returns sanitized envelopes that omit paths, stream tokens, and control tokens.
 */
export async function dispatchMcpCommand(
  command: McpControlCommand,
  dependencies: McpDispatcherDependencies,
): Promise<McpControlReply> {
  const player = dependencies.getPlayerState();
  const library = dependencies.getLibraryState();

  switch (command.type) {
    case "get_playback_state":
      return success(serializePlaybackState(player));
    case "search_library": {
      const query = command.query.trim();
      if (!query || query.length > 200) {
        return failure("Library search query must contain 1 to 200 characters.");
      }
      if (!library.isInitialized) await library.fetchLibrary();
      const tracks = searchLocalTracks(
        dependencies.getLibraryState().tracks,
        query,
        command.media_type,
        command.limit ?? 10,
      );
      return success({ tracks: tracks.map(serializeTrack) });
    }
    case "play_media": {
      if (!library.isInitialized) await library.fetchLibrary();
      const refreshedTracks = dependencies.getLibraryState().tracks;
      const track = resolveLocalTrack(refreshedTracks, {
        trackId: command.track_id,
        name: command.name,
      });
      if (!track) return failure(NO_MUSIC_FOUND);
      dependencies.getPlayerState().playTrack(track, refreshedTracks);
      return success({ track: serializeTrack(track) }, "Playback started.");
    }
    case "control_playback": {
      const activePlayer = dependencies.getPlayerState();
      if (!activePlayer.currentTrack) return failure(NO_MUSIC_FOUND);
      if (
        (command.action === "seek_to" || command.action === "seek_by") &&
        !Number.isFinite(command.seconds)
      ) {
        return failure("A finite number of seconds is required for seeking.");
      }
      switch (command.action) {
        case "play":
          activePlayer.setIsPlaying(true);
          break;
        case "pause":
          activePlayer.setIsPlaying(false);
          break;
        case "stop":
          activePlayer.stopPlayback();
          break;
        case "next":
          activePlayer.nextTrack();
          break;
        case "previous":
          activePlayer.prevTrack();
          break;
        case "seek_to":
          activePlayer.seekTo(command.seconds ?? 0);
          break;
        case "seek_by":
          activePlayer.seekBy(command.seconds ?? 0);
          break;
      }
      return success(
        serializePlaybackState(dependencies.getPlayerState()),
        "Playback updated.",
      );
    }
    case "set_volume": {
      if (
        !Number.isInteger(command.volume) ||
        command.volume < 0 ||
        command.volume > 100
      ) {
        return failure("Volume must be an integer from 0 through 100.");
      }
      player.setVolume(command.volume);
      return success({ volume: command.volume }, "Volume updated.");
    }
    case "get_queue":
      return success(serializeQueue(player));
    case "edit_queue": {
      if (command.action === "clear") {
        player.clearQueue();
      } else if (command.action === "add") {
        if (!command.track_id) return failure("A local track ID is required.");
        if (!library.isInitialized) await library.fetchLibrary();
        const track = resolveLocalTrack(dependencies.getLibraryState().tracks, {
          trackId: command.track_id,
        });
        if (!track) return failure(NO_MUSIC_FOUND);
        dependencies.getPlayerState().addToQueue(track);
      } else {
        if (!Number.isInteger(command.index)) {
          return failure("A valid queue index is required.");
        }
        const changed =
          command.action === "remove"
            ? player.removeQueueIndex(command.index ?? -1)
            : player.playQueueIndex(command.index ?? -1);
        if (!changed) return failure("Queue index is out of range.");
      }
      return success(
        serializeQueue(dependencies.getPlayerState()),
        "Queue updated.",
      );
    }
    case "set_player_view": {
      const current = dependencies.getPlayerState().currentTrack;
      if (command.view === "theater" && current?.media_type !== "video") {
        return failure("Theater view requires an active video.");
      }
      if (command.view === "hidden") {
        player.setTheaterOpen(false);
        player.setDrawerOpen(false);
      } else if (command.view === "drawer") {
        player.setTheaterOpen(false);
        player.setDrawerOpen(true);
      } else {
        player.setDrawerOpen(true);
        player.setTheaterOpen(true);
      }
      return success({ view: command.view }, "Player view updated.");
    }
    case "download_and_play_url": {
      if (!isExplicitPublicUrl(command.url)) {
        return failure("An explicit public media URL is required.");
      }
      await dependencies.inspectDownloadUrl(command.url);
      const id = dependencies.createId();
      const request: StartDownloadRequest = {
        id,
        url: command.url,
        format: command.media_type === "audio" ? "bestaudio" : "best",
        no_playlist: true,
        ...DEFAULT_DOWNLOAD_OPTIONS,
      };
      dependencies.registerAutoplay(id);
      try {
        await dependencies.startDownload(request);
      } catch (error) {
        dependencies.unregisterAutoplay?.(id);
        throw error;
      }
      return success(
        { job_id: id, status: "queued" },
        "Download queued and will play after completion.",
      );
    }
    case "get_downloads": {
      const downloads = await dependencies.loadDownloads();
      const jobs = command.job_id
        ? downloads.filter((job) => job.id === command.job_id)
        : downloads;
      return success({ downloads: jobs.map(serializeDownloadJob) });
    }
  }
}

/**
 * Plays the first completed file for a download registered by the MCP dispatcher.
 * Terminal failures clear registration, completion is consumed exactly once, and
 * Rust must authorize and inspect the path before it becomes a playable track.
 */
export async function handleDownloadAutoplay(
  job: DownloadJob,
  pendingJobIds: Set<string>,
  inspectMedia: (path: string) => Promise<Track>,
  playTrack: (track: Track) => void,
): Promise<boolean> {
  if (!pendingJobIds.has(job.id)) return false;
  if (job.status === "failed" || job.status === "cancelled") {
    pendingJobIds.delete(job.id);
    return false;
  }
  if (job.status !== "completed") return false;

  pendingJobIds.delete(job.id);
  const completedPath = job.completed_paths[0];
  if (!completedPath) throw new Error("Download completed without a media file.");
  const track = await inspectMedia(completedPath);
  playTrack(track);
  return true;
}

/**
 * Converts a renderer track into agent-safe metadata.
 * The local path is intentionally omitted because MCP callers select media by
 * stable ID and do not inherit Navio's direct filesystem authority.
 */
function serializeTrack(track: Track) {
  return {
    id: track.id,
    name: track.name,
    title: track.title ?? null,
    duration_secs: track.duration_secs,
    file_size_bytes: track.file_size_bytes ?? null,
    media_type: track.media_type,
  };
}

/**
 * Captures renderer-owned playback, queue, volume, and presentation state.
 * Current media is passed through the path-free track serializer, and private
 * stream configuration never enters the response object.
 */
function serializePlaybackState(player: ReturnType<typeof usePlayerStore.getState>) {
  return {
    current_track: player.currentTrack
      ? serializeTrack(player.currentTrack)
      : null,
    is_playing: player.isPlaying,
    current_time_secs: player.currentTime,
    volume: player.volume,
    queue_index: player.playIndex,
    queue_length: player.playlist.length,
    drawer_open: player.isDrawerOpen,
    theater_open: player.isTheaterOpen,
  };
}

/**
 * Serializes the ordered queue and active index for agent inspection.
 * Every queue member uses the same path-free metadata contract as local search.
 */
function serializeQueue(player: ReturnType<typeof usePlayerStore.getState>) {
  return {
    active_index: player.playIndex,
    tracks: player.playlist.map(serializeTrack),
  };
}

/**
 * Reports durable download state without exposing completed local file paths.
 * Paths become a file count and the retained diagnostic becomes a boolean flag,
 * which is sufficient for monitoring without leaking local machine details.
 */
function serializeDownloadJob(job: DownloadJob) {
  return {
    id: job.id,
    url: job.url,
    format: job.format,
    status: job.status,
    title: job.title,
    progress: job.progress,
    speed: job.speed,
    eta: job.eta,
    size: job.size,
    has_error: job.error !== null,
    current_item: job.current_item,
    total_items: job.total_items,
    completed_file_count: job.completed_paths.length,
    created_at_ms: job.created_at_ms,
    updated_at_ms: job.updated_at_ms,
  };
}

/**
 * Accepts only explicit non-credentialed network URLs supported by Navio.
 * This renderer check mirrors Rust validation so malformed, local, and embedded-
 * credential URLs fail before invoking downloader inspection.
 */
function isExplicitPublicUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      ["http:", "https:", "ftp:", "ftps:"].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

/**
 * Builds the stable successful reply envelope consumed by Rust and MCP clients.
 * The optional message is omitted rather than serialized as `undefined`.
 */
function success(data: unknown, message?: string): McpControlReply {
  return { success: true, ...(message ? { message } : {}), data };
}

/**
 * Builds a failed renderer reply containing only concise user-facing text.
 * Command-specific data is intentionally absent on failure.
 */
function failure(message: string): McpControlReply {
  return { success: false, message };
}

/**
 * Normalizes human lookup text for case-insensitive local comparisons.
 * It performs no path resolution, URL interpretation, or fuzzy token expansion.
 */
function normalizeLookupText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

/**
 * Scores exact, prefix, and substring matches for deterministic search ordering.
 * Non-matches receive infinity so callers can filter them without a second set
 * of comparison rules.
 */
function getMatchScore(track: Track, query: string): number {
  const candidates = [track.title, track.name]
    .filter((value): value is string => Boolean(value))
    .map(normalizeLookupText);
  if (candidates.some((value) => value === query)) return 0;
  if (candidates.some((value) => value.startsWith(query))) return 1;
  if (candidates.some((value) => value.includes(query))) return 2;
  return Number.POSITIVE_INFINITY;
}
