import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Folder,
  Pause,
  Play,
  RotateCcw,
  X,
} from "lucide-react";
import { Select } from "../components/Select";
import {
  controlDownload,
  getDownloadActions,
  listenToDownloads,
  loadDownloads,
  startDownload,
  type DownloadJob,
} from "../lib/downloads";

export const Route = createFileRoute("/downloader")({
  component: DownloaderView,
});

type DownloadTab = "all" | "active" | "history";

/** Renders Navio's persistent remote-download queue and controls. */
function DownloaderView() {
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<DownloadJob["format"]>("best");
  const [downloads, setDownloads] = useState<DownloadJob[]>([]);
  const [activeTab, setActiveTab] = useState<DownloadTab>("all");
  const [isChecking, setIsChecking] = useState(false);
  const [pendingDownload, setPendingDownload] = useState<{
    url: string;
    format: DownloadJob["format"];
  } | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let unlisten: () => void = () => {};
    /** Merges a durable update without relying on the renderer's previous lifecycle. */
    function mergeJob(job: DownloadJob) {
      setDownloads((previous) => {
        const withoutUpdated = previous.filter((item) => item.id !== job.id);
        return [job, ...withoutUpdated].sort(
          (left, right) => right.updated_at_ms - left.updated_at_ms,
        );
      });
    }

    void (async () => {
      const jobs = await loadDownloads();
      if (!mounted) return;
      setDownloads(jobs);
      unlisten = await listenToDownloads(mergeJob, (id) => {
        setDownloads((previous) => previous.filter((item) => item.id !== id));
      });
    })();

    return () => {
      mounted = false;
      unlisten();
    };
  }, []);

  /** Starts a durable job after playlist choice has been resolved. */
  async function triggerDownload(
    targetUrl: string,
    targetFormat: DownloadJob["format"],
    noPlaylist: boolean,
  ) {
    setFormError(null);
    try {
      await startDownload({
        id: crypto.randomUUID(),
        url: targetUrl,
        format: targetFormat,
        no_playlist: noPlaylist,
      });
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Could not start the download.",
      );
    }
  }

  /** Inspects a link only to select the correct playlist prompt. */
  async function handleStartDownload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!url.trim() || isChecking) return;
    const targetUrl = url.trim();
    const targetFormat = format;
    setIsChecking(true);
    setFormError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const type = await invoke<{ is_playlist: boolean; has_video: boolean }>(
        "check_url_type",
        { url: targetUrl },
      );
      if (type.is_playlist && type.has_video) {
        setPendingDownload({ url: targetUrl, format: targetFormat });
      } else {
        await triggerDownload(targetUrl, targetFormat, !type.is_playlist);
      }
      setUrl("");
    } catch {
      // Browser development has no Tauri URL classifier; let yt-dlp validate the URL itself.
      await triggerDownload(targetUrl, targetFormat, true);
      setUrl("");
    } finally {
      setIsChecking(false);
    }
  }

  /** Executes one backend state transition and keeps the action row single-click safe. */
  async function handleAction(
    command:
      | "pause_download"
      | "resume_download"
      | "cancel_download"
      | "remove_download",
    id: string,
  ) {
    setPendingActionId(id);
    try {
      await controlDownload(command, id);
    } catch (error) {
      setDownloads((previous) =>
        previous.map((job) =>
          job.id === id
            ? {
                ...job,
                error:
                  error instanceof Error
                    ? error.message
                    : "Download action failed.",
              }
            : job,
        ),
      );
    } finally {
      setPendingActionId(null);
    }
  }

  /** Opens the shared final download directory when running inside Tauri. */
  async function handleOpenFolder() {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_folder");
    } catch {
      // Folder controls are intentionally inert during browser-only development.
    }
  }

  const activeDownloads = downloads.filter((item) =>
    ["queued", "preparing", "downloading", "paused"].includes(item.status),
  );
  const filteredDownloads = downloads.filter((item) => {
    if (activeTab === "active")
      return activeDownloads.some((active) => active.id === item.id);
    if (activeTab === "history")
      return !activeDownloads.some((active) => active.id === item.id);
    return true;
  });

  return (
    <div className="max-w-5xl mx-auto font-medium select-none text-zinc-450">
      <div>
        <h1 className="text-4xl font-medium text-zinc-200 tracking-tight mb-20">
          Download from <span className="text-brand-light">YouTube</span>
        </h1>
      </div>

      <form
        onSubmit={handleStartDownload}
        className="relative z-20 bg-panel-bg/30 backdrop-blur-md border border-white/5 p-6 rounded-2xl space-y-4 mb-8"
      >
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-zinc-450">
            Media stream URL
          </label>
          <div className="flex flex-col md:flex-row gap-3">
            <input
              type="url"
              required
              disabled={isChecking}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="Paste YouTube, Vimeo, or generic video stream link..."
              className="flex-1 bg-black/40 border border-white/5 rounded-lg px-4 py-2.5 text-base text-zinc-200 focus:outline-none focus:border-brand/40 placeholder-zinc-550 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <div className="w-full md:w-64 shrink-0">
              <Select
                options={[
                  { value: "best", label: "Video" },
                  { value: "bestaudio", label: "Audio" },
                ]}
                value={format}
                onChange={(value) => setFormat(value as DownloadJob["format"])}
                disabled={isChecking}
              />
            </div>
            <button
              type="submit"
              disabled={isChecking}
              className="flex items-center justify-center gap-2 px-6 py-2.5 bg-brand hover:bg-brand-light text-zinc-200 rounded-lg text-base transition-all font-medium shadow-lg shadow-brand-glow cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isChecking ? (
                <span>Checking...</span>
              ) : (
                <>
                  <Download size={16} />
                  <span>Download</span>
                </>
              )}
            </button>
          </div>
          {formError && <p className="text-sm text-red-400">{formError}</p>}
        </div>
      </form>

      <div className="relative z-10 flex items-center border-b border-white/5 pb-2 mb-6">
        <div className="flex gap-4">
          <TabButton
            active={activeTab === "all"}
            onClick={() => setActiveTab("all")}
          >
            All ({downloads.length})
          </TabButton>
          <TabButton
            active={activeTab === "active"}
            onClick={() => setActiveTab("active")}
          >
            Active ({activeDownloads.length})
          </TabButton>
          <TabButton
            active={activeTab === "history"}
            onClick={() => setActiveTab("history")}
          >
            History ({downloads.length - activeDownloads.length})
          </TabButton>
        </div>
      </div>

      <div className="relative z-10 space-y-4">
        {filteredDownloads.map((item) => (
          <DownloadCard
            key={item.id}
            item={item}
            pending={pendingActionId === item.id}
            onAction={handleAction}
            onOpenFolder={handleOpenFolder}
          />
        ))}
        {filteredDownloads.length === 0 && (
          <div className="p-12 text-center text-zinc-500 italic bg-panel-bg/10 border border-white/5 rounded-xl font-medium">
            No downloads in this category.
          </div>
        )}
      </div>

      <PlaylistDownloadModal
        isOpen={pendingDownload !== null}
        onClose={() => setPendingDownload(null)}
        onSelect={(downloadPlaylist) => {
          if (!pendingDownload) return;
          void triggerDownload(
            pendingDownload.url,
            pendingDownload.format,
            !downloadPlaylist,
          );
          setPendingDownload(null);
        }}
      />
    </div>
  );
}

/** Renders one underline-style queue filter. */
function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`pb-2 text-sm font-medium transition-all border-b-2 cursor-pointer ${active ? "border-brand text-brand-light" : "border-transparent text-zinc-450 hover:text-zinc-200"}`}
    >
      {children}
    </button>
  );
}

/** Prompts for a playlist choice only when a URL identifies both a video and playlist. */
function PlaylistDownloadModal({
  isOpen,
  onClose,
  onSelect,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (downloadPlaylist: boolean) => void;
}) {
  return (
    <div
      onClick={onClose}
      className={`fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 select-none transition-opacity duration-200 ${isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md bg-zinc-950/30 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-2xl space-y-5"
      >
        <h3 className="text-xl font-medium text-zinc-200">Playlist Detected</h3>
        <p className="text-sm text-zinc-400 leading-relaxed font-normal">
          This link contains both a single video and a playlist. What would you
          like to download?
        </p>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => onSelect(true)}
            className="w-full text-left px-4 py-3 bg-brand/10 hover:bg-brand/20 border border-brand/35 text-brand-light rounded-xl transition-all font-medium cursor-pointer"
          >
            Download entire playlist
          </button>
          <button
            onClick={() => onSelect(false)}
            className="w-full text-left px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/5 text-zinc-200 rounded-xl transition-all font-medium cursor-pointer"
          >
            Download single video
          </button>
        </div>
        <div className="flex justify-end pt-2 border-t border-white/5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-zinc-450 hover:text-zinc-200 transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** Renders one backend-owned job, including the only safe actions for its state. */
function DownloadCard({
  item,
  pending,
  onAction,
  onOpenFolder,
}: {
  item: DownloadJob;
  pending: boolean;
  onAction: (
    command:
      | "pause_download"
      | "resume_download"
      | "cancel_download"
      | "remove_download",
    id: string,
  ) => Promise<void>;
  onOpenFolder: () => Promise<void>;
}) {
  const actions = getDownloadActions(item);
  const statusColor =
    item.status === "completed"
      ? "text-green-500"
      : ["failed", "interrupted", "cancelled"].includes(item.status)
        ? "text-red-400"
        : item.status === "paused"
          ? "text-blue-400"
          : "text-yellow-500";
  const showProgress = [
    "queued",
    "preparing",
    "downloading",
    "paused",
  ].includes(item.status);
  const displayTitle =
    item.current_item && item.total_items
      ? `[${item.current_item}/${item.total_items}] ${item.title}`
      : item.title;
  return (
    <div className="bg-panel-bg/20 backdrop-blur-md border border-white/5 rounded-xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          {item.status === "completed" ? (
            <CheckCircle2 size={15} className="text-green-500" />
          ) : ["failed", "interrupted", "cancelled"].includes(item.status) ? (
            <AlertTriangle size={15} className="text-red-400" />
          ) : (
            <span
              className={`w-2 h-2 rounded-full ${item.status === "paused" ? "bg-blue-400" : "bg-yellow-500 animate-ping"}`}
            />
          )}
          <span className={`text-sm uppercase font-medium ${statusColor}`}>
            {item.status}
          </span>
          <span className="text-zinc-700">•</span>
          <span
            className="text-xs text-zinc-450 truncate max-w-50"
            title={item.url}
          >
            {item.url}
          </span>
        </div>
        <h3 className="text-base font-medium text-zinc-200 tracking-wide truncate mt-1">
          {displayTitle}
        </h3>
        {showProgress && (
          <div className="w-full flex items-center gap-3 pt-2">
            <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-brand rounded-full transition-all duration-300"
                style={{ width: `${item.progress}%` }}
              />
            </div>
            <span className="text-xs text-zinc-400 shrink-0 w-10 text-right font-medium">
              {item.progress}%
            </span>
          </div>
        )}
        {item.error && (
          <p className="text-xs text-red-400 pt-1 wrap-break-word">
            {item.error}
          </p>
        )}
      </div>
      <div className="flex items-center gap-4 shrink-0 self-stretch md:self-auto justify-between md:justify-end border-t md:border-t-0 border-white/5 pt-3 md:pt-0">
        <div className="flex gap-4 text-2xs text-zinc-500 font-medium">
          <div className="flex flex-col">
            <span className="text-xs">Speed</span>
            <span className="text-sm text-zinc-300 mt-0.5">{item.speed}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs">Format</span>
            <span className="text-sm text-zinc-300 mt-0.5">
              {item.format === "bestaudio" ? "Audio" : "Video"}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs">Size</span>
            <span className="text-sm text-zinc-300 mt-0.5">{item.size}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {actions.pause && (
            <button
              disabled={pending}
              onClick={() => void onAction("pause_download", item.id)}
              title="Pause download"
              className="p-2 bg-white/5 hover:bg-white/10 rounded-lg text-zinc-450 hover:text-zinc-200 disabled:opacity-50 cursor-pointer"
            >
              <Pause size={14} />
            </button>
          )}
          {actions.resume && (
            <button
              disabled={pending}
              onClick={() => void onAction("resume_download", item.id)}
              title={
                item.status === "paused" ? "Resume download" : "Retry download"
              }
              className="p-2 bg-brand/15 hover:bg-brand/25 rounded-lg text-brand-light disabled:opacity-50 cursor-pointer"
            >
              {item.status === "paused" ? (
                <Play size={14} />
              ) : (
                <RotateCcw size={14} />
              )}
            </button>
          )}
          {actions.cancel && (
            <button
              disabled={pending}
              onClick={() => void onAction("cancel_download", item.id)}
              title="Cancel and delete partial files"
              className="p-2 bg-white/5 hover:bg-red-950/20 rounded-lg text-zinc-500 hover:text-red-400 disabled:opacity-50 cursor-pointer"
            >
              <X size={14} />
            </button>
          )}
          {item.status === "completed" && (
            <button
              onClick={() => void onOpenFolder()}
              title="Open Downloads folder"
              className="p-2 bg-white/5 hover:bg-white/10 rounded-lg text-zinc-450 hover:text-zinc-200 cursor-pointer"
            >
              <Folder size={14} />
            </button>
          )}
          {actions.remove && (
            <button
              disabled={pending}
              onClick={() => void onAction("remove_download", item.id)}
              title="Remove from history"
              className="p-2 bg-white/5 hover:bg-red-950/20 rounded-lg text-zinc-500 hover:text-red-400 disabled:opacity-50 cursor-pointer"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
