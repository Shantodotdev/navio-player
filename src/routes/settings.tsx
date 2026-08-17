import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Database,
  Download,
  Folder,
  FolderOpen,
  Grid2X2,
  Info,
  Keyboard,
  List,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Sparkles,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { Switch } from "../components/Switch";
import { Select } from "../components/Select";
import { SettingsActionModal } from "../components/SettingsActionModal";
import { openKeyboardShortcutsModal } from "../components/KeyboardShortcuts";
import { NAVIO_LANGUAGE_OPTIONS } from "../lib/mediaLanguages";
import {
  useSettingsStore,
  DEFAULT_LIBRARY_EXCLUSIONS,
  type PartialSettingsUpdate,
} from "../store/settingsStore";
import { toast } from "../store/toastStore";
import { getErrorMessage } from "../lib/errorMessage";
import { useLibraryStore } from "../store/libraryStore";
import { parseLibraryExclusions } from "../lib/libraryExclusions";

export const Route = createFileRoute("/settings")({ component: SettingsView });

type SettingsCategory =
  | "playback"
  | "library"
  | "downloads"
  | "about"
  | "danger";

interface CategoryNavOption {
  id: SettingsCategory;
  label: string;
  description: string;
  icon: typeof Volume2;
}

const CATEGORIES: CategoryNavOption[] = [
  {
    id: "playback",
    label: "Playback",
    description: "Volume, subtitles, and languages",
    icon: Volume2,
  },
  {
    id: "library",
    label: "Library",
    description: "View mode, artwork, and exclusions",
    icon: Database,
  },
  {
    id: "downloads",
    label: "Downloads",
    description: "Storage folder and updates",
    icon: Download,
  },
  {
    id: "about",
    label: "About & Keys",
    description: "App details and shortcuts",
    icon: Sparkles,
  },
  {
    id: "danger",
    label: "Data & Reset",
    description: "Cache and database maintenance",
    icon: ShieldAlert,
  },
];

/** Renders the streamlined, categorized Navio settings and local data actions. */
function SettingsView() {
  const {
    settings,
    isLoaded,
    updateSettings,
    clearDownloadHistory,
    resetDatabases,
  } = useSettingsStore();
  const { scanJobs, rebuildLibraryIndex } = useLibraryStore();
  const hasActiveScans = Object.keys(scanJobs).length > 0;

  const [activeCategory, setActiveCategory] =
    useState<SettingsCategory>("playback");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeAction, setActiveAction] = useState<
    "clear-history" | "full-reset" | null
  >(null);
  const [actionError, setActionError] = useState("");

  /** Saves a routine preference while the global store reports persistence failures. */
  function savePreference(update: PartialSettingsUpdate) {
    void updateSettings(update).catch(() => undefined);
  }

  async function chooseDownloadFolder() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose download folder",
      });
      if (typeof selected === "string") {
        try {
          await updateSettings({ downloads: { folder: selected } });
        } catch {
          // The settings store restores the prior folder and reports the failure.
          return;
        }
      }
    } catch (error) {
      toast.error("Could not change download folder", {
        description: getErrorMessage(
          error,
          "Folder selection is available in the Navio desktop app.",
        ),
        dedupeKey: "download-folder",
        action: { label: "Choose again", run: chooseDownloadFolder },
      });
    }
  }

  /** Restores the system download folder while the store reports failures. */
  async function resetDownloadFolder() {
    try {
      await updateSettings({ downloads: { folder: null } });
    } catch {
      // The settings store restores the prior value and reports the failure.
    }
  }

  async function clearHistory(deleteFiles: boolean) {
    try {
      await clearDownloadHistory(deleteFiles);
      setActiveAction(null);
    } catch (error) {
      setActionError(
        getErrorMessage(error, "Could not clear download history."),
      );
    }
  }

  async function resetAllDatabases() {
    try {
      await resetDatabases();
      window.location.reload();
    } catch (error) {
      setActionError(
        getErrorMessage(error, "Could not reset Navio databases."),
      );
    }
  }

  function openAction(action: "clear-history" | "full-reset") {
    setActionError("");
    setActiveAction(action);
  }

  /** Rebuilds the persistent catalog after exclusion or filesystem changes. */
  async function handleReindex() {
    try {
      await rebuildLibraryIndex();
    } catch (error) {
      toast.error("Could not reindex library", {
        description: getErrorMessage(
          error,
          "Navio could not rebuild the media index.",
        ),
        dedupeKey: "library-reindex",
      });
    }
  }

  const isSearching = searchQuery.trim().length > 0;
  const normalizedSearch = searchQuery.trim().toLowerCase();

  /** Determines whether a category has any setting matches for the active search term. */
  const matchingCategories = useMemo(() => {
    if (!isSearching) return new Set<SettingsCategory>([activeCategory]);
    const matches = new Set<SettingsCategory>();

    const check = (category: SettingsCategory, keywords: string[]) => {
      if (
        keywords.some((keyword) =>
          keyword.toLowerCase().includes(normalizedSearch),
        )
      ) {
        matches.add(category);
      }
    };

    check("playback", [
      "volume",
      "playback",
      "audio",
      "video in sidebar",
      "now playing",
      "subtitles",
      "default audio language",
      "default subtitle language",
    ]);

    check("library", [
      "library",
      "thumbnails",
      "view mode",
      "list",
      "grid",
      "file extensions",
      "ignored folders",
      "exclusions",
      "reindex",
      "scan",
    ]);

    check("downloads", [
      "download folder",
      "storage",
      "downloads",
      "automatic updates",
      "updates",
      "version",
    ]);

    check("about", [
      "about",
      "version",
      "shortcuts",
      "keyboard",
      "hotkeys",
      "privacy",
      "app info",
    ]);

    check("danger", [
      "reset",
      "clear history",
      "clear download history",
      "full reset",
      "databases",
      "danger",
      "delete",
    ]);

    return matches;
  }, [isSearching, normalizedSearch, activeCategory]);

  if (!isLoaded) {
    return (
      <div className="flex h-64 items-center justify-center text-zinc-400">
        <LoaderCircle
          size={20}
          className="animate-spin text-brand-light mr-2"
        />
        <span>Loading preferences…</span>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto w-full min-h-full flex flex-col space-y-6 select-none text-zinc-300 min-w-0">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-6 shrink-0">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-zinc-100 tracking-tight">
            Settings
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1">
            Manage your player preferences, library indexing, and data.
          </p>
        </div>

        {/* Quick Search Filter */}
        <div className="relative w-full sm:w-64">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search settings…"
            className="w-full bg-black/40 border border-white/10 focus:border-brand/50 rounded-xl pl-9 pr-8 py-2 text-xs sm:text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-brand/30 transition-all"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 p-0.5 rounded cursor-pointer"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Search results banner when searching */}
      {isSearching && (
        <div className="flex items-center justify-between bg-brand/10 border border-brand/20 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-zinc-300 shrink-0">
          <div className="flex items-center gap-2">
            <Search size={14} className="text-brand-light shrink-0" />
            <span>
              Showing settings matching{" "}
              <strong className="text-zinc-100">"{searchQuery}"</strong> (
              {matchingCategories.size} section
              {matchingCategories.size === 1 ? "" : "s"})
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="text-xs text-brand-light hover:underline ml-2 shrink-0 cursor-pointer"
          >
            Clear filter
          </button>
        </div>
      )}

      {/* Main Settings Body */}
      <div className="flex-1 flex flex-col md:flex-row gap-6 items-stretch min-h-0">
        {/* Category Navigation Pills (Sidebar on md+, Horizontal scroll on mobile) */}
        {!isSearching && (
          <nav
            aria-label="Settings categories"
            className="w-full md:w-60 shrink-0 flex flex-row md:flex-col gap-1.5 overflow-x-auto md:overflow-y-auto p-2 bg-panel-bg/30 backdrop-blur-md rounded-2xl border border-white/5 md:self-stretch justify-start"
          >
            {CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              const isActive = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCategory(cat.id)}
                  className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-all text-left whitespace-nowrap md:whitespace-normal cursor-pointer ${
                    isActive
                      ? "bg-brand/15 text-brand-light border border-brand/30 shadow-sm shadow-brand-glow/20"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5 border border-transparent"
                  }`}
                >
                  <Icon
                    size={16}
                    className={`shrink-0 ${
                      isActive ? "text-brand-light" : "text-zinc-500"
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="truncate leading-tight">{cat.label}</div>
                  </div>
                </button>
              );
            })}
          </nav>
        )}

        {/* Content Area */}
        <div className="flex-1 w-full min-w-0 flex flex-col space-y-6">
          {/* Playback Settings */}
          {(isSearching
            ? matchingCategories.has("playback")
            : activeCategory === "playback") && (
            <SettingsCard
              icon={<Volume2 size={18} className="text-brand-light" />}
              title="Playback & Audio"
              subtitle="Configure volume, language defaults, and theater mode behavior."
            >
              {/* Playback Volume */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {settings.playback.volume === 0 ? (
                      <VolumeX size={16} className="text-zinc-500" />
                    ) : settings.playback.volume < 50 ? (
                      <Volume1 size={16} className="text-zinc-400" />
                    ) : (
                      <Volume2 size={16} className="text-brand-light" />
                    )}
                    <span className="text-sm font-medium text-zinc-200">
                      Default volume
                    </span>
                  </div>
                  <span className="text-xs font-mono font-semibold text-zinc-300 bg-white/5 border border-white/10 rounded-md px-2 py-0.5">
                    {settings.playback.volume}%
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={settings.playback.volume}
                    onChange={(e) =>
                      savePreference({
                        playback: { volume: Number(e.target.value) },
                      })
                    }
                    className="flex-1 accent-brand h-1.5 bg-white/10 rounded-lg cursor-pointer"
                  />
                </div>
              </div>

              <div className="border-t border-white/5 pt-4 space-y-4">
                <SettingRow
                  label="Audio-only in Now Playing"
                  description="Keep video sound in the background player and use Theater for video picture."
                >
                  <Switch
                    checked={settings.playback.playVideoInSidebar}
                    onChange={(playVideoInSidebar) =>
                      savePreference({ playback: { playVideoInSidebar } })
                    }
                  />
                </SettingRow>

                <SettingRow
                  label="Subtitles enabled by default"
                  description="Automatically activate saved or stream subtitles when playback starts."
                >
                  <Switch
                    checked={settings.playback.subtitlesEnabled}
                    onChange={(subtitlesEnabled) =>
                      savePreference({ playback: { subtitlesEnabled } })
                    }
                  />
                </SettingRow>
              </div>

              <div className="border-t border-white/5 pt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <LanguageSelect
                  label="Preferred audio language"
                  value={settings.playback.defaultAudioLanguage}
                  onChange={(defaultAudioLanguage) =>
                    savePreference({
                      playback: { defaultAudioLanguage },
                    })
                  }
                />
                <LanguageSelect
                  label="Preferred subtitle language"
                  value={settings.playback.defaultSubtitleLanguage}
                  onChange={(defaultSubtitleLanguage) =>
                    savePreference({
                      playback: { defaultSubtitleLanguage },
                    })
                  }
                />
              </div>
            </SettingsCard>
          )}

          {/* Library Settings */}
          {(isSearching
            ? matchingCategories.has("library")
            : activeCategory === "library") && (
            <SettingsCard
              icon={<Database size={18} className="text-brand-light" />}
              title="Library & Appearance"
              subtitle="Customize media card layouts, filename formatting, and folder scanning."
            >
              <SettingRow
                label="Default library view"
                description="Choose whether the library defaults to grid cards or list rows."
              >
                <div className="flex items-center bg-black/40 border border-white/10 rounded-xl p-1 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      savePreference({ library: { viewMode: "list" } })
                    }
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                      settings.library.viewMode === "list"
                        ? "bg-brand text-zinc-100 shadow-xs shadow-brand-glow"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <List size={14} />
                    <span>List</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      savePreference({ library: { viewMode: "grid" } })
                    }
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                      settings.library.viewMode === "grid"
                        ? "bg-brand text-zinc-100 shadow-xs shadow-brand-glow"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <Grid2X2 size={14} />
                    <span>Grid</span>
                  </button>
                </div>
              </SettingRow>

              <div className="border-t border-white/5 pt-4 space-y-4">
                <SettingRow
                  label="Show video thumbnails"
                  description="Display cached video poster snapshots in library media cards."
                >
                  <Switch
                    checked={settings.library.showThumbnails}
                    onChange={(showThumbnails) =>
                      savePreference({ library: { showThumbnails } })
                    }
                  />
                </SettingRow>

                <SettingRow
                  label="Show file extensions"
                  description="Include filename extensions (.mp4, .mkv, .mp3) in media titles."
                >
                  <Switch
                    checked={settings.library.showFileExtensions}
                    onChange={(showFileExtensions) =>
                      savePreference({ library: { showFileExtensions } })
                    }
                  />
                </SettingRow>
              </div>

              {/* Excluded Folders Field */}
              <div className="border-t border-white/5 pt-4">
                <ExcludedFoldersManager
                  value={settings.library.excludedFolderNames}
                  onSave={(excludedFolderNames) =>
                    savePreference({ library: { excludedFolderNames } })
                  }
                />
              </div>

              {/* Library Reindex Action */}
              <div className="mt-auto border border-white/5 p-4 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white/[0.02]">
                <div>
                  <div className="text-sm font-medium text-zinc-200">
                    Rebuild media index
                  </div>
                  <div className="text-xs text-zinc-400 mt-0.5">
                    Rescans all watched library folders and cleans missing
                    entries.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleReindex()}
                  disabled={hasActiveScans}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-brand/40 bg-brand/15 px-4 py-2 text-xs sm:text-sm font-medium text-brand-light transition-all hover:border-brand/60 hover:bg-brand/25 disabled:cursor-wait disabled:opacity-50 shrink-0 cursor-pointer shadow-xs shadow-brand-glow/30"
                >
                  {hasActiveScans ? (
                    <LoaderCircle size={15} className="animate-spin" />
                  ) : (
                    <RefreshCw size={15} />
                  )}
                  <span>
                    {hasActiveScans
                      ? "Indexing library…"
                      : "Reindex library"}
                  </span>
                </button>
              </div>
            </SettingsCard>
          )}

          {/* Downloads Settings */}
          {(isSearching
            ? matchingCategories.has("downloads")
            : activeCategory === "downloads") && (
            <SettingsCard
              icon={<Download size={18} className="text-brand-light" />}
              title="Downloads & Updates"
              subtitle="Manage default storage directories and automatic application update checks."
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-200">
                    Downloads directory
                  </span>
                  <span className="text-xs text-zinc-500">
                    {settings.downloads.folder
                      ? "Custom folder"
                      : "Default system path"}
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 bg-black/40 border border-white/5 rounded-xl">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FolderOpen
                      size={16}
                      className="text-brand-light shrink-0"
                    />
                    <span
                      className="text-xs font-mono text-zinc-300 truncate"
                      title={
                        settings.downloads.folder ?? "System Downloads"
                      }
                    >
                      {settings.downloads.folder ??
                        "System Downloads folder"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                    {settings.downloads.folder && (
                      <button
                        type="button"
                        onClick={() => void resetDownloadFolder()}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-white/10 transition-colors cursor-pointer"
                      >
                        <RotateCcw size={12} />
                        <span>Reset</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void chooseDownloadFolder()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-brand/40 bg-brand/15 px-3 py-1.5 text-xs font-medium text-brand-light hover:border-brand/60 hover:bg-brand/25 transition-all shadow-xs shadow-brand-glow/30 cursor-pointer"
                    >
                      <Folder size={12} />
                      <span>Choose folder</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="border-t border-white/5 pt-4">
                <SettingRow
                  label="Automatic updates"
                  description="Allow Navio to check for application and backend tool updates automatically."
                >
                  <Switch
                    checked={settings.updates.automatic}
                    onChange={(automatic) =>
                      savePreference({ updates: { automatic } })
                    }
                  />
                </SettingRow>
              </div>
            </SettingsCard>
          )}

          {/* About & Shortcuts */}
          {(isSearching
            ? matchingCategories.has("about")
            : activeCategory === "about") && (
            <SettingsCard
              icon={<Sparkles size={18} className="text-brand-light" />}
              title="About & Shortcuts"
              subtitle="Application details, local privacy model, and keyboard shortcut guide."
            >
              {/* App Overview Card */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-white/[0.02] border border-white/5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-brand/15 border border-brand/30 flex items-center justify-center text-brand-light shrink-0">
                    <Info size={20} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-100">
                        Navio Player
                      </span>
                      <span className="text-[11px] font-mono text-zinc-400 bg-white/5 border border-white/10 rounded-md px-2 py-0.5">
                        v{__APP_VERSION__}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      Privacy-first local media player & stream downloader.
                    </p>
                  </div>
                </div>
                <div className="text-[11px] text-zinc-400 bg-black/40 border border-white/5 rounded-lg px-3 py-1.5 self-start sm:self-auto">
                  Local-first & No accounts
                </div>
              </div>

              {/* Keyboard Shortcuts Trigger */}
              <div className="border-t border-white/5 pt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-zinc-200">
                    Keyboard shortcuts
                  </div>
                  <div className="text-xs text-zinc-400 mt-0.5">
                    View player hotkeys (
                    <kbd className="font-mono bg-white/5 px-1 rounded">
                      Space
                    </kbd>
                    ,{" "}
                    <kbd className="font-mono bg-white/5 px-1 rounded">
                      F
                    </kbd>
                    ,{" "}
                    <kbd className="font-mono bg-white/5 px-1 rounded">
                      Q
                    </kbd>
                    ,{" "}
                    <kbd className="font-mono bg-white/5 px-1 rounded">
                      ?
                    </kbd>
                    )
                  </div>
                </div>
                <button
                  type="button"
                  onClick={openKeyboardShortcutsModal}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-xs sm:text-sm font-medium text-zinc-300 transition-colors hover:border-white/20 hover:bg-white/10 shrink-0 cursor-pointer"
                >
                  <Keyboard size={15} className="text-brand-light" />
                  <span>View shortcut cheat sheet</span>
                </button>
              </div>
            </SettingsCard>
          )}

          {/* Danger Zone / Data Management */}
          {(isSearching
            ? matchingCategories.has("danger")
            : activeCategory === "danger") && (
            <div className="bg-panel-bg/40 backdrop-blur-xl rounded-2xl border border-red-500/20 p-6 shadow-xl space-y-6 flex-1 flex flex-col">
              <div className="flex items-start gap-3 border-b border-red-500/10 pb-4 shrink-0">
                <div className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 shrink-0">
                  <ShieldAlert size={18} />
                </div>
                <div>
                  <h2 className="text-base font-medium text-red-200">
                    Local Data & Maintenance
                  </h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Destructive local database actions. Your media files on
                    disk will not be altered.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-black/40 border border-white/5 rounded-xl">
                  <div>
                    <div className="text-sm font-medium text-zinc-200">
                      Clear download history
                    </div>
                    <div className="text-xs text-zinc-400 mt-0.5">
                      Remove download job logs, with an option to keep or
                      purge downloaded files.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openAction("clear-history")}
                    className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/5 px-3.5 py-2 text-xs sm:text-sm font-medium text-zinc-300 transition-colors hover:border-white/20 hover:bg-white/10 shrink-0 cursor-pointer"
                  >
                    Clear history…
                  </button>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-red-950/20 border border-red-500/20 rounded-xl">
                  <div>
                    <div className="text-sm font-medium text-red-200">
                      Full application reset
                    </div>
                    <div className="text-xs text-zinc-400 mt-0.5">
                      Wipes local databases and restores settings to fresh
                      defaults.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openAction("full-reset")}
                    className="inline-flex items-center justify-center rounded-lg border border-red-500/40 bg-red-500/15 px-3.5 py-2 text-xs sm:text-sm font-medium text-red-200 transition-all hover:bg-red-500/25 hover:border-red-500/60 shrink-0 cursor-pointer"
                  >
                    Full reset…
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* No search results found */}
          {isSearching && matchingCategories.size === 0 && (
            <div className="p-12 text-center bg-panel-bg/30 border border-white/5 rounded-2xl space-y-3">
              <AlertTriangle
                size={24}
                className="mx-auto text-zinc-500"
              />
              <div className="text-sm font-medium text-zinc-300">
                No settings found for "{searchQuery}"
              </div>
              <p className="text-xs text-zinc-500 max-w-sm mx-auto">
                Try searching for volume, subtitles, library, thumbnails,
                downloads, or shortcuts.
              </p>
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="text-xs text-brand-light hover:underline pt-2 inline-block cursor-pointer"
              >
                Clear search filter
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modals */}
      <SettingsActionModal
        isOpen={activeAction === "clear-history"}
        title="Clear download history"
        description="Choose whether to keep the downloaded files on your computer or remove them along with their history records."
        error={actionError}
        actions={[
          { label: "Keep files", value: false },
          { label: "Delete files", value: true, destructive: true },
        ]}
        onConfirm={(deleteFiles) => void clearHistory(deleteFiles)}
        onClose={() => setActiveAction(null)}
      />

      <SettingsActionModal
        isOpen={activeAction === "full-reset"}
        title="Full reset"
        description="This removes all Navio internal databases, preferences, and cached downloader tools, then reloads the app. Your personal media files stay safe on disk."
        error={actionError}
        actions={[{ label: "Reset Navio", value: true, destructive: true }]}
        onConfirm={() => void resetAllDatabases()}
        onClose={() => setActiveAction(null)}
      />
    </div>
  );
}

/** Standard container card for grouped settings. */
function SettingsCard({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-panel-bg/40 backdrop-blur-xl rounded-2xl border border-white/5 p-6 shadow-xl space-y-5 flex-1 flex flex-col">
      <div className="flex items-start gap-3 border-b border-white/5 pb-4 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-brand/10 border border-brand/20 flex items-center justify-center shrink-0 mt-0.5">
          {icon}
        </div>
        <div>
          <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
          <p className="text-xs text-zinc-400 mt-0.5">{subtitle}</p>
        </div>
      </div>
      <div className="space-y-5 flex-1 flex flex-col justify-start">{children}</div>
    </section>
  );
}

/** Unified row layout for toggles and selector controls. */
function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div className="space-y-0.5 min-w-0 pr-2">
        <div className="text-sm font-medium text-zinc-200">{label}</div>
        <div className="text-xs text-zinc-400 leading-relaxed">
          {description}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Enhanced excluded folders manager with chips and defaults reset. */
function ExcludedFoldersManager({
  value,
  onSave,
}: {
  value: string[];
  onSave: (value: string[]) => void;
}) {
  const [draft, setDraft] = useState(value.join(", "));
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    setDraft(value.join(", "));
  }, [value]);

  function handleSaveDraft() {
    const parsed = parseLibraryExclusions(draft);
    setDraft(parsed.join(", "));
    if (parsed.join("\0") !== value.join("\0")) {
      onSave(parsed);
    }
    setIsEditing(false);
  }

  function handleResetDefaults() {
    const defaults = [...DEFAULT_LIBRARY_EXCLUSIONS];
    setDraft(defaults.join(", "));
    onSave(defaults);
    setIsEditing(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-zinc-200">
            Ignored folder names
          </div>
          <div className="text-xs text-zinc-400 mt-0.5">
            Folders matching these names are skipped anywhere during library
            scans.
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isEditing && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="text-xs text-brand-light hover:underline cursor-pointer"
            >
              Edit raw list
            </button>
          )}
          <button
            type="button"
            onClick={handleResetDefaults}
            className="text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer"
            title="Reset to standard exclusions"
          >
            Reset defaults
          </button>
        </div>
      </div>

      {isEditing ? (
        <div className="space-y-2">
          <textarea
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={handleSaveDraft}
            autoFocus
            spellCheck={false}
            placeholder="e.g. node_modules, .git, target, dist"
            className="w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-xs sm:text-sm text-zinc-200 outline-none transition-colors focus:border-brand/50 focus:ring-1 focus:ring-brand/30 font-mono"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleSaveDraft}
              className="inline-flex items-center gap-1 text-xs bg-brand/15 border border-brand/30 text-brand-light rounded-lg px-2.5 py-1 hover:bg-brand/25 cursor-pointer"
            >
              <Check size={12} />
              <span>Done</span>
            </button>
          </div>
        </div>
      ) : (
        <div
          onClick={() => setIsEditing(true)}
          className="flex flex-wrap gap-1.5 p-3 rounded-xl bg-black/30 border border-white/5 hover:border-white/10 transition-colors cursor-pointer group"
          title="Click to edit ignored folders list"
        >
          {value.map((folder) => (
            <span
              key={folder}
              className="inline-flex items-center text-[11px] font-mono text-zinc-300 bg-white/5 border border-white/5 rounded-md px-2 py-0.5 group-hover:border-white/10 transition-colors"
            >
              {folder}
            </span>
          ))}
          {value.length === 0 && (
            <span className="text-xs text-zinc-500 italic">
              No folders ignored. Click to configure.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Standard language selector dropdown row. */
function LanguageSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <div className="space-y-1.5">
      <span className="block text-xs font-medium text-zinc-400">
        {label}
      </span>
      <Select
        options={[
          { value: "", label: "Auto (Stream default)" },
          ...NAVIO_LANGUAGE_OPTIONS.map(([code, name]) => ({
            value: code,
            label: name,
          })),
        ]}
        value={value ?? ""}
        onChange={(selectedValue) => onChange(selectedValue || null)}
      />
    </div>
  );
}

