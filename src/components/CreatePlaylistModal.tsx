import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Plus } from "lucide-react";

interface CreatePlaylistModalProps {
  onPlaylistCreated: (name: string) => void | Promise<void>;
}

export function CreatePlaylistModal({
  onPlaylistCreated,
}: CreatePlaylistModalProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isCreating) return;
    const frameId = window.requestAnimationFrame(() =>
      nameInputRef.current?.focus(),
    );
    return () => window.cancelAnimationFrame(frameId);
  }, [isCreating]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await onPlaylistCreated(name);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to create playlist.",
      );
      return;
    }
    setName("");
    setError("");
    setIsCreating(false);
  };

  return (
    <>
      <button
        id="create-playlist"
        onClick={() => setIsCreating(true)}
        className="flex items-center gap-2 px-5 py-3 bg-brand hover:bg-brand-light text-zinc-200 rounded-xl text-base transition-all font-medium shadow-lg shadow-brand-glow cursor-pointer select-none"
      >
        <Plus size={16} />
        <span>New playlist</span>
      </button>

      {/* Persistent modal shell supporting smooth enter and exit CSS transitions */}
      <div
        onClick={() => setIsCreating(false)}
        className={`fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 select-none transition-opacity duration-200 ${
          isCreating
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className={`w-full max-w-md bg-[#0e0e12]/85 backdrop-blur-sm border border-white/10 rounded-2xl p-6 shadow-2xl space-y-4 transition-all duration-200 transform ${
            isCreating ? "scale-100 opacity-100" : "scale-95 opacity-0"
          }`}
        >
          <h3 className="text-xl font-medium text-zinc-200">
            Create new playlist
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-sm text-zinc-400 font-medium">
                Playlist name
              </label>
              <input
                type="text"
                required
                ref={nameInputRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-black/40 border border-white/5 rounded-lg p-2.5 text-base text-zinc-200 focus:outline-none focus:border-brand/40 font-medium"
              />
            </div>

            {error && <p className="text-sm text-red-300">{error}</p>}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="px-4 py-2 text-base text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-brand hover:bg-brand-light text-zinc-200 font-medium rounded-lg text-base shadow shadow-brand-glow transition-colors cursor-pointer"
              >
                Create playlist
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
