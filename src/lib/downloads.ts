/** Durable backend state for one downloader card. This mirrors Rust `DownloadJob`. */
export interface DownloadJob {
  id: string;
  url: string;
  format: "best" | "bestaudio";
  no_playlist: boolean;
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

/** Loads durable jobs from Tauri and keeps browser-only development usable. */
export async function loadDownloads(): Promise<DownloadJob[]> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<DownloadJob[]>("get_downloads");
  } catch {
    return [];
  }
}

/** Starts a newly created job with the original choices captured by the caller. */
export async function startDownload(
  job: Pick<DownloadJob, "id" | "url" | "format" | "no_playlist">,
): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("start_download", job);
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
