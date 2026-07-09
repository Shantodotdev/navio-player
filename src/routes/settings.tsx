import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Settings as SettingsIcon,
  Info,
  Volume2,
  ShieldAlert,
} from "lucide-react";
import { Switch } from "../components/Switch";

export const Route = createFileRoute("/settings")({
  component: SettingsView,
});

function SettingsView() {
  const [defaultVolume, setDefaultVolume] = useState(80);
  const [hardwareAccel, setHardwareAccel] = useState(true);

  return (
    <div className="space-y-6 max-w-4xl mx-auto font-medium select-none text-zinc-405">
      {/* Top Header */}
      <div className="mb-10">
        <h1 className="text-4xl font-medium text-zinc-200 tracking-tight">
          Settings
        </h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Navigation Tabs */}
        <div className="flex flex-col gap-2 md:col-span-1">
          <SettingsTab active icon={<SettingsIcon size={18} />}>
            General settings
          </SettingsTab>
          <SettingsTab icon={<Info size={18} />}>About Navio</SettingsTab>
        </div>

        {/* Configurations Panes */}
        <div className="md:col-span-2 space-y-6">
          {/* Section 1: Playback settings */}
          <div className="relative z-30 bg-panel-bg/30 backdrop-blur-md rounded-2xl border border-white/5 p-6 space-y-4">
            <div className="flex items-center gap-2 border-b border-white/5 pb-3.5">
              <Volume2 size={20} className="text-brand-light" />
              <h2 className="text-lg font-medium text-zinc-200">
                Playback preferences
              </h2>
            </div>

            <div className="space-y-4">
              {/* Default Volume slider */}
              <div className="flex flex-col gap-2.5">
                <div className="flex justify-between text-base text-zinc-400 font-medium">
                  <span>Startup playback volume</span>
                  <span>{defaultVolume}%</span>
                </div>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={defaultVolume}
                    onChange={(e) => setDefaultVolume(Number(e.target.value))}
                    className="flex-1 accent-brand h-1 bg-white/10 rounded-lg cursor-pointer"
                  />
                </div>
              </div>

              {/* Hardware accel toggle */}
              <div className="flex items-center justify-between py-2">
                <div className="flex flex-col gap-1">
                  <span
                    className="text-base font-medium text-zinc-200 cursor-pointer select-none"
                    onClick={() => setHardwareAccel(!hardwareAccel)}
                  >
                    GPU hardware acceleration
                  </span>
                  <span className="text-sm text-zinc-500">
                    Enable webview hardware acceleration for smooth video
                    rendering.
                  </span>
                </div>
                <Switch checked={hardwareAccel} onChange={setHardwareAccel} />
              </div>
            </div>
          </div>

          {/* Section 2: About Card */}
          <div className="relative z-10 bg-panel-bg/30 backdrop-blur-md rounded-2xl border border-white/5 p-6 space-y-4">
            <div className="flex items-center gap-2 border-b border-white/5 pb-3.5">
              <Info size={20} className="text-brand-light" />
              <h2 className="text-lg font-medium text-zinc-200">
                About Navio Player
              </h2>
            </div>

            <div className="flex flex-col gap-3.5 text-base text-zinc-400">
              <div className="flex justify-between">
                <span>Application version</span>
                <span className="text-zinc-200 font-medium">v0.1.0-alpha</span>
              </div>
              <div className="flex justify-between">
                <span>Tauri shell engine</span>
                <span className="text-zinc-200 font-medium">v2.0.0-rc</span>
              </div>
              <div className="flex justify-between">
                <span>Database engine</span>
                <span className="text-zinc-200 font-medium">
                  JSON File (Native AppData)
                </span>
              </div>

              <div className="bg-brand-glow/20 border border-brand/20 rounded-xl p-4.5 flex items-start gap-3 mt-4">
                <ShieldAlert
                  size={20}
                  className="text-brand-light mt-0.5 shrink-0"
                />
                <p className="text-sm text-zinc-500 leading-relaxed font-medium">
                  Navio Player is developed as a privacy-focused local alternative
                  player. None of your local directories, track lists, or
                  history are synchronized or uploaded to external hosts. All
                  operations remain local to your computer.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
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
      className={`flex items-center gap-3 px-4.5 py-3 rounded-lg text-left text-base font-medium transition-all duration-150 cursor-pointer ${
        active
          ? "bg-brand/10 text-brand-light border-l-2 border-brand font-medium"
          : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5 border-l-2 border-transparent"
      }`}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}
