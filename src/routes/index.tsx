import { createFileRoute, Link } from "@tanstack/react-router";
import {
  FolderPlus,
  Download,
  Plus,
  Music,
  Play,
  Clock,
  Film,
  ListMusic,
  History,
  TrendingUp,
  ChevronRight,
} from "lucide-react";
import { usePlayerStore } from "../store/playerStore";
import { useLibrary } from "../hooks/useLibrary";
import { getTrackDisplayName } from "../lib/mediaLabels";
import { useSettingsStore } from "../store/settingsStore";
import {
  getWatchProgress,
  type MediaActivity,
  type SmartPlaylist,
} from "../lib/smartPlaylists";
import type { Track } from "../store/playerStore";

export const Route = createFileRoute("/")({
  component: DashboardView,
});

function DashboardView() {
  const { playTrack, setDrawerOpen, setPlaylist } = usePlayerStore();
  const { settings } = useSettingsStore();
  const { stats, smartPlaylists, activity } = useLibrary();

  /** Starts one smart collection using its derived ordering as the queue. */
  function playSmartTrack(track: Track, queue: Track[]) {
    playTrack(track, queue);
    setDrawerOpen(true);
  }

  /** Loads a generated collection into the standard Now Playing sidebar. */
  function openSmartPlaylist(playlist: SmartPlaylist) {
    setPlaylist(playlist.tracks);
    setDrawerOpen(true);
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto font-medium select-none">
      <h1 className="text-2xl sm:text-3xl md:text-4xl font-medium text-zinc-200 tracking-tight mb-8 sm:mb-12 md:mb-16">
        Welcome to <span className="text-brand-light">Navio Player</span>
      </h1>

      {/* Library Metrics Stats Card Row */}
      <div className="grid grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          to="/library"
          icon={<Music className="w-4 h-4 md:w-4.5 md:h-4.5 shrink-0" />}
          count={stats.audioCount}
          label="Audio tracks"
        />
        <StatCard
          to="/library"
          icon={<Film className="w-4 h-4 md:w-4.5 md:h-4.5 shrink-0" />}
          count={stats.videoCount}
          label="Video files"
        />
        <StatCard
          to="/playlists"
          icon={<ListMusic className="w-4 h-4 md:w-4.5 md:h-4.5 shrink-0" />}
          count={stats.playlistCount}
          label="Playlists"
        />
        <StatCard
          to="/library"
          icon={<FolderPlus className="w-4 h-4 md:w-4.5 md:h-4.5 shrink-0" />}
          count={stats.scannedFolders}
          label="Folders indexed"
        />
      </div>

      {/* Toolbar: Large Action Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <ToolbarCard
          to="/library"
          icon={<FolderPlus className="text-brand-light" size={20} />}
          title="Scan folders"
        />
        <ToolbarCard
          to="/downloader"
          icon={<Download className="text-brand-light" size={20} />}
          title="Download stream"
        />
        <ToolbarCard
          to="/playlists"
          icon={<Plus className="text-brand-light" size={20} />}
          title="Create playlist"
          className="sm:col-span-2 lg:col-span-1"
        />
      </div>

      <div className="space-y-8 pt-4">
        {smartPlaylists
          .filter((playlist) => playlist.tracks.length > 0)
          .map((playlist) => (
            <SmartCollectionSection
              key={playlist.id}
              playlist={playlist}
              activity={activity}
              showFileExtensions={settings.library.showFileExtensions}
              onOpen={() => openSmartPlaylist(playlist)}
              onPlay={(track) => playSmartTrack(track, playlist.tracks)}
            />
          ))}
      </div>
    </div>
  );
}

/** Renders one non-empty Home collection with a compact five-item preview. */
function SmartCollectionSection({
  playlist,
  activity,
  showFileExtensions,
  onOpen,
  onPlay,
}: {
  playlist: SmartPlaylist;
  activity: Record<string, MediaActivity>;
  showFileExtensions: boolean;
  onOpen: () => void;
  onPlay: (track: Track) => void;
}) {
  const Icon =
    playlist.id === "continue-watching"
      ? Film
      : playlist.id === "recently-played"
        ? History
        : playlist.id === "most-played"
          ? TrendingUp
          : Clock;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-4 px-1">
        <h2 className="flex items-center gap-2 text-lg font-medium text-zinc-300">
          <Icon size={16} className="text-brand-light" />
          {playlist.name}
        </h2>
        <button
          type="button"
          onClick={onOpen}
          className="flex items-center gap-1 text-xs font-medium text-zinc-500 transition-colors hover:text-brand-light cursor-pointer"
        >
          See all <ChevronRight size={14} />
        </button>
      </div>

      <div className="space-y-1">
        {playlist.tracks.slice(0, 5).map((track) => {
          const progress = getWatchProgress(track, activity);
          return (
            <button
              key={track.id}
              type="button"
              onClick={() => onPlay(track)}
              className="group flex w-full items-center justify-between gap-4 rounded-lg border border-transparent p-3 text-left transition-colors hover:border-white/5 hover:bg-white/5 cursor-pointer sm:p-4"
            >
              <span className="flex min-w-0 items-center gap-3 sm:gap-4">
                <span className="relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded bg-white/5 sm:h-11 sm:w-11">
                  {track.media_type === "video" ? (
                    <Film size={16} className="text-purple-400 group-hover:opacity-0" />
                  ) : (
                    <Music size={16} className="text-emerald-400 group-hover:opacity-0" />
                  )}
                  <span className="absolute inset-0 grid place-items-center bg-brand opacity-0 transition-opacity group-hover:opacity-100">
                    <Play size={14} fill="currentColor" className="text-white" />
                  </span>
                  {playlist.id === "continue-watching" && (
                    <span className="absolute inset-x-0 bottom-0 h-0.5 bg-white/15">
                      <span
                        className="block h-full bg-brand-light"
                        style={{ width: `${progress}%` }}
                      />
                    </span>
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-zinc-200 sm:text-base">
                    {getTrackDisplayName(track, showFileExtensions)}
                  </span>
                  {playlist.id === "continue-watching" && (
                    <span className="text-xs text-zinc-600">{Math.round(progress)}% watched</span>
                  )}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-xs text-zinc-500 sm:text-sm">
                <Clock size={14} /> {formatTime(track.duration_secs)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function StatCard({
  to,
  icon,
  count,
  label,
}: {
  to: string;
  icon: React.ReactNode;
  count: number;
  label: string;
}) {
  return (
    <Link
      to={to}
      className="bg-panel-bg/20 hover:bg-panel-bg/35 border border-white/5 hover:border-brand/40 p-2 sm:p-3 lg:p-4 rounded-xl flex items-center gap-2 sm:gap-3 lg:gap-4 transition-all duration-200 cursor-pointer group shadow-md min-w-0 w-full"
    >
      <div className="p-1.5 sm:p-2 lg:p-3 bg-brand/5 border border-brand/30 rounded-lg text-brand-light shrink-0">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs sm:text-sm md:text-base lg:text-lg font-medium text-zinc-200 leading-none truncate">
          {count}
        </div>
        <div
          className="text-[10px] sm:text-xs md:text-sm text-zinc-400 mt-1 lg:mt-1.5 font-medium truncate"
          title={label}
        >
          {label}
        </div>
      </div>
    </Link>
  );
}

function ToolbarCard({
  to,
  icon,
  title,
  className = "",
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={`bg-panel-bg/20 hover:bg-panel-bg/40 border-2 border-white/5 hover:border-brand/40 p-3 sm:p-4 md:p-6 rounded-2xl flex items-center gap-3 sm:gap-4 md:gap-5 transition-all duration-200 cursor-pointer shadow-md ${className}`}
    >
      <div className="p-2 sm:p-2.5 md:p-3 bg-brand/10 border border-brand/20 rounded-xl shrink-0">
        {icon}
      </div>
      <h3
        className="text-xs sm:text-sm md:text-base lg:text-lg xl:text-xl font-medium text-zinc-200 truncate"
        title={title}
      >
        {title}
      </h3>
    </Link>
  );
}

/** Formats dashboard durations as compact, human-readable units. */
function formatTime(secs: number): string {
  if (!Number.isFinite(secs) || secs <= 0) return "0s";

  const totalSeconds = Math.floor(secs);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  return `${seconds}s`;
}
