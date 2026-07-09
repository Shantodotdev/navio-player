import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Select } from "../components/Select";
import {
  Download,
  RefreshCcw,
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

const MOCK_DOWNLOADS: DownloadItem[] = [
  {
    id: "dl-1",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    title: "Rick Astley - Never Gonna Give You Up (Official Video)",
    progress: 68,
    speed: "4.2 MB/s",
    eta: "0:12",
    status: "downloading",
    format: "video (1080p)",
    size: "32.4 MB",
  },
  {
    id: "dl-2",
    url: "https://www.youtube.com/watch?v=Starlight",
    title: "Muse - Starlight (Official Audio)",
    progress: 100,
    speed: "0 B/s",
    eta: "0:00",
    status: "completed",
    format: "audio (MP3)",
    size: "8.4 MB",
  },
  {
    id: "dl-3",
    url: "https://www.youtube.com/watch?v=failed",
    title: "Invalid Stream Link or Algorithm Change",
    progress: 23,
    speed: "0 B/s",
    eta: "—",
    status: "failed",
    format: "video (720p)",
    size: "—",
  },
];

function DownloaderView() {
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState("bestvideo+bestaudio");
  const [downloads, setDownloads] = useState<DownloadItem[]>(MOCK_DOWNLOADS);
  const [activeTab, setActiveTab] = useState<"all" | "active" | "history">(
    "all",
  );

  const handleStartDownload = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    const newItem: DownloadItem = {
      id: `dl-${Date.now()}`,
      url: url,
      title: url.replace("https://", "").substring(0, 40) + "...",
      progress: 0,
      speed: "Waiting...",
      eta: "—",
      status: "downloading",
      format: format === "bestaudio" ? "audio (MP3)" : "video (1080p)",
      size: "Pending...",
    };

    setDownloads((prev) => [newItem, ...prev]);
    setUrl("");
  };

  const handleDeleteItem = (id: string) => {
    setDownloads((prev) => prev.filter((item) => item.id !== id));
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
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste YouTube, Vimeo, or generic video stream link..."
              className="flex-1 bg-black/40 border border-white/5 rounded-lg px-4 py-2.5 text-base text-zinc-200 focus:outline-none focus:border-brand/40 placeholder-zinc-550 font-medium"
            />
            <div className="w-full md:w-64 shrink-0">
              <Select
                options={[
                  { value: "bestvideo+bestaudio", label: "Video (1080p HD)" },
                  {
                    value: "bestvideo[height<=720]+bestaudio",
                    label: "Video (720p HD)",
                  },
                  { value: "bestaudio", label: "Audio Extract (MP3)" },
                ]}
                value={format}
                onChange={setFormat}
              />
            </div>
            <button
              type="submit"
              className="flex items-center justify-center gap-2 px-6 py-2.5 bg-brand hover:bg-brand-light text-zinc-200 rounded-lg text-base transition-all font-medium shadow-lg shadow-brand-glow cursor-pointer"
            >
              <Download size={16} />
              <span>Download</span>
            </button>
          </div>
        </div>
      </form>

      {/* Tabs & Filters */}
      <div className="relative z-10 flex justify-between items-center border-b border-white/5 pb-2">
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
          <div
            key={item.id}
            className="bg-panel-bg/20 backdrop-blur-md border border-white/5 rounded-xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 group transition-all"
          >
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
                <span className="text-zinc-705">•</span>
                <span className="text-xs text-zinc-450 truncate max-w-50">
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
                      className="h-full bg-brand rounded-full transition-all duration-300"
                      style={{ width: `${item.progress}%` }}
                    ></div>
                  </div>
                  <span className="text-xs text-zinc-400 shrink-0 w-10 text-right">
                    {item.progress}%
                  </span>
                </div>
              )}
            </div>

            {/* Right side diagnostics / actions */}
            <div className="flex items-center gap-6 shrink-0 self-stretch md:self-auto justify-between md:justify-end border-t md:border-t-0 border-white/5 pt-3 md:pt-0">
              <div className="flex gap-4 text-2xs text-zinc-500">
                {item.status === "downloading" && (
                  <>
                    <div className="flex flex-col">
                      <span className="text-xs text-zinc-500 font-medium">
                        Speed
                      </span>
                      <span className="text-sm text-zinc-300 mt-0.5">
                        {item.speed}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs text-zinc-500 font-medium">
                        ETA
                      </span>
                      <span className="text-sm text-zinc-300 mt-0.5">
                        {item.eta}
                      </span>
                    </div>
                  </>
                )}
                <div className="flex flex-col">
                  <span className="text-xs text-zinc-500 font-medium">
                    Format
                  </span>
                  <span className="text-sm text-zinc-300 mt-0.5">
                    {item.format}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs text-zinc-500 font-medium">
                    Size
                  </span>
                  <span className="text-sm text-zinc-300 mt-0.5">
                    {item.size}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                {item.status === "completed" && (
                  <>
                    <button className="p-2 bg-white/5 hover:bg-white/10 rounded-lg text-zinc-450 hover:text-zinc-200 transition-colors cursor-pointer">
                      <Play size={14} fill="currentColor" />
                    </button>
                    <button className="p-2 bg-white/5 hover:bg-white/10 rounded-lg text-zinc-450 hover:text-zinc-200 transition-colors cursor-pointer">
                      <Folder size={14} />
                    </button>
                  </>
                )}
                {item.status === "failed" && (
                  <button className="p-2 bg-white/5 hover:bg-white/10 rounded-lg text-zinc-450 hover:text-zinc-200 transition-colors cursor-pointer">
                    <RefreshCcw size={14} />
                  </button>
                )}
                <button
                  onClick={() => handleDeleteItem(item.id)}
                  className="p-2 bg-white/5 hover:bg-red-950/20 hover:text-red-400 rounded-lg text-zinc-500 transition-colors cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {filteredDownloads.length === 0 && (
          <div className="p-12 text-center text-zinc-500 italic bg-panel-bg/10 border border-white/5 rounded-xl font-medium">
            No downloads in this category.
          </div>
        )}
      </div>
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
