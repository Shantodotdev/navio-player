/** Durable backend state for one downloader card. This mirrors Rust `DownloadJob`. */
export interface DownloadJob {
  id: string;
  url: string;
  format: "best" | "bestaudio";
  no_playlist: boolean;
  quality: DownloadQuality;
  video_container: VideoContainer;
  audio_format: AudioFormat;
  subtitle_mode: SubtitleMode;
  subtitle_languages: string[];
  playlist_start: number | null;
  playlist_end: number | null;
  status:
    | "queued"
    | "preparing"
    | "downloading"
    | "paused"
    | "completed"
    | "failed"
    | "cancelled"
    | "interrupted";
  title: string;
  progress: number;
  speed: string;
  eta: string;
  size: string;
  error: string | null;
  current_item: number | null;
  total_items: number | null;
  completed_paths: string[];
  created_at_ms: number;
  updated_at_ms: number;
}

export type DownloadQuality =
  | "best"
  | "2160p"
  | "1440p"
  | "1080p"
  | "720p"
  | "480p"
  | "360p";
export type VideoContainer = "auto" | "mp4" | "mkv" | "webm";
export type AudioFormat = "original" | "mp3" | "m4a" | "opus" | "flac" | "wav";
export type SubtitleMode = "none" | "selected" | "all";

export interface DownloadOptions {
  quality: DownloadQuality;
  video_container: VideoContainer;
  audio_format: AudioFormat;
  subtitle_mode: SubtitleMode;
  subtitle_languages: string[];
  playlist_start: number | null;
  playlist_end: number | null;
}

export const DEFAULT_DOWNLOAD_OPTIONS: DownloadOptions = {
  quality: "best",
  video_container: "auto",
  audio_format: "original",
  subtitle_mode: "none",
  subtitle_languages: [],
  playlist_start: null,
  playlist_end: null,
};

/** Public metadata Navio resolves before creating a durable download job. */
export interface DownloadInspection {
  source: string;
  title: string;
  thumbnail: string | null;
  is_collection: boolean;
  item_count: number | null;
  video_qualities: number[];
  subtitle_languages: string[];
}

/** Explicit per-state actions prevent destructive controls from appearing on completed jobs. */
export interface DownloadActions {
  pause: boolean;
  cancel: boolean;
  resume: boolean;
  remove: boolean;
}

/** Maps durable state to the only allowed card actions. */
export function getDownloadActions(job: DownloadJob): DownloadActions {
  const isActive = ["queued", "preparing", "downloading"].includes(job.status);
  return {
    pause: isActive,
    cancel: isActive,
    resume: ["paused", "failed", "interrupted"].includes(job.status),
    remove: ["completed", "failed", "cancelled", "interrupted"].includes(
      job.status,
    ),
  };
}

/** Replaces one live record while keeping queue cards in stable creation order. */
export function mergeDownloadJob(
  previous: DownloadJob[],
  updated: DownloadJob,
): DownloadJob[] {
  const exists = previous.some((job) => job.id === updated.id);
  return exists
    ? previous.map((job) => (job.id === updated.id ? updated : job))
    : [updated, ...previous];
}

/** Loads durable jobs from Tauri and keeps browser-only development usable. */
export async function loadDownloads(): Promise<DownloadJob[]> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<DownloadJob[]>("get_downloads");
  } catch {
    return [];
  }
}

/** Uses yt-dlp's metadata mode to verify a public URL before queueing it. */
export async function inspectDownloadUrl(
  url: string,
): Promise<DownloadInspection> {
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<DownloadInspection>("inspect_download_url", { url });
}

/** Starts a newly created job with the original choices captured by the caller. */
export async function startDownload(
  job: Pick<
    DownloadJob,
    | "id"
    | "url"
    | "format"
    | "no_playlist"
    | keyof DownloadOptions
  >,
): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("start_download", { request: createStartDownloadPayload(job) });
}

/** Converts Navio's persisted snake_case record into Tauri's camelCase command arguments. */
export function createStartDownloadPayload(
  job: Pick<
    DownloadJob,
    | "id"
    | "url"
    | "format"
    | "no_playlist"
    | keyof DownloadOptions
  >,
): {
  id: string;
  url: string;
  format: DownloadJob["format"];
  noPlaylist: boolean;
  quality: DownloadQuality;
  videoContainer: VideoContainer;
  audioFormat: AudioFormat;
  subtitleMode: SubtitleMode;
  subtitleLanguages: string[];
  playlistStart: number | null;
  playlistEnd: number | null;
} {
  return {
    id: job.id,
    url: job.url,
    format: job.format,
    noPlaylist: job.no_playlist,
    quality: job.quality,
    videoContainer: job.video_container,
    audioFormat: job.audio_format,
    subtitleMode: job.subtitle_mode,
    subtitleLanguages: job.subtitle_languages,
    playlistStart: job.playlist_start,
    playlistEnd: job.playlist_end,
  };
}

/** Dispatches a durable backend action for an existing job. */
export async function controlDownload(
  command:
    | "pause_download"
    | "resume_download"
    | "cancel_download"
    | "remove_download",
  id: string,
): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke(command, { id });
}

/** Subscribes to whole-record updates so reload and live rendering share the same data shape. */
export async function listenToDownloads(
  onUpdate: (job: DownloadJob) => void,
  onRemoved: (id: string) => void,
): Promise<() => void> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    const [unlistenUpdate, unlistenRemove] = await Promise.all([
      listen<DownloadJob>("download-updated", (event) =>
        onUpdate(event.payload),
      ),
      listen<string>("download-removed", (event) => onRemoved(event.payload)),
    ]);
    return () => {
      unlistenUpdate();
      unlistenRemove();
    };
  } catch {
    return () => undefined;
  }
}
