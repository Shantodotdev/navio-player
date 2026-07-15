import {
  Download,
  FolderOpen,
  Home,
  Library,
  ListMusic,
  MoreHorizontal,
  Pause,
  Play,
  Search,
  Settings,
  SkipBack,
  SkipForward,
  Volume2,
} from "lucide-react";

const tracks = [
  {
    title: "Afterglow",
    artist: "Lunar Avenue",
    duration: "3:42",
    active: true,
  },
  { title: "Coastline", artist: "Northern Lights", duration: "4:08" },
  { title: "Distant Signals", artist: "Golden Hours", duration: "3:27" },
  { title: "Night Drive", artist: "Paper Satellites", duration: "4:31" },
];

/** Renders a code-native preview of Navio's desktop library experience. */
export function ProductPreview() {
  return (
    <div
      className="product-preview"
      aria-label="Navio desktop application preview"
    >
      <div className="preview-titlebar">
        <div className="preview-brand">
          <img src="/navio-logo.png" alt="" />
          <span>Navio Player</span>
        </div>
        <div className="window-controls" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>

      <div className="preview-workspace">
        <aside className="preview-sidebar">
          <nav aria-label="Preview navigation">
            <PreviewNavItem icon={<Home size={14} />} label="Home" />
            <PreviewNavItem
              icon={<Library size={14} />}
              label="Library"
              active
            />
            <PreviewNavItem icon={<ListMusic size={14} />} label="Playlists" />
            <PreviewNavItem icon={<Download size={14} />} label="Downloader" />
          </nav>
          <div className="preview-sidebar-bottom">
            <PreviewNavItem icon={<Settings size={14} />} label="Settings" />
          </div>
        </aside>

        <div className="preview-main">
          <div className="preview-heading-row">
            <div>
              <p>Your collection</p>
              <h2>Library</h2>
            </div>
            <div className="preview-actions">
              <div className="preview-search">
                <Search size={13} />
                <span>Search your media</span>
              </div>
              <button type="button" aria-label="Add folder">
                <FolderOpen size={13} />
                Add folder
              </button>
            </div>
          </div>

          <div className="preview-filters">
            <span className="active">All media</span>
            <span>Audio</span>
            <span>Video</span>
          </div>

          <div
            className="track-list"
            role="table"
            aria-label="Preview media library"
          >
            {tracks.map((track, index) => (
              <div
                className={`track-row ${track.active ? "active" : ""}`}
                role="row"
                key={track.title}
              >
                <div className="track-index">
                  {track.active ? (
                    <Pause size={11} fill="currentColor" />
                  ) : (
                    index + 1
                  )}
                </div>
                <div className={`track-art track-art-${index + 1}`}>
                  {track.active ? <Play size={11} fill="currentColor" /> : null}
                </div>
                <div className="track-copy">
                  <strong>{track.title}</strong>
                  <span>{track.artist}</span>
                </div>
                <span className="track-format">MP3</span>
                <span className="track-duration">{track.duration}</span>
                <MoreHorizontal size={14} className="track-more" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="preview-player">
        <div className="playing-track">
          <div className="playing-art" />
          <div>
            <strong>Afterglow</strong>
            <span>Lunar Avenue</span>
          </div>
        </div>
        <div className="player-center">
          <div className="player-controls">
            <SkipBack size={13} fill="currentColor" />
            <span className="play-control">
              <Pause size={12} fill="currentColor" />
            </span>
            <SkipForward size={13} fill="currentColor" />
          </div>
          <div className="progress-row">
            <span>1:16</span>
            <div className="progress-track">
              <span />
            </div>
            <span>3:42</span>
          </div>
        </div>
        <div className="player-volume">
          <Volume2 size={13} />
          <div>
            <span />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Renders one navigation entry inside the product preview. */
function PreviewNavItem({
  icon,
  label,
  active = false,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <div className={`preview-nav-item ${active ? "active" : ""}`}>
      {icon}
      <span>{label}</span>
    </div>
  );
}
