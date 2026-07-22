import { create } from "zustand";
import { getErrorMessage } from "../lib/errorMessage";
import { toast } from "./toastStore";

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
    playVideoInSidebar: false,
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
  lastPersistedSettings: NavioSettings;
  isLoaded: boolean;
  loadSettings: () => Promise<void>;
  /** Persists a partial update and restores the previous snapshot on failure. */
  updateSettings: (update: PartialSettingsUpdate) => Promise<void>;
  clearDownloadHistory: (deleteFiles: boolean) => Promise<void>;
  resetDatabases: () => Promise<void>;
}

export type PartialSettingsUpdate = {
  playback?: Partial<NavioSettings["playback"]>;
  library?: Partial<NavioSettings["library"]>;
  downloads?: Partial<NavioSettings["downloads"]>;
  interface?: Partial<NavioSettings["interface"]>;
  updates?: Partial<NavioSettings["updates"]>;
};

/** Whether the current renderer can call Tauri commands. */
const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let settingsSaveQueue: Promise<void> = Promise.resolve();

/** Serializes persistence operations and keeps the queue usable after failures. */
function enqueueSettingsOperation(operation: () => Promise<void>): Promise<void> {
  const result = settingsSaveQueue.then(operation);
  settingsSaveQueue = result.catch(() => undefined);
  return result;
}

/** Enqueues one full settings snapshot behind every earlier persistence operation. */
function enqueueSettingsSave(settings: NavioSettings): Promise<void> {
  return enqueueSettingsOperation(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_settings", { settings: toBackend(settings) });
  });
}

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
  lastPersistedSettings: DEFAULT_SETTINGS,
  isLoaded: false,
  loadSettings: async () => {
    if (!isTauri()) {
      set({ isLoaded: true });
      return;
    }
    const { invoke } = await import("@tauri-apps/api/core");
    const backend = await invoke<BackendSettings>("get_settings");
    const loadedSettings = fromBackend(backend);
    set({
      settings: loadedSettings,
      lastPersistedSettings: loadedSettings,
      isLoaded: true,
    });
  },
  updateSettings: async (update) => {
    const previous = get().settings;
    const next: NavioSettings = {
      ...previous,
      ...update,
      playback: { ...previous.playback, ...update.playback },
      library: { ...previous.library, ...update.library },
      downloads: { ...previous.downloads, ...update.downloads },
      interface: { ...previous.interface, ...update.interface },
      updates: { ...previous.updates, ...update.updates },
    };
    set({ settings: next });
    if (isTauri()) {
      try {
        await enqueueSettingsSave(next);
        set({ lastPersistedSettings: next });
      } catch (error) {
        // Only the active optimistic snapshot rolls back, always to confirmed disk state.
        set((state) =>
          state.settings === next
            ? { settings: state.lastPersistedSettings }
            : state,
        );
        toast.error("Could not save settings", {
          description: getErrorMessage(
            error,
            "Your previous preferences were restored.",
          ),
          dedupeKey: "settings-save",
        });
        throw error;
      }
    }
  },
  clearDownloadHistory: async (deleteFiles) => {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("clear_download_history", { deleteFiles });
  },
  resetDatabases: async () => {
    if (isTauri()) {
      await enqueueSettingsOperation(async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("reset_databases");
      });
    }
    set({
      settings: DEFAULT_SETTINGS,
      lastPersistedSettings: DEFAULT_SETTINGS,
      isLoaded: true,
    });
  },
}));
