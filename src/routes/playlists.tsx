import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { usePlayerStore } from "../store/playerStore";
import type { Track } from "../store/playerStore";
import { ListMusic, Play, Music, Film, Clock } from "lucide-react";
import { CreatePlaylistModal } from "../components/CreatePlaylistModal";

export const Route = createFileRoute("/playlists")({
  component: PlaylistsView,
});

interface MockPlaylist {
  id: string;
  name: string;
  description: string;
  tracks: Track[];
}

const MOCK_PLAYLISTS: MockPlaylist[] = [
  {
    id: "pl-1",
    name: "Favorite Audio Mix",
    description: "Energetic rock tracks for workout sessions.",
    tracks: [
      {
        id: "lib-1",
        name: "Lost in the Echo.mp3",
        path: "",
        title: "Lost in the Echo",
        artist: "Linkin Park",
        album: "Living Things",
        duration_secs: 205,
        media_type: "audio",
      },
      {
        id: "lib-4",
        name: "Numb.mp3",
        path: "",
        title: "Numb",
        artist: "Linkin Park",
        album: "Meteora",
        duration_secs: 187,
        media_type: "audio",
      },
    ],
  },
  {
    id: "pl-2",
    name: "Relaxing Tracks",
    description: "Calm acoustic songs for evening relaxation.",
    tracks: [
      {
        id: "lib-2",
        name: "Starlight.mp3",
        path: "",
        title: "Starlight",
        artist: "Muse",
        album: "Black Holes and Revelations",
        duration_secs: 240,
        media_type: "audio",
      },
    ],
  },
  {
    id: "pl-3",
    name: "Video Playlist",
    description: "Promotional trailers and introductory videos.",
    tracks: [
      {
        id: "lib-3",
        name: "Introductory Video.mp4",
        path: "",
        title: "Introductory Video",
        artist: "Ardio Team",
        album: "Promotional",
        duration_secs: 120,
        media_type: "video",
      },
      {
        id: "lib-5",
        name: "Inception Trailer.mp4",
        path: "",
        title: "Inception Trailer",
        artist: "Warner Bros.",
        album: "Trailers",
        duration_secs: 154,
        media_type: "video",
      },
    ],
  },
];

function PlaylistsView() {
  const { playTrack } = usePlayerStore();
  const [playlists, setPlaylists] = useState<MockPlaylist[]>(MOCK_PLAYLISTS);

  const handlePlayPlaylist = (playlist: MockPlaylist) => {
    if (playlist.tracks.length > 0) {
      playTrack(playlist.tracks[0], playlist.tracks);
    }
  };

  const handleCreatePlaylist = (name: string, description: string) => {
    const newPl: MockPlaylist = {
      id: `pl-${Date.now()}`,
      name: name,
      description: description || "Custom user playlist.",
      tracks: [],
    };
    setPlaylists((prev) => [...prev, newPl]);
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto font-medium select-none text-zinc-400">
      {/* Top Header */}
      <div className="flex justify-between items-center mb-10">
        <div>
          <h1 className="text-4xl font-medium text-zinc-200 tracking-tight">
            Playlists
          </h1>
        </div>

        <CreatePlaylistModal onPlaylistCreated={handleCreatePlaylist} />
      </div>

      {/* Playlists Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {playlists.map((pl) => {
          const totalDuration = pl.tracks.reduce(
            (acc, t) => acc + t.duration_secs,
            0,
          );

          return (
            <div
              key={pl.id}
              className="bg-panel-bg/20 hover:bg-panel-bg/40 border border-white/5 hover:border-brand/20 p-6 flex flex-col justify-between group transition-all duration-300 relative overflow-hidden h-52 rounded-lg"
            >
              {/* Corner Glow Overlay */}
              <div className="absolute -top-12 -right-12 w-24 h-24 bg-brand/5 group-hover:bg-brand/10 filter blur-xl rounded-full transition-all"></div>

              <div>
                <div className="flex justify-between items-start">
                  <div className="w-12 h-12 rounded-xl bg-brand/10 border border-brand/20 text-brand-light flex items-center justify-center shadow-inner">
                    <ListMusic size={22} />
                  </div>

                  {/* Play Button Hover overlay */}
                  <button
                    onClick={() => handlePlayPlaylist(pl)}
                    disabled={pl.tracks.length === 0}
                    className="w-10 h-10 rounded-full bg-brand text-zinc-200 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all shadow-md shadow-brand-glow transform hover:scale-105 active:scale-95 disabled:opacity-40 disabled:scale-100 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <Play
                      size={16}
                      fill="currentColor"
                      className="translate-x-[0.5px]"
                    />
                  </button>
                </div>

                <div className="mt-4">
                  <h3 className="text-lg font-medium text-zinc-200 truncate group-hover:text-brand-light transition-colors">
                    {pl.name}
                  </h3>
                  <p className="text-sm text-zinc-450 mt-1 line-clamp-2 pr-4 font-medium">
                    {pl.description}
                  </p>
                </div>
              </div>

              {/* Footer specs details */}
              <div className="flex items-center gap-4 text-sm text-zinc-500 pt-3 border-t border-white/5 mt-4">
                <span className="flex items-center gap-1.5">
                  <Music size={14} />
                  <span>
                    {pl.tracks.filter((t) => t.media_type === "audio").length}{" "}
                    audio
                  </span>
                </span>
                <span className="flex items-center gap-1.5">
                  <Film size={14} />
                  <span>
                    {pl.tracks.filter((t) => t.media_type === "video").length}{" "}
                    video
                  </span>
                </span>
                <span className="flex items-center gap-1.5 ml-auto">
                  <Clock size={14} />
                  <span>{formatDuration(totalDuration)}</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatDuration(secs: number): string {
  if (!secs || isNaN(secs)) return "0m";
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const remainingM = m % 60;
  return `${h}h ${remainingM}m`;
}
