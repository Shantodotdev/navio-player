import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Download,
  Folder,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  X,
} from "lucide-react";
import { Select, type SelectOption } from "../components/Select";
import {
  DEFAULT_DOWNLOAD_OPTIONS,
  controlDownload,
  getDownloadActions,
  inspectDownloadUrl,
  listenToDownloads,
  loadDownloads,
  mergeDownloadJob,
  startDownload,
  type AudioFormat,
  type DownloadInspection,
  type DownloadJob,
  type DownloadOptions,
  type DownloadQuality,
  type SubtitleMode,
  type VideoContainer,
} from "../lib/downloads";
import { getMediaDisplayName } from "../lib/mediaLabels";
import { useSettingsStore } from "../store/settingsStore";

export const Route = createFileRoute("/downloader")({
  component: DownloaderView,
});

type DownloadTab = "all" | "active" | "history";

interface PendingDownload {
  url: string;
  format: DownloadJob["format"];
  options: DownloadOptions;
  inspection: DownloadInspection;
}

/** Renders Navio's persistent remote-download queue and controls. */
function DownloaderView() {
  const { settings } = useSettingsStore();
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<DownloadJob["format"]>("best");
  const [quality, setQuality] = useState<DownloadQuality>(
    DEFAULT_DOWNLOAD_OPTIONS.quality,
  );
  const [videoContainer, setVideoContainer] = useState<VideoContainer>(
    DEFAULT_DOWNLOAD_OPTIONS.video_container,
  );
  const [audioFormat, setAudioFormat] = useState<AudioFormat>(
    DEFAULT_DOWNLOAD_OPTIONS.audio_format,
  );
  const [subtitleMode, setSubtitleMode] = useState<SubtitleMode>(
    DEFAULT_DOWNLOAD_OPTIONS.subtitle_mode,
  );
  const [subtitleLanguages, setSubtitleLanguages] = useState("");
  const [playlistStart, setPlaylistStart] = useState("");
  const [playlistEnd, setPlaylistEnd] = useState("");
  const [downloads, setDownloads] = useState<DownloadJob[]>([]);
  const [activeTab, setActiveTab] = useState<DownloadTab>("all");
  const [isChecking, setIsChecking] = useState(false);
  const [pendingDownload, setPendingDownload] =
    useState<PendingDownload | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let unlisten: () => void = () => {};
    /** Merges a durable update without relying on the renderer's previous lifecycle. */
    function mergeJob(job: DownloadJob) {
      setDownloads((previous) => mergeDownloadJob(previous, job));
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
    options: DownloadOptions,
  ): Promise<boolean> {
    setFormError(null);
    try {
      await startDownload({
        id: crypto.randomUUID(),
        url: targetUrl,
        format: targetFormat,
        no_playlist: noPlaylist,
        ...options,
      });
      return true;
    } catch (error) {
      setFormError(getDownloadErrorMessage(error, "Could not start the download."));
      return false;
    }
  }

  /** Inspects a link only to select the correct playlist prompt. */
  async function handleStartDownload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!url.trim() || isChecking) return;
    const targetUrl = url.trim();
    const targetFormat = format;
    const parsedStart = parseOptionalItemNumber(playlistStart);
    const parsedEnd = parseOptionalItemNumber(playlistEnd);
    if (
      (playlistStart.trim() && parsedStart === null) ||
      (playlistEnd.trim() && parsedEnd === null)
    ) {
      setFormError("Collection item numbers must start at 1.");
      return;
    }
    if (parsedStart !== null && parsedEnd !== null && parsedStart > parsedEnd) {
      setFormError("Collection start must not be after its end.");
      return;
    }
    const options: DownloadOptions = {
      quality,
      video_container: videoContainer,
      audio_format: audioFormat,
      subtitle_mode: targetFormat === "best" ? subtitleMode : "none",
      subtitle_languages:
        targetFormat === "best" && subtitleMode === "selected"
          ? Array.from(
              new Set(
                subtitleLanguages
                  .split(",")
                  .map((language) => language.trim())
                  .filter(Boolean),
              ),
            )
          : [],
      playlist_start: parsedStart,
      playlist_end: parsedEnd,
    };
    setIsChecking(true);
    setFormError(null);
    try {
      const inspection = await inspectDownloadUrl(targetUrl);
      if (inspection.is_collection) {
        setPendingDownload({
          url: targetUrl,
          format: targetFormat,
          options,
          inspection,
        });
      } else {
        const started = await triggerDownload(
          targetUrl,
          targetFormat,
          true,
          options,
        );
        if (started) setUrl("");
      }
    } catch (error) {
      setFormError(
        getDownloadErrorMessage(error, "Could not inspect this media URL."),
      );
    } finally {
      setIsChecking(false);
    }
  }

  /** Resolves the collection modal while preserving the inspected advanced options. */
  async function handleCollectionSelection(downloadCollection: boolean) {
    if (!pendingDownload) return;
    const selected = pendingDownload;
    setPendingDownload(null);
    const started = await triggerDownload(
      selected.url,
      selected.format,
      false,
      downloadCollection
        ? selected.options
        : {
            ...selected.options,
            playlist_start: 1,
            playlist_end: 1,
          },
    );
    if (started) setUrl("");
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
          Download <span className="text-brand-light">media</span>
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
              placeholder="Paste a public media or collection URL..."
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
                <LoaderCircle size={16} className="animate-spin" />
              ) : (
                <Download size={16} />
              )}
              <span>Download</span>
            </button>
          </div>
          {formError && <p className="text-sm text-red-400">{formError}</p>}
        </div>
        <details className="group border-t border-white/5 pt-4">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200">
            <ChevronDown
              size={16}
              className="transition-transform group-open:rotate-180"
            />
            Advanced options
          </summary>
          <div className="grid grid-cols-1 gap-4 pt-4 md:grid-cols-2">
            {format === "best" ? (
              <>
                <AdvancedSelect
                  label="Maximum quality"
                  value={quality}
                  onChange={(value) => setQuality(value as DownloadQuality)}
                  options={[
                    { value: "best", label: "Best available (default)" },
                    { value: "2160p", label: "Up to 4K" },
                    { value: "1440p", label: "Up to 1440p" },
                    { value: "1080p", label: "Up to 1080p" },
                    { value: "720p", label: "Up to 720p" },
                    { value: "480p", label: "Up to 480p" },
                    { value: "360p", label: "Up to 360p" },
                  ]}
                />
                <AdvancedSelect
                  label="Video container"
                  value={videoContainer}
                  onChange={(value) =>
                    setVideoContainer(value as VideoContainer)
                  }
                  options={[
                    { value: "auto", label: "Automatic (default)" },
                    { value: "mp4", label: "MP4" },
                    { value: "mkv", label: "MKV" },
                    { value: "webm", label: "WebM" },
                  ]}
                />
                <AdvancedSelect
                  label="Subtitles"
                  value={subtitleMode}
                  onChange={(value) => setSubtitleMode(value as SubtitleMode)}
                  options={[
                    { value: "none", label: "None (default)" },
                    { value: "selected", label: "Selected languages" },
                    { value: "all", label: "All available" },
                  ]}
                />
                {subtitleMode === "selected" && (
                  <AdvancedInput
                    label="Subtitle languages"
                    value={subtitleLanguages}
                    onChange={setSubtitleLanguages}
                    placeholder="For example: en, bn"
                  />
                )}
              </>
            ) : (
              <AdvancedSelect
                label="Audio format"
                value={audioFormat}
                onChange={(value) => setAudioFormat(value as AudioFormat)}
                options={[
                  { value: "original", label: "Original quality (default)" },
                  { value: "mp3", label: "MP3" },
                  { value: "m4a", label: "M4A" },
                  { value: "opus", label: "Opus" },
                  { value: "flac", label: "FLAC" },
                  { value: "wav", label: "WAV" },
                ]}
              />
            )}
            <AdvancedInput
              label="Collection start (optional)"
              value={playlistStart}
              onChange={setPlaylistStart}
              type="number"
              min="1"
              placeholder="First item"
            />
            <AdvancedInput
              label="Collection end (optional)"
              value={playlistEnd}
              onChange={setPlaylistEnd}
              type="number"
              min="1"
              placeholder="Last item"
            />
          </div>
        </details>
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
            showFileExtensions={settings.library.showFileExtensions}
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

      <CollectionDownloadModal
        isOpen={pendingDownload !== null}
        inspection={pendingDownload?.inspection ?? null}
        onClose={() => setPendingDownload(null)}
        onSelect={(downloadCollection) =>
          void handleCollectionSelection(downloadCollection)
        }
      />
    </div>
  );
}

/** Converts an optional positive item field into the nullable backend shape. */
function parseOptionalItemNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Preserves useful Tauri string failures instead of replacing them with generic copy. */
function getDownloadErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

/** Labels Navio's shared Select for the compact advanced-options grid. */
function AdvancedSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-2 text-sm text-zinc-450">
      <span>{label}</span>
      <Select value={value} options={options} onChange={onChange} />
    </label>
  );
}

/** Renders one validated text or numeric advanced option. */
function AdvancedInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  min,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: "text" | "number";
  min?: string;
}) {
  return (
    <label className="space-y-2 text-sm text-zinc-450">
      <span>{label}</span>
      <input
        type={type}
        min={min}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-white/5 bg-black/40 px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:border-brand/40 focus:outline-none"
      />
    </label>
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

/** Prompts for full-collection or first-item behavior after metadata inspection. */
function CollectionDownloadModal({
  isOpen,
  inspection,
  onClose,
  onSelect,
}: {
  isOpen: boolean;
  inspection: DownloadInspection | null;
  onClose: () => void;
  onSelect: (downloadCollection: boolean) => void;
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
        <h3 className="text-xl font-medium text-zinc-200">
          Collection detected
        </h3>
        <p className="text-sm text-zinc-400 leading-relaxed font-normal">
          {inspection?.title ?? "This link"}
          {inspection?.item_count ? ` contains ${inspection.item_count} items.` : " contains multiple items."}{" "}
          What would you like to download?
        </p>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => onSelect(true)}
            className="w-full text-left px-4 py-3 bg-brand/10 hover:bg-brand/20 border border-brand/35 text-brand-light rounded-xl transition-all font-medium cursor-pointer"
          >
            Download entire collection
          </button>
          <button
            onClick={() => onSelect(false)}
            className="w-full text-left px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/5 text-zinc-200 rounded-xl transition-all font-medium cursor-pointer"
          >
            Download first item only
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
  showFileExtensions,
  onAction,
  onOpenFolder,
}: {
  item: DownloadJob;
  pending: boolean;
  showFileExtensions: boolean;
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
      ? `[${item.current_item}/${item.total_items}] ${getMediaDisplayName(item.title, showFileExtensions)}`
      : getMediaDisplayName(item.title, showFileExtensions);
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
