import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Info,
  Settings as SettingsIcon,
  ShieldAlert,
  Volume2,
} from "lucide-react";
import { Switch } from "../components/Switch";
import { Select } from "../components/Select";
import { SettingsActionModal } from "../components/SettingsActionModal";
import { NAVIO_LANGUAGE_OPTIONS } from "../lib/mediaLanguages";
import {
  useSettingsStore,
  type PartialSettingsUpdate,
} from "../store/settingsStore";
import { toast } from "../store/toastStore";
import { getErrorMessage } from "../lib/errorMessage";

export const Route = createFileRoute("/settings")({ component: SettingsView });

/** Renders persisted Navio preferences and destructive local-data actions. */
function SettingsView() {
  const {
    settings,
    isLoaded,
    updateSettings,
    clearDownloadHistory,
    resetDatabases,
  } = useSettingsStore();
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

  if (!isLoaded) return <div className="text-zinc-400">Loading settings…</div>;

  return (
    <div className="space-y-6 max-w-6xl mx-auto font-medium select-none text-zinc-405">
      <div className="mb-6">
        <h1 className="text-4xl font-medium text-zinc-200 tracking-tight">
          Settings
        </h1>
      </div>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
        <section className="bg-panel-bg/30 backdrop-blur-md rounded-2xl border border-white/5 p-6 space-y-4 sm:col-span-2">
          <SectionTitle
            icon={<Volume2 size={20} />}
            title="Playback preferences"
          />
          <SliderRow
            label="Playback volume"
            value={settings.playback.volume}
            onChange={(volume) => savePreference({ playback: { volume } })}
          />
          <ToggleRow
            label="Audio-only videos in Now Playing"
            description="Keep video audio in the sidebar and use Theater for the video picture."
            checked={settings.playback.playVideoInSidebar}
            onChange={(playVideoInSidebar) =>
              savePreference({ playback: { playVideoInSidebar } })
            }
          />
          <ToggleRow
            label="Subtitles enabled by default"
            description="Use saved or default subtitles when available."
            checked={settings.playback.subtitlesEnabled}
            onChange={(subtitlesEnabled) =>
              savePreference({ playback: { subtitlesEnabled } })
            }
          />
          <LanguageSelect
            label="Default audio language"
            value={settings.playback.defaultAudioLanguage}
            onChange={(defaultAudioLanguage) =>
              savePreference({ playback: { defaultAudioLanguage } })
            }
          />
          <LanguageSelect
            label="Default subtitle language"
            value={settings.playback.defaultSubtitleLanguage}
            onChange={(defaultSubtitleLanguage) =>
              savePreference({ playback: { defaultSubtitleLanguage } })
            }
          />
        </section>

        <section className="bg-panel-bg/30 backdrop-blur-md rounded-2xl border border-white/5 p-6 space-y-4">
          <SectionTitle
            icon={<SettingsIcon size={20} />}
            title="Library and interface"
          />
          <ToggleRow
            label="Show thumbnails"
            description="Display cached video artwork in library cards."
            checked={settings.library.showThumbnails}
            onChange={(showThumbnails) =>
              savePreference({ library: { showThumbnails } })
            }
          />
          <ToggleRow
            label="Show file extensions"
            description="Include extensions in media names."
            checked={settings.library.showFileExtensions}
            onChange={(showFileExtensions) =>
              savePreference({ library: { showFileExtensions } })
            }
          />
          <div className="flex items-center justify-between py-2">
            <span className="text-zinc-200">Default library view</span>
            <div className="w-36 shrink-0">
              <Select
                options={[
                  { value: "list", label: "List" },
                  { value: "grid", label: "Grid" },
                ]}
                value={settings.library.viewMode}
                onChange={(value) =>
                  savePreference({
                    library: { viewMode: value as "list" | "grid" },
                  })
                }
              />
            </div>
          </div>
        </section>

        <section className="bg-panel-bg/30 backdrop-blur-md rounded-2xl border border-white/5 p-6 space-y-4">
          <SectionTitle
            icon={<SettingsIcon size={20} />}
            title="Downloads and updates"
          />
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <div className="text-zinc-200">Downloads folder</div>
              <div className="text-sm text-zinc-500 break-all">
                {settings.downloads.folder ?? "System Downloads folder"}
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => void resetDownloadFolder()}
                disabled={!settings.downloads.folder}
                className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/5 px-3.5 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-white/20 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => void chooseDownloadFolder()}
                className="inline-flex items-center justify-center rounded-lg border border-brand/40 bg-brand/15 px-3.5 py-2 text-sm font-medium text-brand-light shadow-sm shadow-brand-glow/30 transition-colors hover:border-brand/60 hover:bg-brand/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
              >
                Choose
              </button>
            </div>
          </div>
          <ToggleRow
            label="Automatic updates"
            description="Allow Navio to check for application and downloader updates."
            checked={settings.updates.automatic}
            onChange={(automatic) => savePreference({ updates: { automatic } })}
          />
        </section>

        <section className="bg-panel-bg/30 rounded-2xl border border-red-400/10 p-6 space-y-3">
          <SectionTitle
            icon={<ShieldAlert size={20} />}
            title="Local data actions"
          />
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => openAction("clear-history")}
              className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/5 px-3.5 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-white/20 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            >
              Clear download history
            </button>
            <button
              type="button"
              onClick={() => openAction("full-reset")}
              className="inline-flex items-center justify-center rounded-lg border border-red-400/30 bg-red-500/10 px-3.5 py-2 text-sm font-medium text-red-300 transition-colors hover:border-red-400/50 hover:bg-red-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50"
            >
              Full reset
            </button>
          </div>
        </section>

        <section className="bg-panel-bg/30 rounded-2xl border border-white/5 p-6 space-y-4">
          <SectionTitle icon={<Info size={20} />} title="About Navio Player" />
          <p className="text-sm text-zinc-500">
            Navio is a privacy-focused local media player. Your library,
            preferences, and history remain on this computer.
          </p>
        </section>
      </div>
      <SettingsActionModal
        isOpen={activeAction === "clear-history"}
        title="Clear download history"
        description="Choose whether to keep the downloaded files or remove them along with their history records."
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
        description="This removes Navio databases plus FFmpeg and yt-dlp, then reloads Navio. Your media and downloaded files stay on disk."
        error={actionError}
        actions={[{ label: "Reset Navio", value: true, destructive: true }]}
        onConfirm={() => void resetAllDatabases()}
        onClose={() => setActiveAction(null)}
      />
    </div>
  );
}

function SectionTitle({
  icon,
  title,
}: {
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-white/5 pb-3.5">
      <span className="text-brand-light">{icon}</span>
      <h2 className="text-lg font-medium text-zinc-200">{title}</h2>
    </div>
  );
}
function SliderRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex justify-between text-base text-zinc-400">
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <input
        type="range"
        min="0"
        max="100"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="flex-1 accent-brand h-1 bg-white/10 rounded-lg cursor-pointer"
      />
    </div>
  );
}
function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <div className="text-base text-zinc-200">{label}</div>
        <div className="text-sm text-zinc-500">{description}</div>
      </div>
      <Switch checked={checked} onChange={onChange} />
    </div>
  );
}
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
    <label className="flex items-center justify-between gap-4 py-2 text-zinc-200">
      <span>{label}</span>
      <div className="w-36 shrink-0">
        <Select
          options={[
            { value: "", label: "Auto" },
            ...NAVIO_LANGUAGE_OPTIONS.map(([code, name]) => ({
              value: code,
              label: name,
            })),
          ]}
          value={value ?? ""}
          onChange={(selectedValue) => onChange(selectedValue || null)}
        />
      </div>
    </label>
  );
}
