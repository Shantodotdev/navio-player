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
} from "lucide-react";
import { usePlayerStore } from "../store/playerStore";
import { useLibrary } from "../hooks/useLibrary";

export const Route = createFileRoute("/")({
  component: DashboardView,
});

function DashboardView() {
  const { playTrack } = usePlayerStore();
  const { stats, recentTracks } = useLibrary();

  return (
    <div className="space-y-8 max-w-5xl mx-auto font-medium select-none">
      <h1 className="text-4xl font-medium text-zinc-200 tracking-tight mb-20">
        Welcome to <span className="text-brand-light">Navio Player</span>
      </h1>

      {/* Library Metrics Stats Card Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          to="/library"
          icon={<Music size={18} />}
          count={stats.audioCount}
          label="Audio tracks"
        />
        <StatCard
          to="/library"
          icon={<Film size={18} />}
          count={stats.videoCount}
          label="Video files"
        />
        <StatCard
          to="/playlists"
          icon={<ListMusic size={18} />}
          count={stats.playlistCount}
          label="Playlists"
        />
        <StatCard
          to="/library"
          icon={<FolderPlus size={18} />}
          count={stats.scannedFolders}
          label="Folders indexed"
        />
      </div>

      {/* Toolbar: Large Action Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ToolbarCard
          to="/library"
          icon={<FolderPlus className="text-brand-light" size={22} />}
          title="Scan folders"
        />
        <ToolbarCard
          to="/downloader"
          icon={<Download className="text-brand-light" size={22} />}
          title="Download stream"
        />
        <ToolbarCard
          to="/playlists"
          icon={<Plus className="text-brand-light" size={22} />}
          title="Create playlist"
        />
      </div>

      {/* Recently Added List (Full Width) */}
      <div className="space-y-4 pt-4">
        <h2 className="text-lg font-medium text-zinc-300 flex items-center gap-2 px-1">
          <Play size={16} className="text-brand-light" />
          <span>Recently added media</span>
        </h2>

        <div className="space-y-2">
          {recentTracks.map((track) => (
            <div
              key={track.id}
              onClick={() => playTrack(track, recentTracks)}
              className="flex items-center justify-between p-4 rounded-lg hover:bg-white/5 cursor-pointer group transition-colors border border-transparent hover:border-white/5 font-medium"
            >
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-11 h-11 rounded bg-white/5 flex items-center justify-center shrink-0 relative overflow-hidden">
                  {track.media_type === "video" ? (
                    <Film
                      size={16}
                      className="text-purple-400 group-hover:opacity-0"
                    />
                  ) : (
                    <Music
                      size={16}
                      className="text-emerald-400 group-hover:opacity-0"
                    />
                  )}
                  <div className="absolute inset-0 bg-brand opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <Play
                      size={14}
                      fill="currentColor"
                      className="text-zinc-200"
                    />
                  </div>
                </div>
                <div className="min-w-0">
                  <h4 className="text-base font-medium text-zinc-200 truncate">
                    {track.title || track.name}
                  </h4>
                </div>
              </div>

              <div className="flex items-center gap-5 shrink-0 text-sm text-zinc-450">
                <span className="px-2 py-0.5 text-xs rounded bg-white/5 border border-white/5 text-zinc-400 font-medium lowercase">
                  {track.media_type}
                </span>
                <div className="flex items-center gap-1 font-medium">
                  <Clock size={14} />
                  <span>{formatTime(track.duration_secs)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
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
      className="bg-panel-bg/20 hover:bg-panel-bg/35 border border-white/5 hover:border-brand/40 p-4.5 rounded-xl flex items-center gap-4.5 transition-all duration-200 cursor-pointer group shadow-md"
    >
      <div className="p-3 bg-brand/5 border border-brand/30 rounded-lg text-brand-light">
        {icon}
      </div>
      <div>
        <div className="text-lg font-medium text-zinc-200 leading-none">
          {count}
        </div>
        <div className="text-sm text-zinc-400 mt-1.5 font-medium">{label}</div>
      </div>
    </Link>
  );
}

function ToolbarCard({
  to,
  icon,
  title,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <Link
      to={to}
      className="bg-panel-bg/20 hover:bg-panel-bg/40 border-2 border-white/5 hover:border-brand/40 p-6 rounded-2xl flex items-center gap-5 transition-all duration-200 cursor-pointer shadow-md"
    >
      <div className="p-3 bg-brand/10 border border-brand/20 rounded-xl">
        {icon}
      </div>
      <h3 className="text-xl font-medium text-zinc-200">{title}</h3>
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
