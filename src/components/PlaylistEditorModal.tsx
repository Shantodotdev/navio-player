import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Film,
  GripVertical,
  Minus,
  Music,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { DragDropProvider } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import type { Playlist } from "../store/libraryStore";
import type { Track } from "../store/playerStore";
import { toast } from "../store/toastStore";
import { getErrorMessage } from "../lib/errorMessage";
import { isPlaylistValidationMessage } from "../lib/playlistErrors";

interface PlaylistEditorModalProps {
  playlist: Playlist;
  libraryTracks: Track[];
  isOpen: boolean;
  onClose: () => void;
  onExited: () => void;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onAddTrack: (track: Track) => Promise<void>;
  onRemoveTrack: (trackId: string) => Promise<void>;
  onReorderTrack: (fromIndex: number, toIndex: number) => Promise<void>;
}

export function PlaylistEditorModal({
  playlist,
  libraryTracks,
  isOpen,
  onClose,
  onExited,
  onRename,
  onDelete,
  onAddTrack,
  onRemoveTrack,
  onReorderTrack,
}: PlaylistEditorModalProps) {
  const [name, setName] = useState(playlist.name);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [hasEntered, setHasEntered] = useState(false);
  const [moveAnnouncement, setMoveAnnouncement] = useState("");

  useEffect(() => {
    if (isOpen) {
      const frameId = window.requestAnimationFrame(() => setHasEntered(true));
      return () => window.cancelAnimationFrame(frameId);
    }

    setHasEntered(false);
    const timeoutId = window.setTimeout(onExited, 220);
    return () => window.clearTimeout(timeoutId);
  }, [isOpen, onExited]);

  const isVisible = isOpen && hasEntered;

  const filteredTracks = libraryTracks.filter((track) => {
    const query = search.toLowerCase();
    return (
      track.name.toLowerCase().includes(query) ||
      track.path.toLowerCase().includes(query) ||
      (track.title?.toLowerCase().includes(query) ?? false)
    );
  });

  /** Persists a playlist name while retaining validation beside the editor. */
  const handleRename = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await onRename(name);
      setError("");
    } catch (renameError) {
      const message = getErrorMessage(
        renameError,
        "Unable to rename playlist.",
      );
      if (isPlaylistValidationMessage(message)) {
        setError(message);
      } else {
        setError("");
        toast.error("Could not rename playlist", {
          description: message,
          dedupeKey: `playlist-rename-error:${playlist.id}`,
        });
      }
    }
  };

  /** Deletes the active playlist after the existing destructive confirmation. */
  const handleDelete = async () => {
    if (!window.confirm(`Delete playlist “${playlist.name}”?`)) return;
    try {
      await onDelete();
      onClose();
    } catch (deleteError) {
      setError("");
      toast.error("Could not delete playlist", {
        description: getErrorMessage(deleteError, "Unable to delete playlist."),
        dedupeKey: `playlist-delete:${playlist.id}`,
      });
    }
  };

  /** Adds one available library track and reports persistence failures. */
  const handleAdd = async (track: Track) => {
    try {
      await onAddTrack(track);
    } catch (addError) {
      setError("");
      toast.error("Could not add track", {
        description: getErrorMessage(addError, "Unable to add track."),
        dedupeKey: `playlist-add-error:${playlist.id}:${track.id}`,
      });
    }
  };

  /** Removes one playlist track and reports persistence failures. */
  const handleRemove = async (trackId: string) => {
    try {
      await onRemoveTrack(trackId);
    } catch (removeError) {
      setError("");
      toast.error("Could not remove track", {
        description: getErrorMessage(removeError, "Unable to remove track."),
        dedupeKey: `playlist-remove-error:${playlist.id}:${trackId}`,
      });
    }
  };

  /** Persists one reordered track and announces its resulting position. */
  const handleReorder = async (fromIndex: number, toIndex: number) => {
    const track = playlist.tracks[fromIndex];
    if (!track || fromIndex === toIndex) return;

    try {
      await onReorderTrack(fromIndex, toIndex);
      setMoveAnnouncement(
        `${track.title || track.name} moved to position ${toIndex + 1}.`,
      );
    } catch (reorderError) {
      setError("");
      toast.error("Could not reorder playlist", {
        description: getErrorMessage(
          reorderError,
          "Unable to save the new track order.",
        ),
        dedupeKey: `playlist-reorder-error:${playlist.id}`,
      });
    }
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
        className={`flex max-h-[min(720px,90vh)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#0e0e12]/85 shadow-[0_24px_80px_rgba(0,0,0,0.55)] ring-1 ring-white/5 backdrop-blur-sm transition-all duration-200 ${
          isVisible ? "translate-y-0 scale-100" : "translate-y-2 scale-[0.98]"
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 bg-white/2.5 p-6">
          <div>
            <p className="text-base tracking-wider text-zinc-500">
              Playlist Editor
            </p>
            <h2 className="mt-1 text-xl font-medium text-zinc-200">
              {playlist.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
            aria-label="Close playlist editor"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-rows-2 gap-6 overflow-hidden bg-black/10 p-6 lg:grid-cols-2 lg:grid-rows-1">
          <section className="flex min-h-0 flex-col gap-4">
            <form onSubmit={handleRename} className="flex gap-2">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-label="Playlist name"
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-zinc-200 outline-none focus:border-brand/50"
              />
              <button
                type="submit"
                className="rounded-lg bg-brand px-3 py-2 text-sm text-white hover:bg-brand-light"
              >
                Rename
              </button>
            </form>

            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-zinc-300">
                Tracks in playlist
              </h3>
              <span className="text-xs text-zinc-500">
                {playlist.tracks.length} tracks
              </span>
            </div>
            <DragDropProvider
              onDragEnd={(event) => {
                if (event.canceled) return;
                const { source } = event.operation;
                if (!isSortable(source)) return;
                void handleReorder(source.initialIndex, source.index);
              }}
            >
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-2">
                {playlist.tracks.map((track, index) => (
                  <SortablePlaylistTrack
                    key={track.id}
                    track={track}
                    index={index}
                    trackCount={playlist.tracks.length}
                    onMove={(toIndex) => void handleReorder(index, toIndex)}
                    onRemove={() => void handleRemove(track.id)}
                  />
                ))}
                {playlist.tracks.length === 0 && (
                  <p className="rounded-lg border border-dashed border-white/10 p-6 text-center text-sm text-zinc-500">
                    No tracks yet.
                  </p>
                )}
              </div>
            </DragDropProvider>
            <p className="sr-only" aria-live="polite">
              {moveAnnouncement}
            </p>
          </section>

          <section className="flex min-h-0 flex-col gap-4">
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Add tracks from your library"
                className="w-full rounded-lg border border-white/10 bg-black/40 py-2 pl-9 pr-3 text-sm text-zinc-200 outline-none focus:border-brand/50"
              />
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-2">
              {filteredTracks.map((track) => {
                const isAdded = playlist.tracks.some(
                  (item) => item.id === track.id,
                );
                return (
                  <div
                    key={track.id}
                    className="flex items-center gap-3 rounded-lg border border-white/5 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 truncate text-sm text-zinc-200">
                        {track.media_type === "video" ? (
                          <Film
                            size={14}
                            className="shrink-0 text-purple-400"
                          />
                        ) : (
                          <Music
                            size={14}
                            className="shrink-0 text-emerald-400"
                          />
                        )}
                        <span className="truncate">
                          {track.title || track.name}
                        </span>
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={isAdded}
                      onClick={() => void handleAdd(track)}
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full p-0 ${
                        isAdded
                          ? "text-zinc-400"
                          : "text-zinc-400 hover:bg-brand/10 hover:text-brand-light"
                      }`}
                      style={
                        isAdded
                          ? { color: "#4ade80", cursor: "default" }
                          : undefined
                      }
                      aria-label={
                        isAdded
                          ? `Already added ${track.title || track.name}`
                          : `Add ${track.title || track.name}`
                      }
                    >
                      {isAdded ? (
                        <Check size={15} />
                      ) : (
                        <span className="text-xl leading-none">+</span>
                      )}
                    </button>
                  </div>
                );
              })}
              {filteredTracks.length === 0 && (
                <p className="p-6 text-center text-sm text-zinc-500">
                  No library tracks found.
                </p>
              )}
            </div>
          </section>
        </div>

        <div className="flex items-center justify-between border-t border-white/10 bg-white/2 p-6">
          {error ? (
            <p className="max-w-[70%] text-sm text-red-300">{error}</p>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={() => void handleDelete()}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-400 hover:bg-red-400/10"
          >
            <Trash2 size={15} /> Delete playlist
          </button>
        </div>
      </div>
    </div>
  );
}

/** Renders one smoothly sortable playlist track with keyboard controls. */
function SortablePlaylistTrack({
  track,
  index,
  trackCount,
  onMove,
  onRemove,
}: {
  track: Track;
  index: number;
  trackCount: number;
  onMove: (toIndex: number) => void;
  onRemove: () => void;
}) {
  const { ref, handleRef, isDragSource, isDropTarget } = useSortable({
    id: track.id,
    index,
    disabled: trackCount < 2,
    transition: {
      duration: 280,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      idle: true,
    },
  });
  const displayName = track.title || track.name;

  return (
    <div
      ref={ref}
      className={`group flex items-center gap-2 rounded-lg border p-2 transition-[opacity,background-color,border-color,box-shadow] duration-200 ${
        isDropTarget
          ? "border-white/15 bg-white/7"
          : "border-white/5 bg-white/2"
      } ${isDragSource ? "z-10 opacity-85 shadow-xl shadow-black/35" : "opacity-100"}`}
    >
      {trackCount > 1 && (
        <button
          ref={handleRef}
          type="button"
          aria-label={`Drag ${displayName} to reorder`}
          className="flex h-8 w-6 touch-none shrink-0 cursor-grab items-center justify-center rounded text-zinc-600 hover:bg-white/5 hover:text-zinc-300 active:cursor-grabbing focus:outline-none focus-visible:ring-1 focus-visible:ring-brand/50"
        >
          <GripVertical size={15} />
        </button>
      )}
      <div className="min-w-0 flex-1 px-1">
        <p className="flex items-center gap-2 truncate text-sm text-zinc-200">
          {track.media_type === "video" ? (
            <Film size={14} className="shrink-0 text-purple-400" />
          ) : (
            <Music size={14} className="shrink-0 text-emerald-400" />
          )}
          <span className="truncate">{displayName}</span>
        </p>
      </div>
      {trackCount > 1 && (
        <div className="flex shrink-0 flex-col">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => onMove(index - 1)}
            aria-label={`Move ${displayName} up`}
            className="grid h-5 w-6 place-items-center rounded text-zinc-600 hover:bg-white/5 hover:text-zinc-300 disabled:pointer-events-none disabled:opacity-20"
          >
            <ChevronUp size={13} />
          </button>
          <button
            type="button"
            disabled={index === trackCount - 1}
            onClick={() => onMove(index + 1)}
            aria-label={`Move ${displayName} down`}
            className="grid h-5 w-6 place-items-center rounded text-zinc-600 hover:bg-white/5 hover:text-zinc-300 disabled:pointer-events-none disabled:opacity-20"
          >
            <ChevronDown size={13} />
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full p-0 text-zinc-500 hover:bg-red-400/10 hover:text-red-300"
        aria-label={`Remove ${displayName}`}
      >
        <Minus size={15} />
      </button>
    </div>
  );
}
