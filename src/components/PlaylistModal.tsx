import { useEffect, useState } from "react";
import {
  Clock,
  Film,
  ListMusic,
  Music,
  Pencil,
  Play,
  Trash2,
  X,
} from "lucide-react";
import type { Playlist } from "../store/libraryStore";
import type { Track } from "../store/playerStore";
import type { SmartPlaylist } from "../lib/smartPlaylists";
import { getTrackDisplayName } from "../lib/mediaLabels";
import { useSettingsStore } from "../store/settingsStore";

export type ModalPlaylist = (Playlist | SmartPlaylist) & {
  description?: string;
};

interface PlaylistModalProps {
  playlist: ModalPlaylist | null;
  isOpen: boolean;
  onClose: () => void;
  onExited?: () => void;
  onPlayTrack: (track: Track, queue: Track[]) => void;
  onPlayAll: (tracks: Track[]) => void;
  isCustom?: boolean;
  onEdit?: (playlist: Playlist) => void;
  onDelete?: (playlist: Playlist) => Promise<void>;
}

/**
 * Modal dialog for inspecting and playing the contents of a playlist.
 * Displays playlist metadata, track list with direct playback actions,
 * and edit/delete actions for custom playlists.
 */
export function PlaylistModal({
  playlist,
  isOpen,
  onClose,
  onExited,
  onPlayTrack,
  onPlayAll,
  isCustom = false,
  onEdit,
  onDelete,
}: PlaylistModalProps) {
  const { settings } = useSettingsStore();
  const [hasEntered, setHasEntered] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const frameId = window.requestAnimationFrame(() => setHasEntered(true));
      return () => window.cancelAnimationFrame(frameId);
    }

    setHasEntered(false);
    const timeoutId = window.setTimeout(() => {
      onExited?.();
    }, 220);
    return () => window.clearTimeout(timeoutId);
  }, [isOpen, onExited]);

  if (!playlist) return null;

  const isVisible = isOpen && hasEntered;
  const tracks = playlist.tracks ?? [];
  const totalDuration = tracks.reduce(
    (sum, track) => sum + (track.duration_secs || 0),
    0,
  );
  const audioCount = tracks.filter((t) => t.media_type === "audio").length;
  const videoCount = tracks.filter((t) => t.media_type === "video").length;

  const handlePlayAllClick = () => {
    if (tracks.length === 0) return;
    onPlayAll(tracks);
    onClose();
  };

  const handleTrackClick = (track: Track) => {
    onPlayTrack(track, tracks);
    onClose();
  };

  const handleDeleteClick = async () => {
    if (!isCustom || !onDelete) return;
    if (!window.confirm(`Delete playlist “${playlist.name}”?`)) return;
    await onDelete(playlist as Playlist);
    onClose();
  };

  const handleEditClick = () => {
    if (!isCustom || !onEdit) return;
    onEdit(playlist as Playlist);
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-200 ${
        isVisible
          ? "pointer-events-auto bg-black/50 opacity-100"
          : "pointer-events-none bg-black/0 opacity-0"
      }`}
      onClick={onClose}
    >
      <div
        className={`flex max-h-[min(720px,90vh)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#0e0e12]/85 shadow-[0_24px_80px_rgba(0,0,0,0.55)] ring-1 ring-white/5 backdrop-blur-sm transition-all duration-200 ${
          isVisible ? "translate-y-0 scale-100" : "translate-y-2 scale-[0.98]"
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-white/10 bg-white/2.5 p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4 min-w-0">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-brand/25 bg-brand/10 text-brand-light">
                <ListMusic size={24} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                  {isCustom ? "Custom Playlist" : "Smart Playlist"}
                </p>
                <h2 className="mt-0.5 truncate text-xl sm:text-2xl font-medium text-zinc-100">
                  {playlist.name}
                </h2>
                {playlist.description && (
                  <p className="mt-1 text-xs text-zinc-400 line-clamp-2">
                    {playlist.description}
                  </p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-zinc-500 hover:bg-white/5 hover:text-zinc-200 transition-colors cursor-pointer shrink-0"
              aria-label="Close playlist modal"
            >
              <X size={18} />
            </button>
          </div>

          {/* Action Row */}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/5">
            <div className="flex items-center gap-4 text-xs text-zinc-400">
              <span className="flex items-center gap-1.5 font-medium">
                {tracks.length} {tracks.length === 1 ? "track" : "tracks"}
              </span>
              {audioCount > 0 && (
                <span className="flex items-center gap-1 text-emerald-400">
                  <Music size={13} /> {audioCount}
                </span>
              )}
              {videoCount > 0 && (
                <span className="flex items-center gap-1 text-purple-400">
                  <Film size={13} /> {videoCount}
                </span>
              )}
              {totalDuration > 0 && (
                <span className="flex items-center gap-1 text-zinc-500">
                  <Clock size={13} /> {formatDuration(totalDuration)}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {isCustom && onEdit && (
                <button
                  type="button"
                  onClick={handleEditClick}
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
                >
                  <Pencil size={13} /> Edit
                </button>
              )}
              {isCustom && onDelete && (
                <button
                  type="button"
                  onClick={() => void handleDeleteClick()}
                  className="flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer"
                >
                  <Trash2 size={13} /> Delete
                </button>
              )}
              <button
                type="button"
                onClick={handlePlayAllClick}
                disabled={tracks.length === 0}
                className="flex items-center gap-2 rounded-lg bg-brand px-4 py-1.5 text-xs font-medium text-white shadow-md shadow-brand-glow hover:bg-brand-light transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <Play size={13} fill="currentColor" /> Play all
              </button>
            </div>
          </div>
        </div>

        {/* Track List */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 space-y-1.5 bg-black/10">
          {tracks.map((track, index) => {
            const displayName = getTrackDisplayName(
              track,
              settings.library.showFileExtensions,
            );
            return (
              <div
                key={`${track.id}-${index}`}
                onClick={() => handleTrackClick(track)}
                className="group flex items-center justify-between gap-3 rounded-xl border border-transparent p-2.5 sm:p-3 text-left transition-all hover:border-white/10 hover:bg-white/5 cursor-pointer"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-zinc-400 transition-colors group-hover:bg-brand group-hover:text-white">
                    {track.media_type === "video" ? (
                      <Film size={15} className="group-hover:opacity-0" />
                    ) : (
                      <Music size={15} className="group-hover:opacity-0" />
                    )}
                    <Play
                      size={14}
                      fill="currentColor"
                      className="absolute inset-0 m-auto opacity-0 group-hover:opacity-100 transition-opacity text-white"
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-200 group-hover:text-white">
                      {displayName}
                    </p>
                    <p className="text-[11px] text-zinc-500 capitalize">
                      {track.media_type}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-zinc-500">
                    {formatDuration(track.duration_secs)}
                  </span>
                </div>
              </div>
            );
          })}

          {tracks.length === 0 && (
            <div className="py-12 text-center text-sm text-zinc-500">
              <p>No tracks in this playlist yet.</p>
              {isCustom && onEdit && (
                <button
                  type="button"
                  onClick={handleEditClick}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/10 cursor-pointer"
                >
                  <Pencil size={13} /> Add tracks now
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (!seconds || Number.isNaN(seconds)) return "0m";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
