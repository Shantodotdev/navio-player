import { X, Music, Play, ListMusic } from "lucide-react";
import { usePlayerStore } from "../store/playerStore";
import type { Track } from "../store/playerStore";

export function NowPlayingDrawer() {
  const { currentTrack, playlist, isDrawerOpen, setDrawerOpen, playTrack } =
    usePlayerStore();

  // Define some mock tracks in case the active play queue is empty
  const mockQueue: Track[] = [
    {
      id: "mock-1",
      name: "Lost in the Echo.mp3",
      path: "",
      title: "Lost in the Echo",
      artist: "Linkin Park",
      album: "Living Things",
      duration_secs: 205,
      media_type: "audio",
    },
    {
      id: "mock-2",
      name: "Starlight.mp3",
      path: "",
      title: "Starlight",
      artist: "Muse",
      album: "Black Holes and Revelations",
      duration_secs: 240,
      media_type: "audio",
    },
  ];

  const activeTrack = currentTrack || mockQueue[0];
  const activeQueue = playlist.length > 0 ? playlist : mockQueue;

  return (
    <div
      className={`absolute top-0 right-0 h-full w-96 bg-[#07070a]/98 backdrop-blur-3xl border-l border-white/5 shadow-[-15px_0_30px_-10px_rgba(0,0,0,0.8)] z-40 flex flex-col transition-transform duration-300 ease-out transform ${
        isDrawerOpen ? "translate-x-0" : "translate-x-full"
      }`}
    >
      {/* Drawer Header */}
      <div className="flex items-center justify-between p-5 border-b border-white/5 shrink-0">
        <span className="text-xs font-bold uppercase tracking-widest text-brand-light">
          Now Playing
        </span>
        <button
          onClick={() => setDrawerOpen(false)}
          className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 text-gray-400 hover:text-white transition-colors cursor-pointer"
        >
          <X size={15} />
        </button>
      </div>

      {/* Scrollable Content Container */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {/* Top Part: Large Cover Art & Details */}
        <div className="space-y-4">
          <div className="w-full aspect-square rounded-xl bg-card-bg border border-white/5 flex items-center justify-center shadow-lg overflow-hidden relative group">
            <div className="absolute inset-0 bg-linear-to-tr from-brand-glow to-transparent z-10 mix-blend-color-dodge"></div>

            {activeTrack.media_type === "video" ? (
              // Video Mock Visualizer
              <div
                className="absolute inset-0 bg-cover bg-center opacity-40 filter blur-sm scale-105"
                style={{
                  backgroundImage: `url('https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400')`,
                }}
              ></div>
            ) : (
              // Audio Disc Visualizer
              <div className="absolute w-72 h-72 rounded-full border border-black/40 bg-zinc-950 flex items-center justify-center shadow-2xl animate-spin-slow">
                <div className="w-28 h-28 rounded-full border border-white/5 bg-zinc-900 flex items-center justify-center">
                  <div className="w-8 h-8 rounded-full bg-brand"></div>
                </div>
              </div>
            )}

            {/* Static cover art overlay */}
            {activeTrack.media_type === "audio" && (
              <div
                className="absolute inset-0 bg-cover bg-center z-20"
                style={{
                  backgroundImage: `url('https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400')`,
                }}
              ></div>
            )}

            {activeTrack.media_type === "video" && (
              <div className="absolute inset-0 bg-black/40 z-20 flex items-center justify-center">
                <Play
                  size={26}
                  className="text-brand-light"
                  fill="currentColor"
                />
              </div>
            )}
          </div>

          <div className="space-y-1">
            <h3 className="text-lg font-bold text-white tracking-tight truncate">
              {activeTrack.title || activeTrack.name}
            </h3>
            <p className="text-xs text-gray-400 truncate">
              {activeTrack.artist || "Unknown Artist"}{" "}
              <span className="text-gray-600 px-1.5">•</span>{" "}
              <span className="text-gray-500">
                {activeTrack.album || "Unknown Album"}
              </span>
            </p>
          </div>
        </div>

        {/* Bottom Part: Playlist Queue */}
        <div className="space-y-3 pt-4 border-t border-white/5">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-400">
            <ListMusic size={15} className="text-brand-light" />
            <span>Up Next</span>
          </div>

          {/* Queue List */}
          <div className="space-y-1.5">
            {activeQueue.map((track) => {
              const isCurrent = activeTrack.id === track.id;

              return (
                <div
                  key={track.id}
                  onClick={() => playTrack(track, activeQueue)}
                  className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer border transition-all duration-150 group ${
                    isCurrent
                      ? "bg-brand/10 border-brand/20 text-brand-light font-semibold"
                      : "bg-transparent border-transparent hover:bg-white/5 text-gray-400 hover:text-white"
                  }`}
                >
                  <div className="w-9 h-9 rounded bg-white/5 flex items-center justify-center shrink-0 relative overflow-hidden">
                    <Music
                      size={13}
                      className="text-gray-400 group-hover:opacity-0"
                    />
                    <div className="absolute inset-0 bg-brand opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <Play
                        size={10}
                        fill="currentColor"
                        className="text-white"
                      />
                    </div>
                  </div>

                  <div className="flex-1 flex flex-col min-w-0">
                    <span className="text-xs truncate">
                      {track.title || track.name}
                    </span>
                    <span className="text-3xs text-gray-500 truncate">
                      {track.artist || "Unknown Artist"}
                    </span>
                  </div>

                  <span className="text-3xs text-gray-500 font-mono">
                    {formatTime(track.duration_secs)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatTime(secs: number): string {
  if (!secs || isNaN(secs)) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}
