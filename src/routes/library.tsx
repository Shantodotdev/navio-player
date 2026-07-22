import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { usePlayerStore, type Track } from "../store/playerStore";
import { useLibrary } from "../hooks/useLibrary";
import {
  FolderPlus,
  Search,
  Play,
  Music,
  Film,
  Trash2,
  X,
  Grid2X2,
  List,
} from "lucide-react";
import { buildStreamUrl } from "../lib/theaterMedia";
import { getTrackDisplayName } from "../lib/mediaLabels";
import { useSettingsStore } from "../store/settingsStore";
import { toast } from "../store/toastStore";
import { getErrorMessage } from "../lib/errorMessage";

export const Route = createFileRoute("/library")({
  component: LibraryView,
});

/** Renders the searchable local media catalog and its list/grid presentations. */
function LibraryView() {
  const { playTrack, streamPort, streamToken } = usePlayerStore();
  const { tracks, scannedDirs, addFolder, deleteFolder } = useLibrary();
  const {
    settings,
    isLoaded: settingsLoaded,
    updateSettings,
  } = useSettingsStore();

  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "audio" | "video">(
    "all",
  );
  const [selectedDirectory, setSelectedDirectory] = useState<string | null>(
    null,
  );
  const [viewMode, setViewMode] = useState<"list" | "grid">(
    settings.library.viewMode,
  );

  /** Scans a selected folder and exposes a retry only when the operation fails. */
  async function handleAddFolder() {
    try {
      await addFolder();
    } catch (error) {
      toast.error("Could not add folder", {
        description: getErrorMessage(
          error,
          "Navio could not scan that folder.",
        ),
        dedupeKey: "library-add-folder",
        action: { label: "Retry", run: handleAddFolder },
      });
    }
  }

  /** Removes one watched folder while keeping failures recoverable. */
  async function handleDeleteFolder(folder: string) {
    try {
      await deleteFolder(folder);
    } catch (error) {
      toast.error("Could not remove folder", {
        description: getErrorMessage(
          error,
          "Navio could not update your library.",
        ),
        dedupeKey: `library-delete-folder:${folder}`,
        action: { label: "Retry", run: () => handleDeleteFolder(folder) },
      });
    }
  }

  useEffect(() => {
    if (settingsLoaded) setViewMode(settings.library.viewMode);
  }, [settings.library.viewMode, settingsLoaded]);

  const filteredTracks = tracks.filter((t) => {
    const query = searchQuery.toLowerCase();
    const matchesSearch =
      t.name.toLowerCase().includes(query) ||
      (t.title && t.title.toLowerCase().includes(query)) ||
      t.path.toLowerCase().includes(query);

    const matchesFilter = filterType === "all" || t.media_type === filterType;
    const matchesDirectory =
      !selectedDirectory || isPathWithinDirectory(t.path, selectedDirectory);

    return matchesSearch && matchesFilter && matchesDirectory;
  });

  return (
    <div className="space-y-6 max-w-6xl mx-auto font-medium select-none text-zinc-400 min-w-0">
      {/* Top Header Section */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8 sm:mb-12 md:mb-16">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-medium text-zinc-200 tracking-tight">
            Media library
          </h1>
        </div>

        <div className="flex gap-3 shrink-0">
          <button
            onClick={() => void handleAddFolder()}
            className="flex items-center gap-2 px-3.5 py-2 sm:px-4.5 sm:py-2.5 bg-brand hover:bg-brand-light text-zinc-200 rounded-lg sm:rounded-xl text-xs sm:text-sm transition-all font-medium shadow-lg shadow-brand-glow cursor-pointer"
          >
            <FolderPlus size={15} />
            <span>Add folder</span>
          </button>
        </div>
      </div>

      {scannedDirs.length === 0 ? (
        // Large Elegant Empty State Panel
        <div className="flex flex-col items-center justify-center py-16 sm:py-24 text-center space-y-5 bg-panel-bg/10 border border-white/5 rounded-2xl p-6 sm:p-8">
          <div className="p-4 sm:p-5 bg-brand/5 border border-brand/10 rounded-full text-brand-light shadow-lg shadow-brand-glow">
            <FolderPlus size={28} />
          </div>
          <div className="space-y-2">
            <h2 className="text-base sm:text-lg font-medium text-zinc-200">
              Your media library is empty
            </h2>
            <p className="text-xs sm:text-sm text-zinc-400 max-w-md leading-relaxed font-medium">
              Select "Add folder" above to index your local directory folders
              and start cataloging your music and videos.
            </p>
          </div>
        </div>
      ) : (
        // Normal Scanned folders list + Search & Filters + Tracks Table
        <>
          {/* Scanned Folder List card */}
          <div className="bg-panel-bg/30 backdrop-blur-md rounded-xl sm:rounded-2xl border border-white/5 p-4 sm:p-5 md:p-6 mb-6 sm:mb-8 md:mb-10">
            <h2 className="text-xs sm:text-base font-medium text-zinc-400 mb-3 sm:mb-3.5">
              Scanned directories
            </h2>
            <div className="flex flex-wrap gap-2">
              {scannedDirs.map((dir) => (
                <div
                  key={dir}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedDirectory(dir)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedDirectory(dir);
                    }
                  }}
                  className={`flex items-center gap-2 border px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-lg text-xs sm:text-sm font-medium group cursor-pointer transition-colors max-w-full min-w-0 ${
                    selectedDirectory === dir
                      ? "bg-brand/20 border-brand/50 text-zinc-200"
                      : "bg-black/40 border-white/5 text-zinc-400 hover:border-brand/30 hover:text-zinc-200"
                  }`}
                >
                  <span className="truncate flex-1 min-w-0">{dir}</span>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      if (selectedDirectory === dir) setSelectedDirectory(null);
                      void handleDeleteFolder(dir);
                    }}
                    className="text-zinc-500 hover:text-red-400 transition-colors cursor-pointer shrink-0"
                    aria-label={`Remove ${dir} from library`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Filters & Search */}
          <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center mb-4 min-w-0">
            {selectedDirectory && (
              <button
                type="button"
                onClick={() => setSelectedDirectory(null)}
                className="flex items-center gap-1.5 shrink-0 rounded-lg border border-brand/30 bg-brand/10 px-2.5 py-1.5 text-xs text-brand-light hover:bg-brand/20 transition-colors cursor-pointer self-start md:self-auto"
              >
                <span className="max-w-56 sm:max-w-[18rem] truncate">
                  {selectedDirectory}
                </span>
                <X size={13} />
              </button>
            )}

            {/* Search */}
            <div className="flex-1 relative min-w-0">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-550"
              />
              <input
                id="library-search"
                type="text"
                placeholder="Search titles, filenames, or file paths..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-black/40 border border-white/5 rounded-lg py-2 pl-9 pr-4 text-xs sm:text-sm focus:outline-none focus:border-brand/40 text-zinc-200 placeholder-zinc-600 font-light"
              />
            </div>

            {/* Filter Categories */}
            <div className="flex bg-black/40 p-0.5 rounded-lg border border-white/5 shrink-0 font-medium self-stretch sm:self-auto justify-between sm:justify-start">
              <FilterButton
                active={filterType === "all"}
                onClick={() => setFilterType("all")}
              >
                All
              </FilterButton>
              <FilterButton
                active={filterType === "audio"}
                onClick={() => setFilterType("audio")}
              >
                Audio
              </FilterButton>
              <FilterButton
                active={filterType === "video"}
                onClick={() => setFilterType("video")}
              >
                Video
              </FilterButton>
            </div>

            {/* View Switcher */}
            <div className="flex bg-black/40 p-0.5 rounded-lg border border-white/5 shrink-0 font-medium self-end md:self-auto">
              <ViewButton
                active={viewMode === "list"}
                label="List view"
                onClick={() => {
                  setViewMode("list");
                  void updateSettings({ library: { viewMode: "list" } }).catch(
                    () => undefined,
                  );
                }}
              >
                <List size={14} />
              </ViewButton>
              <ViewButton
                active={viewMode === "grid"}
                label="Grid view"
                onClick={() => {
                  setViewMode("grid");
                  void updateSettings({ library: { viewMode: "grid" } }).catch(
                    () => undefined,
                  );
                }}
              >
                <Grid2X2 size={14} />
              </ViewButton>
            </div>
          </div>

          {viewMode === "grid" ? (
            <div className="grid grid-cols-1 min-[480px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {filteredTracks.map((track) => (
                <MediaCard
                  key={track.id}
                  track={track}
                  streamPort={streamPort}
                  streamToken={streamToken}
                  showThumbnails={settings.library.showThumbnails}
                  showFileExtensions={settings.library.showFileExtensions}
                  onPlay={() => playTrack(track, filteredTracks)}
                />
              ))}
              {filteredTracks.length === 0 && (
                <div className="col-span-full rounded-2xl border border-white/5 bg-panel-bg/20 p-12 text-center text-zinc-500 italic text-sm">
                  No files found matching search criteria.
                </div>
              )}
            </div>
          ) : (
            /* Tracks Table list */
            <div className="bg-panel-bg/20 backdrop-blur-md rounded-xl sm:rounded-2xl border border-white/5 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs sm:text-sm font-medium">
                  <thead>
                    <tr className="border-b border-white/5 text-zinc-450 text-[11px] sm:text-xs bg-white/1">
                      <th className="p-2 sm:p-3 w-10 text-center">Play</th>
                      <th className="p-2 sm:p-3">Title</th>
                      <th className="p-2 sm:p-3 w-20 sm:w-24">Type</th>
                      <th className="p-2 sm:p-3 w-20 sm:w-24">Size</th>
                      <th className="p-2 sm:p-3 w-20 sm:w-24">Length</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-zinc-400">
                    {filteredTracks.map((track) => (
                      <tr
                        key={track.id}
                        className="hover:bg-white/1 group transition-all duration-150 cursor-pointer"
                        onDoubleClick={() => playTrack(track, filteredTracks)}
                      >
                        <td className="p-2 sm:p-3 text-center">
                          <button
                            onClick={() => playTrack(track, filteredTracks)}
                            className="w-6 h-6 sm:w-7.5 sm:h-7.5 bg-brand/20 text-brand-light group-hover:bg-brand group-hover:text-zinc-200 rounded-full flex items-center justify-center transition-all shadow active:scale-90 cursor-pointer"
                          >
                            <Play
                              size={10}
                              fill="currentColor"
                              className="translate-x-[0.5px]"
                            />
                          </button>
                        </td>
                        <td className="p-2 sm:p-3 text-zinc-300 font-medium text-xs sm:text-sm truncate max-w-50 md:max-w-none">
                          {getTrackDisplayName(
                            track,
                            settings.library.showFileExtensions,
                          )}
                        </td>
                        <td className="p-2 sm:p-3">
                          <span className="flex items-center gap-1 text-[10px] sm:text-xs text-zinc-400 font-medium lowercase">
                            {track.media_type === "video" ? (
                              <Film size={13} className="text-purple-400" />
                            ) : (
                              <Music size={13} className="text-emerald-400" />
                            )}
                            <span>{track.media_type}</span>
                          </span>
                        </td>
                        <td className="p-2 sm:p-3 text-zinc-450 text-[10px] sm:text-xs">
                          {formatFileSize(track.file_size_bytes)}
                        </td>
                        <td className="p-2 sm:p-3 text-zinc-450 text-[10px] sm:text-xs">
                          {formatDuration(track.duration_secs)}
                        </td>
                      </tr>
                    ))}
                    {filteredTracks.length === 0 && (
                      <tr>
                        <td
                          colSpan={5}
                          className="p-12 text-center text-zinc-500 italic text-sm"
                        >
                          No files found matching search criteria.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface FilterButtonProps {
  active: boolean;
  children: string;
  onClick: () => void;
}

function FilterButton({ active, children, onClick }: FilterButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 text-xs sm:text-sm font-medium rounded-md transition-all cursor-pointer ${
        active
          ? "bg-brand text-zinc-200 shadow shadow-brand-glow"
          : "text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}

/** Formats media duration with an hour segment for long videos. */
function formatDuration(secs: number): string {
  if (!secs || Number.isNaN(secs)) return "0:00";
  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const seconds = Math.floor(secs % 60);
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
}

interface ViewButtonProps {
  active: boolean;
  children: ReactNode;
  label: string;
  onClick: () => void;
}

/** Renders one accessible button in the library list/grid view switcher. */
function ViewButton({ active, children, label, onClick }: ViewButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`p-1.5 rounded-md transition-all cursor-pointer ${
        active
          ? "bg-brand text-zinc-200 shadow shadow-brand-glow"
          : "text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}

interface MediaCardProps {
  track: Track;
  streamPort: number;
  streamToken: string;
  showThumbnails: boolean;
  showFileExtensions: boolean;
  onPlay: () => void;
}

/** Displays a media track as a visual card with a cached video still when available. */
function MediaCard({
  track,
  streamPort,
  streamToken,
  showThumbnails,
  showFileExtensions,
  onPlay,
}: MediaCardProps) {
  const [thumbnailPath, setThumbnailPath] = useState("");
  const isVideo = track.media_type === "video";
  const thumbnailUrl =
    thumbnailPath && streamPort > 0
      ? buildStreamUrl(streamPort, streamToken, thumbnailPath)
      : "";

  useEffect(() => {
    if (!isVideo || !showThumbnails) return;

    let cancelled = false;
    const loadThumbnail = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const thumbnailPath = await invoke<string>("get_video_thumbnail", {
          path: track.path,
        });
        if (!cancelled) setThumbnailPath(thumbnailPath);
      } catch {
        // Browser development and unsupported video files keep the film fallback.
        if (!cancelled) setThumbnailPath("");
      }
    };

    loadThumbnail();
    return () => {
      cancelled = true;
    };
  }, [isVideo, showThumbnails, track.path]);

  return (
    <article
      onDoubleClick={onPlay}
      className="group overflow-hidden rounded-xl sm:rounded-2xl border border-white/5 bg-panel-bg/30 transition-all hover:border-brand/30 hover:bg-panel-bg/50 cursor-pointer"
    >
      <div className="relative aspect-video overflow-hidden bg-black/40">
        {showThumbnails && thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt=""
            onError={() => setThumbnailPath("")}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-white/3">
            {isVideo ? (
              <Film size={26} className="text-purple-400/80" />
            ) : (
              <Music size={26} className="text-emerald-400/80" />
            )}
          </div>
        )}
        <button
          type="button"
          onClick={onPlay}
          aria-label={`Play ${track.title || track.name}`}
          className="absolute bottom-2.5 right-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-brand text-zinc-200 opacity-0 shadow-lg shadow-brand-glow transition-all group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-brand-light active:scale-90 cursor-pointer"
        >
          <Play size={12} fill="currentColor" className="translate-x-[0.5px]" />
        </button>
        <span className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-zinc-300">
          {formatDuration(track.duration_secs)}
        </span>
      </div>
      <div className="p-3 sm:p-4">
        <h3 className="truncate text-xs sm:text-sm font-medium text-zinc-200">
          {getTrackDisplayName(track, showFileExtensions)}
        </h3>
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] sm:text-xs text-zinc-500">
          <span className="flex min-w-0 items-center gap-1 lowercase">
            {isVideo ? (
              <Film size={12} className="shrink-0 text-purple-400" />
            ) : (
              <Music size={12} className="shrink-0 text-emerald-400" />
            )}
            <span className="truncate">{track.media_type}</span>
          </span>
          <span className="shrink-0">
            {formatFileSize(track.file_size_bytes)}
          </span>
        </div>
      </div>
    </article>
  );
}

function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return "—";
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const precision = size >= 10 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
}

function isPathWithinDirectory(
  filePath: string,
  directoryPath: string,
): boolean {
  const normalizedFilePath = filePath.replace(/[\\/]+$/, "").toLowerCase();
  const normalizedDirectoryPath = directoryPath
    .replace(/[\\/]+$/, "")
    .toLowerCase();

  return (
    normalizedFilePath === normalizedDirectoryPath ||
    normalizedFilePath.startsWith(`${normalizedDirectoryPath}\\`) ||
    normalizedFilePath.startsWith(`${normalizedDirectoryPath}/`)
  );
}
