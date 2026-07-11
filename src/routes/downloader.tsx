import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { Select } from "../components/Select";
import {
  Download,
  X,
  Folder,
  AlertTriangle,
  CheckCircle2,
  Play,
} from "lucide-react";

export const Route = createFileRoute("/downloader")({
  component: DownloaderView,
});

interface DownloadItem {
  id: string;
  url: string;
  title: string;
  progress: number;
  speed: string;
  eta: string;
  status: "downloading" | "completed" | "failed";
  format: string;
  size: string;
}

function DownloaderView() {
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState("best");
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [activeTab, setActiveTab] = useState<"all" | "active" | "history">(
    "all",
  );
  const [isChecking, setIsChecking] = useState(false);
  const [pendingDownload, setPendingDownload] = useState<{
    url: string;
    format: string;
  } | null>(null);
  const urlRef = useRef(url);
  const formatRef = useRef(format);

  useEffect(() => {
    urlRef.current = url;
  }, [url]);

  useEffect(() => {
    formatRef.current = format;
  }, [format]);

  // Load download cards history from localStorage on mount (client-side only)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("navio_downloads");
      if (saved) {
        try {
          setDownloads(JSON.parse(saved));
        } catch (e) {
          console.warn("Failed to parse downloads history:", e);
        }
      }
    }
  }, []);

  // Save download cards history to localStorage on updates
  useEffect(() => {
    if (downloads.length > 0) {
      localStorage.setItem("navio_downloads", JSON.stringify(downloads));
    }
  }, [downloads]);

  // Subscribe to live download progress events from the Rust backend
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;

    const setupListener = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const unlisten = await listen<{
          id: string;
          url: string;
          title: string;
          progress: number;
          speed: string;
          eta: string;
          size: string;
          status: "downloading" | "completed" | "failed";
        }>("download-progress", (event) => {
          const payload = event.payload;

          setDownloads((prev) => {
            const idx = prev.findIndex((d) => d.id === payload.id);
            if (idx !== -1) {
              const updated = [...prev];
              updated[idx] = {
                ...updated[idx],
                title: payload.title || updated[idx].title,
                progress: Math.round(payload.progress),
                speed: payload.speed,
                eta: payload.eta,
                size: payload.size !== "—" ? payload.size : updated[idx].size,
                status: payload.status,
              };
              return updated;
            } else {
              const currentFormat = formatRef.current;
              const formatLabel =
                currentFormat === "bestaudio" ? "Audio" : "Video";
              const newItem: DownloadItem = {
                id: payload.id,
                url: payload.url || urlRef.current,
                title: payload.title || "Preparing download...",
                progress: Math.round(payload.progress),
                speed: payload.speed,
                eta: payload.eta,
                status: payload.status,
                format: formatLabel,
                size: payload.size,
              };
              return [newItem, ...prev];
            }
          });
        });
        unlistenFn = unlisten;
      } catch (err) {
        console.warn("Failed to subscribe to download events:", err);
      }
    };

    setupListener();

    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, []);

  // Helper to initiate download with the backend Tauri command
  const triggerDownload = async (
    targetUrl: string,
    targetFormat: string,
    noPlaylist: boolean,
  ) => {
    const downloadId = `dl-${Date.now()}`;
    const formatLabel = targetFormat === "bestaudio" ? "Audio" : "Video";

    const newItem: DownloadItem = {
      id: downloadId,
      url: targetUrl,
      title: "Preparing download...",
      progress: 0,
      speed: "Starting...",
      eta: "—",
      status: "downloading",
      format: formatLabel,
      size: "—",
    };

    setDownloads((prev) => [newItem, ...prev]);

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("start_download", {
        id: downloadId,
        url: targetUrl,
        format: targetFormat,
        noPlaylist,
      });
    } catch (err) {
      console.error("Failed to start download:", err);
      setDownloads((prev) =>
        prev.map((d) =>
          d.id === downloadId
            ? {
                ...d,
                status: "failed",
                speed: "Failed",
                title: "Could not start download.",
              }
            : d,
        ),
      );
    }
  };

  // Start download via backend Tauri command
  const handleStartDownload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || isChecking) return;

    setIsChecking(true);
    const targetUrl = url;
    const targetFormat = format;
    setUrl("");

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const res = await invoke<{ is_playlist: boolean; has_video: boolean }>(
        "check_url_type",
        { url: targetUrl },
      );

      if (res.is_playlist && res.has_video) {
        setPendingDownload({ url: targetUrl, format: targetFormat });
      } else if (res.is_playlist && !res.has_video) {
        await triggerDownload(targetUrl, targetFormat, false);
      } else {
        await triggerDownload(targetUrl, targetFormat, true);
      }
    } catch (err) {
      console.error("Failed to check URL type:", err);
      // Fallback: download as single video
      await triggerDownload(targetUrl, targetFormat, true);
    } finally {
      setIsChecking(false);
    }
  };

  const handleDeleteItem = (id: string) => {
    const updated = downloads.filter((item) => item.id !== id);
    setDownloads(updated);
    if (updated.length === 0) {
      localStorage.removeItem("navio_downloads");
    } else {
      localStorage.setItem("navio_downloads", JSON.stringify(updated));
    }
  };

  // Open the download destination directory in explorer
  const handleOpenFolder = async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_folder");
    } catch (err) {
      console.error("Failed to open downloads folder:", err);
    }
  };

  const filteredDownloads = downloads.filter((item) => {
    if (activeTab === "active") return item.status === "downloading";
    if (activeTab === "history")
      return item.status === "completed" || item.status === "failed";
    return true;
  });

  return (
    <div className="max-w-5xl mx-auto font-medium select-none text-zinc-450">
      {/* Top Header */}
      <div>
        <h1 className="text-4xl font-medium text-zinc-200 tracking-tight mb-20">
          Download from <span className="text-brand-light">YouTube</span>
        </h1>
      </div>

      {/* URL Input Form Card */}
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
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste YouTube, Vimeo, or generic video stream link..."
              className="flex-1 bg-black/40 border border-white/5 rounded-lg px-4 py-2.5 text-base text-zinc-200 focus:outline-none focus:border-brand/40 placeholder-zinc-550 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <div className="w-full md:w-64 shrink-0">
              <Select
                options={[
                  {
                    value: "best",
                    label: "Video",
                  },
                  { value: "bestaudio", label: "Audio" },
                ]}
                value={format}
                onChange={setFormat}
                disabled={isChecking}
              />
            </div>
            <button
              type="submit"
              disabled={isChecking}
              className="flex items-center justify-center gap-2 px-6 py-2.5 bg-brand hover:bg-brand-light text-zinc-200 rounded-lg text-base transition-all font-medium shadow-lg shadow-brand-glow cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isChecking ? (
                <>
                  <span className="w-4.5 h-4.5 border-2 border-white/20 border-t-white rounded-full animate-spin"></span>
                  <span>Checking...</span>
                </>
              ) : (
                <>
                  <Download size={16} />
                  <span>Download</span>
                </>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* Tabs & Filters */}
      <div className="relative z-10 flex justify-between items-center border-b border-white/5 pb-2 mb-6">
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
            Active ({downloads.filter((d) => d.status === "downloading").length}
            )
          </TabButton>
          <TabButton
            active={activeTab === "history"}
            onClick={() => setActiveTab("history")}
          >
            Completed (
            {downloads.filter((d) => d.status !== "downloading").length})
          </TabButton>
        </div>
      </div>

      {/* Downloads List */}
      <div className="relative z-10 space-y-4">
        {filteredDownloads.map((item) => (
          <DownloadCard
            key={item.id}
            item={item}
            onOpenFolder={handleOpenFolder}
            onDeleteItem={handleDeleteItem}
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
          if (pendingDownload) {
            triggerDownload(
              pendingDownload.url,
              pendingDownload.format,
              !downloadPlaylist,
            );
            setPendingDownload(null);
          }
        }}
      />
    </div>
  );
}

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
      className={`pb-2 text-sm font-medium transition-all border-b-2 cursor-pointer ${
        active
          ? "border-brand text-brand-light font-medium"
          : "border-transparent text-zinc-450 hover:text-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}

interface PlaylistDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (downloadPlaylist: boolean) => void;
}

function PlaylistDownloadModal({
  isOpen,
  onClose,
  onSelect,
}: PlaylistDownloadModalProps) {
  return (
    <div
      onClick={onClose}
      className={`fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 select-none transition-opacity duration-200 ${
        isOpen
          ? "opacity-100 pointer-events-auto"
          : "opacity-0 pointer-events-none"
      }`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-md bg-zinc-950/30 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-2xl space-y-5 transition-all duration-200 transform ${
          isOpen ? "scale-100 opacity-100" : "scale-95 opacity-0"
        }`}
      >
        <h3 className="text-xl font-medium text-zinc-200">Playlist Detected</h3>
        <p className="text-sm text-zinc-400 leading-relaxed font-normal">
          This link contains both a single video and a playlist. How would you
          like to download it?
        </p>

        <div className="flex flex-col gap-3">
          <button
            onClick={() => onSelect(true)}
            className="w-full flex items-center justify-between px-4 py-3 bg-brand/10 hover:bg-brand/20 border border-brand/35 hover:border-brand/60 text-brand-light rounded-xl transition-all font-medium cursor-pointer"
          >
            <div className="flex flex-col items-start">
              <span className="text-sm font-medium text-zinc-200">
                Download entire playlist
              </span>
              <span className="text-xs text-zinc-500 font-normal mt-0.5">
                Downloads all tracks in this playlist
              </span>
            </div>
          </button>

          <button
            onClick={() => onSelect(false)}
            className="w-full flex items-center justify-between px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 text-zinc-200 rounded-xl transition-all font-medium cursor-pointer"
          >
            <div className="flex flex-col items-start">
              <span className="text-sm font-medium text-zinc-200">
                Download single video
              </span>
              <span className="text-xs text-zinc-500 font-normal mt-0.5">
                Downloads only the selected video
              </span>
            </div>
          </button>
        </div>

        <div className="flex justify-end pt-2 border-t border-white/5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-zinc-450 hover:text-zinc-200 transition-colors cursor-pointer font-medium"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

interface DownloadCardProps {
  item: DownloadItem;
  onOpenFolder: () => void;
  onDeleteItem: (id: string) => void;
}

function DownloadCard({ item, onOpenFolder, onDeleteItem }: DownloadCardProps) {
  const prevProgressRef = useRef(item.progress);
  const [useTransition, setUseTransition] = useState(true);

  useEffect(() => {
    if (item.progress < prevProgressRef.current) {
      // Progress decreased (reset), disable transition temporarily
      setUseTransition(false);
      const timer = setTimeout(() => {
        setUseTransition(true);
      }, 50);
      prevProgressRef.current = item.progress;
      return () => clearTimeout(timer);
    }
    prevProgressRef.current = item.progress;
  }, [item.progress]);

  return (
    <div className="bg-panel-bg/20 backdrop-blur-md border border-white/5 rounded-xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 group transition-all">
      {/* Left side info */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          {item.status === "downloading" && (
            <span className="w-2 h-2 rounded-full bg-yellow-500 animate-ping"></span>
          )}
          {item.status === "completed" && (
            <CheckCircle2 size={15} className="text-green-500" />
          )}
          {item.status === "failed" && (
            <AlertTriangle size={15} className="text-red-500" />
          )}
          <span
            className={`text-sm uppercase font-medium ${
              item.status === "downloading"
                ? "text-yellow-500"
                : item.status === "completed"
                  ? "text-green-500"
                  : "text-red-500"
            }`}
          >
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
          {item.title}
        </h3>

        {/* Progress bar info for downloading */}
        {item.status === "downloading" && (
          <div className="w-full flex items-center gap-3 pt-2">
            <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className={`h-full bg-brand rounded-full ${
                  useTransition
                    ? "transition-all duration-300"
                    : "transition-none"
                }`}
                style={{ width: `${item.progress}%` }}
              ></div>
            </div>
            <span className="text-xs text-zinc-400 shrink-0 w-10 text-right font-medium">
              {item.progress}%
            </span>
          </div>
        )}
      </div>

      {/* Right side diagnostics / actions */}
      <div className="flex items-center gap-6 shrink-0 self-stretch md:self-auto justify-between md:justify-end border-t md:border-t-0 border-white/5 pt-3 md:pt-0">
        <div className="flex gap-4 text-2xs text-zinc-500 font-medium">
          {item.status === "downloading" && (
            <>
              <div className="flex flex-col">
                <span className="text-xs text-zinc-500 font-medium">Speed</span>
                <span className="text-sm text-zinc-300 mt-0.5">
                  {item.speed}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs text-zinc-500 font-medium">ETA</span>
                <span className="text-sm text-zinc-300 mt-0.5">{item.eta}</span>
              </div>
            </>
          )}
          <div className="flex flex-col">
            <span className="text-xs text-zinc-500 font-medium">Format</span>
            <span className="text-sm text-zinc-300 mt-0.5">{item.format}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-zinc-500 font-medium">Size</span>
            <span className="text-sm text-zinc-300 mt-0.5">{item.size}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {item.status === "completed" && (
            <>
              <button
                title="Play track (Please play from My Library)"
                className="p-2 bg-white/5 opacity-50 cursor-not-allowed rounded-lg text-zinc-500"
              >
                <Play size={14} fill="currentColor" />
              </button>
              <button
                onClick={onOpenFolder}
                title="Open Downloads folder"
                className="p-2 bg-white/5 hover:bg-white/10 rounded-lg text-zinc-450 hover:text-zinc-200 transition-colors cursor-pointer"
              >
                <Folder size={14} />
              </button>
            </>
          )}
          <button
            onClick={() => onDeleteItem(item.id)}
            title="Remove from history"
            className="p-2 bg-white/5 hover:bg-red-950/20 hover:text-red-400 rounded-lg text-zinc-500 transition-colors cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
