import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Info,
  Settings as SettingsIcon,
  ShieldAlert,
  Volume2,
} from "lucide-react";
import { Switch } from "../components/Switch";
import { SettingsActionModal } from "../components/SettingsActionModal";
import { NAVIO_LANGUAGE_OPTIONS } from "../lib/mediaLanguages";
import { useSettingsStore } from "../store/settingsStore";

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
  const [message, setMessage] = useState("");
  const [activeAction, setActiveAction] = useState<
    "clear-history" | "full-reset" | null
  >(null);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    setMessage("");
  }, [settings]);

  async function chooseDownloadFolder() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose download folder",
      });
      if (typeof selected === "string")
        await updateSettings({ downloads: { folder: selected } });
    } catch {
      setMessage("Folder selection is available in the Navio desktop app.");
    }
  }

  async function clearHistory(deleteFiles: boolean) {
    try {
      await clearDownloadHistory(deleteFiles);
      setActiveAction(null);
      setMessage("Download history cleared."); // TODO: use toast
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Could not clear download history.",
      );
    }
  }

  async function resetAllDatabases() {
    try {
      await resetDatabases();
      window.location.reload();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Could not reset Navio databases.",
      );
    }
  }

  function openAction(action: "clear-history" | "full-reset") {
    setActionError("");
    setActiveAction(action);
  }

  if (!isLoaded) return <div className="text-zinc-400">Loading settings…</div>;

  return (
    <div className="space-y-6 max-w-4xl mx-auto font-medium select-none text-zinc-405">
      <div className="mb-10">
        <h1 className="text-4xl font-medium text-zinc-200 tracking-tight">
          Settings
        </h1>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="flex flex-col gap-2 md:col-span-1">
          <SettingsTab active icon={<SettingsIcon size={18} />}>
            General settings
          </SettingsTab>
          <SettingsTab icon={<Info size={18} />}>About Navio</SettingsTab>
        </div>
        <div className="md:col-span-2 space-y-6">
          <section className="bg-panel-bg/30 backdrop-blur-md rounded-2xl border border-white/5 p-6 space-y-4">
            <SectionTitle
              icon={<Volume2 size={20} />}
              title="Playback preferences"
            />
            <SliderRow
              label="Playback volume"
              value={settings.playback.volume}
              onChange={(volume) =>
                void updateSettings({ playback: { volume } })
              }
            />
            <ToggleRow
              label="Audio-only videos in Now Playing"
              description="Keep video audio in the sidebar and use Theater for the video picture."
              checked={settings.playback.playVideoInSidebar}
              onChange={(playVideoInSidebar) =>
                void updateSettings({ playback: { playVideoInSidebar } })
              }
            />
            <ToggleRow
              label="Subtitles enabled by default"
              description="Use saved or default subtitles when available."
              checked={settings.playback.subtitlesEnabled}
              onChange={(subtitlesEnabled) =>
                void updateSettings({ playback: { subtitlesEnabled } })
              }
            />
            <LanguageSelect
              label="Default audio language"
              value={settings.playback.defaultAudioLanguage}
              onChange={(defaultAudioLanguage) =>
                void updateSettings({ playback: { defaultAudioLanguage } })
              }
            />
            <LanguageSelect
              label="Default subtitle language"
              value={settings.playback.defaultSubtitleLanguage}
              onChange={(defaultSubtitleLanguage) =>
                void updateSettings({ playback: { defaultSubtitleLanguage } })
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
                void updateSettings({ library: { showThumbnails } })
              }
            />
            <ToggleRow
              label="Show file extensions"
              description="Include extensions in media names."
              checked={settings.library.showFileExtensions}
              onChange={(showFileExtensions) =>
                void updateSettings({ library: { showFileExtensions } })
              }
            />
            <div className="flex items-center justify-between py-2">
              <span className="text-zinc-200">Default library view</span>
              <select
                value={settings.library.viewMode}
                onChange={(event) =>
                  void updateSettings({
                    library: {
                      viewMode: event.target.value as "list" | "grid",
                    },
                  })
                }
                className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-zinc-200"
              >
                <option value="list">List</option>
                <option value="grid">Grid</option>
              </select>
            </div>
          </section>

          <section className="bg-panel-bg/30 backdrop-blur-md rounded-2xl border border-white/5 p-6 space-y-4">
            <SectionTitle
              icon={<SettingsIcon size={20} />}
              title="Downloads and updates"
            />
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-zinc-200">Downloads folder</div>
                <div className="text-sm text-zinc-500 break-all">
                  {settings.downloads.folder ?? "System Downloads folder"}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    void updateSettings({ downloads: { folder: null } })
                  }
                  disabled={!settings.downloads.folder}
                  className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-40 text-zinc-200"
                >
                  Reset
                </button>
                <button
                  onClick={() => void chooseDownloadFolder()}
                  className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-zinc-200"
                >
                  Choose
                </button>
              </div>
            </div>
            <ToggleRow
              label="Automatic updates"
              description="Allow Navio to check for application and downloader updates."
              checked={settings.updates.automatic}
              onChange={(automatic) =>
                void updateSettings({ updates: { automatic } })
              }
            />
          </section>

          <section className="bg-panel-bg/30 rounded-2xl border border-red-400/10 p-6 space-y-3">
            <SectionTitle
              icon={<ShieldAlert size={20} />}
              title="Local data actions"
            />
            <button
              onClick={() => openAction("clear-history")}
              className="block text-left text-zinc-300 hover:text-white"
            >
              Clear download history
            </button>
            <button
              onClick={() => openAction("full-reset")}
              className="block text-left text-red-300 hover:text-red-200"
            >
              Full reset
            </button>
            {message && <p className="text-sm text-brand-light">{message}</p>}
          </section>

          <section className="bg-panel-bg/30 rounded-2xl border border-white/5 p-6 space-y-4">
            <SectionTitle
              icon={<Info size={20} />}
              title="About Navio Player"
            />
            <p className="text-sm text-zinc-500">
              Navio is a privacy-focused local media player. Your library,
              preferences, and history remain on this computer.
            </p>
          </section>
        </div>
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
      <select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
        className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-zinc-200"
      >
        <option value="">Auto</option>
        {NAVIO_LANGUAGE_OPTIONS.map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}
function SettingsTab({
  active,
  children,
  icon,
}: {
  active?: boolean;
  children: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      className={`flex items-center gap-3 px-4.5 py-3 rounded-lg text-left text-base transition-all ${active ? "bg-brand/10 text-brand-light border-l-2 border-brand" : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5 border-l-2 border-transparent"}`}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}
