import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Clock, Film, ListMusic, Music, Pencil, Play } from "lucide-react";
import { CreatePlaylistModal } from "../components/CreatePlaylistModal";
import { PlaylistEditorModal } from "../components/PlaylistEditorModal";
import { useLibrary } from "../hooks/useLibrary";
import type { Playlist } from "../store/libraryStore";
import { usePlayerStore } from "../store/playerStore";

export const Route = createFileRoute("/playlists")({
  component: PlaylistsView,
});

function PlaylistsView() {
  const { playTrack } = usePlayerStore();
  const {
    tracks,
    playlists,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    addTrackToPlaylist,
    removeTrackFromPlaylist,
  } = useLibrary();
  const [editingPlaylist, setEditingPlaylist] = useState<Playlist | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  const activePlaylist = editingPlaylist
    ? (playlists.find((playlist) => playlist.id === editingPlaylist.id) ?? null)
    : null;

  const openEditor = (playlist: Playlist) => {
    setEditingPlaylist(playlist);
    setIsEditorOpen(true);
  };

  const handlePlayPlaylist = (playlist: Playlist) => {
    const availableTracks = playlist.tracks.filter(
      (track) => track.path.trim().length > 0,
    );
    if (availableTracks.length > 0)
      playTrack(availableTracks[0], availableTracks);
  };

  return (
    <div className="mx-auto max-w-6xl select-none space-y-6 font-medium text-zinc-400">
      <div className="mb-10 flex items-center justify-between">
        <h1 className="text-4xl font-medium tracking-tight text-zinc-200">
          Playlists
        </h1>
        <CreatePlaylistModal onPlaylistCreated={createPlaylist} />
      </div>

      {playlists.length === 0 ? (
        <div className="flex flex-col items-center justify-center space-y-5 rounded-2xl border border-white/5 bg-panel-bg/10 p-8 py-24 text-center">
          <div className="rounded-full border border-brand/10 bg-brand/5 p-5 text-brand-light shadow-lg shadow-brand-glow">
            <ListMusic size={32} />
          </div>
          <div className="space-y-2">
            <h2 className="text-lg font-medium text-zinc-200">
              No playlists yet
            </h2>
            <p className="max-w-md text-sm leading-relaxed text-zinc-400">
              Create a playlist and add tracks from your local library.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {playlists.map((playlist) => {
            const totalDuration = playlist.tracks.reduce(
              (total, track) => total + track.duration_secs,
              0,
            );
            const audioCount = playlist.tracks.filter(
              (track) => track.media_type === "audio",
            ).length;
            const videoCount = playlist.tracks.filter(
              (track) => track.media_type === "video",
            ).length;
            return (
              <div
                key={playlist.id}
                className="group relative flex h-52 flex-col justify-between overflow-hidden rounded-lg border border-white/5 bg-panel-bg/20 p-6 transition-all duration-300 hover:border-brand/20 hover:bg-panel-bg/40"
              >
                <div className="absolute -right-12 -top-12 h-24 w-24 rounded-full bg-brand/5 blur-xl transition-all group-hover:bg-brand/10" />
                <div>
                  <div className="flex items-start justify-between">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-brand/20 bg-brand/10 text-brand-light">
                      <ListMusic size={22} />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => openEditor(playlist)}
                        className="flex h-10 w-10 items-center justify-center rounded-lg text-zinc-500 opacity-0 transition-all hover:bg-white/10 hover:text-zinc-200 group-hover:opacity-100"
                        aria-label={`Edit ${playlist.name}`}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePlayPlaylist(playlist)}
                        disabled={playlist.tracks.length === 0}
                        className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-zinc-200 opacity-0 shadow-md shadow-brand-glow transition-all group-hover:opacity-100 hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Play size={16} fill="currentColor" />
                      </button>
                    </div>
                  </div>
                  <h3 className="mt-4 truncate text-lg font-medium text-zinc-200">
                    {playlist.name}
                  </h3>
                </div>
                <div className="flex items-center gap-4 border-t border-white/5 pt-3 text-sm text-zinc-500">
                  <span className="flex items-center gap-1.5">
                    <Music size={14} className="text-emerald-400" />
                    {audioCount}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Film size={14} className="text-purple-400" />
                    {videoCount}
                  </span>
                  <span className="ml-auto flex items-center gap-1.5">
                    <Clock size={14} />
                    {formatDuration(totalDuration)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activePlaylist && (
        <PlaylistEditorModal
          playlist={activePlaylist}
          libraryTracks={tracks}
          isOpen={isEditorOpen}
          onClose={() => setIsEditorOpen(false)}
          onExited={() => setEditingPlaylist(null)}
          onRename={(name) => renamePlaylist(activePlaylist.id, name)}
          onDelete={() => deletePlaylist(activePlaylist.id)}
          onAddTrack={(track) => addTrackToPlaylist(activePlaylist.id, track)}
          onRemoveTrack={(trackId) =>
            removeTrackFromPlaylist(activePlaylist.id, trackId)
          }
        />
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (!seconds || Number.isNaN(seconds)) return "0m";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
