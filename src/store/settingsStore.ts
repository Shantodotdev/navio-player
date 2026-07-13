import { create } from "zustand";

export type LibraryViewMode = "list" | "grid";

export interface NavioSettings {
  version: number;
  playback: {
    volume: number;
    playVideoInSidebar: boolean;
    defaultAudioLanguage: string | null;
    defaultSubtitleLanguage: string | null;
    subtitlesEnabled: boolean;
  };
  library: {
    showThumbnails: boolean;
    viewMode: LibraryViewMode;
    showFileExtensions: boolean;
  };
  downloads: { folder: string | null };
  interface: { nowPlayingDrawerWidth: number };
  updates: { automatic: boolean };
}

export const DEFAULT_SETTINGS: NavioSettings = {
  version: 1,
  playback: {
    volume: 80,
    playVideoInSidebar: true,
    defaultAudioLanguage: null,
    defaultSubtitleLanguage: null,
    subtitlesEnabled: false,
  },
  library: {
    showThumbnails: true,
    viewMode: "list",
    showFileExtensions: false,
  },
  downloads: { folder: null },
  interface: { nowPlayingDrawerWidth: 640 },
  updates: { automatic: true },
};

interface SettingsState {
  settings: NavioSettings;
  isLoaded: boolean;
  loadSettings: () => Promise<void>;
  updateSettings: (update: PartialSettingsUpdate) => Promise<void>;
  clearDownloadHistory: (deleteFiles: boolean) => Promise<void>;
  resetDatabases: () => Promise<void>;
}

type PartialSettingsUpdate = {
  playback?: Partial<NavioSettings["playback"]>;
  library?: Partial<NavioSettings["library"]>;
  downloads?: Partial<NavioSettings["downloads"]>;
  interface?: Partial<NavioSettings["interface"]>;
  updates?: Partial<NavioSettings["updates"]>;
};

/** Whether the current renderer can call Tauri commands. */
const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Converts the Rust snake_case settings contract into the frontend camel_case shape. */
function fromBackend(value: BackendSettings): NavioSettings {
  return {
    version: value.version,
    playback: {
      volume: value.playback.volume,
      playVideoInSidebar: value.playback.play_video_in_sidebar,
      defaultAudioLanguage: value.playback.default_audio_language,
      defaultSubtitleLanguage: value.playback.default_subtitle_language,
      subtitlesEnabled: value.playback.subtitles_enabled,
    },
    library: {
      showThumbnails: value.library.show_thumbnails,
      viewMode: value.library.view_mode === "grid" ? "grid" : "list",
      showFileExtensions: value.library.show_file_extensions,
    },
    downloads: { folder: value.downloads.folder },
    interface: {
      nowPlayingDrawerWidth: value.interface.now_playing_drawer_width,
    },
    updates: { automatic: value.updates.automatic },
  };
}

/** Converts frontend preferences to the typed Rust persistence contract. */
function toBackend(value: NavioSettings): BackendSettings {
  return {
    version: value.version,
    playback: {
      volume: value.playback.volume,
      play_video_in_sidebar: value.playback.playVideoInSidebar,
      default_audio_language: value.playback.defaultAudioLanguage,
      default_subtitle_language: value.playback.defaultSubtitleLanguage,
      subtitles_enabled: value.playback.subtitlesEnabled,
    },
    library: {
      show_thumbnails: value.library.showThumbnails,
      view_mode: value.library.viewMode,
      show_file_extensions: value.library.showFileExtensions,
    },
    downloads: { folder: value.downloads.folder },
    interface: {
      now_playing_drawer_width: value.interface.nowPlayingDrawerWidth,
    },
    updates: { automatic: value.updates.automatic },
  };
}

interface BackendSettings {
  version: number;
  playback: {
    volume: number;
    play_video_in_sidebar: boolean;
    default_audio_language: string | null;
    default_subtitle_language: string | null;
    subtitles_enabled: boolean;
  };
  library: {
    show_thumbnails: boolean;
    view_mode: string;
    show_file_extensions: boolean;
  };
  downloads: { folder: string | null };
  interface: { now_playing_drawer_width: number };
  updates: { automatic: boolean };
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  isLoaded: false,
  loadSettings: async () => {
    if (!isTauri()) {
      set({ isLoaded: true });
      return;
    }
    const { invoke } = await import("@tauri-apps/api/core");
    const backend = await invoke<BackendSettings>("get_settings");
    set({ settings: fromBackend(backend), isLoaded: true });
  },
  updateSettings: async (update) => {
    const next: NavioSettings = {
      ...get().settings,
      ...update,
      playback: { ...get().settings.playback, ...update.playback },
      library: { ...get().settings.library, ...update.library },
      downloads: { ...get().settings.downloads, ...update.downloads },
      interface: { ...get().settings.interface, ...update.interface },
      updates: { ...get().settings.updates, ...update.updates },
    };
    set({ settings: next });
    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_settings", { settings: toBackend(next) });
    }
  },
  clearDownloadHistory: async (deleteFiles) => {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("clear_download_history", { deleteFiles });
  },
  resetDatabases: async () => {
    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("reset_databases");
    }
    set({ settings: DEFAULT_SETTINGS, isLoaded: true });
  },
}));
