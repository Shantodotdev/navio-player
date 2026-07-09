import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { usePlayerStore } from '../store/playerStore'
import { useLibrary } from '../hooks/useLibrary'
import {
  FolderPlus,
  Search,
  Play,
  Music,
  Film,
  Trash2,
  RefreshCcw,
} from 'lucide-react'

export const Route = createFileRoute('/library')({
  component: LibraryView,
})

function LibraryView() {
  const { playTrack } = usePlayerStore()
  const { tracks, scannedDirs, addFolder, deleteFolder, rescanAll } = useLibrary()
  
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'audio' | 'video'>('all')

  const filteredTracks = tracks.filter((t) => {
    const query = searchQuery.toLowerCase()
    const matchesSearch =
      t.name.toLowerCase().includes(query) ||
      (t.title && t.title.toLowerCase().includes(query)) ||
      t.path.toLowerCase().includes(query)

    const matchesFilter = filterType === 'all' || t.media_type === filterType
    return matchesSearch && matchesFilter
  })

  return (
    <div className="space-y-6 max-w-6xl mx-auto font-medium select-none text-zinc-400">
      {/* Top Header Section */}
      <div className="flex justify-between items-center mb-20">
        <div>
          <h1 className="text-4xl font-medium text-zinc-200 tracking-tight">
            Media library
          </h1>
        </div>

        <div className="flex gap-3">
          <button 
            onClick={rescanAll}
            disabled={scannedDirs.length === 0}
            className="flex items-center gap-2 px-4.5 py-2.5 bg-card-bg hover:bg-white/5 border border-white/5 hover:border-white/10 rounded-xl text-base transition-all text-zinc-400 hover:text-zinc-200 font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCcw size={16} />
            <span>Rescan all</span>
          </button>
          <button 
            onClick={addFolder}
            className="flex items-center gap-2 px-4.5 py-2.5 bg-brand hover:bg-brand-light text-zinc-200 rounded-xl text-base transition-all font-medium shadow-lg shadow-brand-glow cursor-pointer"
          >
            <FolderPlus size={16} />
            <span>Add folder</span>
          </button>
        </div>
      </div>

      {scannedDirs.length === 0 ? (
        // Large Elegant Empty State Panel
        <div className="flex flex-col items-center justify-center py-24 text-center space-y-5 bg-panel-bg/10 border border-white/5 rounded-2xl p-8">
          <div className="p-5 bg-brand/5 border border-brand/10 rounded-full text-brand-light shadow-lg shadow-brand-glow">
            <FolderPlus size={32} />
          </div>
          <div className="space-y-2">
            <h2 className="text-lg font-medium text-zinc-200">Your media library is empty</h2>
            <p className="text-sm text-zinc-400 max-w-md leading-relaxed font-medium">
              Select "Add folder" above to index your local directory folders and start cataloging your music and videos.
            </p>
          </div>
        </div>
      ) : (
        // Normal Scanned folders list + Search & Filters + Tracks Table
        <>
          {/* Scanned Folder List card */}
          <div className="bg-panel-bg/30 backdrop-blur-md rounded-2xl border border-white/5 p-6 mb-10">
            <h2 className="text-base font-medium text-zinc-400 mb-3.5">
              Scanned directories
            </h2>
            <div className="flex flex-wrap gap-2.5">
              {scannedDirs.map((dir) => (
                <div
                  key={dir}
                  className="flex items-center gap-2.5 bg-black/40 border border-white/5 px-3.5 py-2.5 rounded-xl text-sm text-zinc-400 font-medium group"
                >
                  <span className="text-zinc-400">{dir}</span>
                  <button
                    onClick={() => deleteFolder(dir)}
                    className="text-zinc-500 hover:text-red-400 transition-colors cursor-pointer"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Filters & Search */}
          <div className="flex flex-col sm:flex-row gap-4 items-center mb-3">
            {/* Search */}
            <div className="w-full sm:flex-1 relative">
              <Search
                size={18}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500"
              />
              <input
                type="text"
                placeholder="Search titles, filenames, or file paths..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-black/40 border border-white/5 rounded-lg py-2.5 pl-11 pr-4 text-base focus:outline-none focus:border-brand/40 text-zinc-200 placeholder-zinc-550 font-light"
              />
            </div>

            {/* Filter Categories */}
            <div className="flex bg-black/40 p-1 rounded-lg border border-white/5 shrink-0 self-stretch sm:self-auto font-medium">
              <FilterButton
                active={filterType === 'all'}
                onClick={() => setFilterType('all')}
              >
                All
              </FilterButton>
              <FilterButton
                active={filterType === 'audio'}
                onClick={() => setFilterType('audio')}
              >
                Audio
              </FilterButton>
              <FilterButton
                active={filterType === 'video'}
                onClick={() => setFilterType('video')}
              >
                Video
              </FilterButton>
            </div>
          </div>

          {/* Tracks Table list */}
          <div className="bg-panel-bg/20 backdrop-blur-md rounded-2xl border border-white/5 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-base font-medium">
                <thead>
                  <tr className="border-b border-white/5 text-zinc-450 text-sm bg-white/1">
                    <th className="p-4 w-12 text-center">Play</th>
                    <th className="p-4">Title</th>
                    <th className="p-4 w-24">Type</th>
                    <th className="p-4 w-24">Size</th>
                    <th className="p-4 w-24">Length</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-zinc-400">
                  {filteredTracks.map((track) => (
                    <tr
                      key={track.id}
                      className="hover:bg-white/1 group transition-all duration-150 cursor-pointer"
                      onDoubleClick={() => playTrack(track, filteredTracks)}
                    >
                      <td className="p-4 text-center">
                        <button
                          onClick={() => playTrack(track, filteredTracks)}
                          className="w-8 h-8 bg-brand/20 text-brand-light group-hover:bg-brand group-hover:text-zinc-200 rounded-full flex items-center justify-center transition-all shadow active:scale-90 cursor-pointer"
                        >
                          <Play
                            size={12}
                            fill="currentColor"
                            className="translate-x-[0.5px]"
                          />
                        </button>
                      </td>
                      <td className="p-4 text-zinc-300 font-medium text-base">
                        {track.title || track.name}
                      </td>
                      <td className="p-4">
                        <span className="flex items-center gap-1.5 text-sm text-zinc-400 font-medium lowercase">
                          {track.media_type === 'video' ? (
                            <Film size={15} className="text-brand-light" />
                          ) : (
                            <Music size={15} className="text-brand-light" />
                          )}
                          <span>{track.media_type}</span>
                        </span>
                      </td>
                      <td className="p-4 text-zinc-400 text-sm">
                        {formatFileSize(track.file_size_bytes)}
                      </td>
                      <td className="p-4 text-zinc-400 text-sm">
                        {formatDuration(track.duration_secs)}
                      </td>
                    </tr>
                  ))}
                  {filteredTracks.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="p-12 text-center text-zinc-500 italic"
                      >
                        No files found matching search criteria.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

interface FilterButtonProps {
  active: boolean
  children: string
  onClick: () => void
}

function FilterButton({ active, children, onClick }: FilterButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all cursor-pointer ${
        active
          ? 'bg-brand text-zinc-200 shadow shadow-brand-glow'
          : 'text-zinc-400 hover:text-zinc-200'
      }`}
    >
      {children}
    </button>
  )
}

function formatDuration(secs: number): string {
  if (!secs || isNaN(secs)) return '0:00'
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s < 10 ? '0' : ''}${s}`
}

function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return '—'
  if (bytes === 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = bytes
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  const precision = size >= 10 || unitIndex === 0 ? 0 : 1
  return `${size.toFixed(precision)} ${units[unitIndex]}`
}
