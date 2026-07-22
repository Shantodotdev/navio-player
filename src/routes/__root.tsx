import {
  Outlet,
  HeadContent,
  Scripts,
  createRootRoute,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { Titlebar } from "../components/Titlebar";
import { Sidebar } from "../components/Sidebar";
import { PlayerBar } from "../components/PlayerBar";
import { NowPlayingDrawer } from "../components/NowPlayingDrawer";
import { KeyboardShortcuts } from "../components/KeyboardShortcuts";
import { ToastViewport } from "../components/ToastViewport";
import { usePlayerStore } from "../store/playerStore";
import { useSettingsStore } from "../store/settingsStore";
import { useLibrarySync } from "../hooks/useLibrarySync";
import { useMcpControl } from "../hooks/useMcpControl";
import { usePlaybackActivity } from "../hooks/usePlaybackActivity";
import { WatchView } from "./watch";
import "../styles.css";

export const Route = createRootRoute({
  component: Root,
});

export default function Root() {
  const { setStreamConfig, setVolume } = usePlayerStore();
  const { loadSettings } = useSettingsStore();
  useLibrarySync();
  useMcpControl();
  usePlaybackActivity();
  const isWatchRoute = useRouterState({
    select: (state) => state.location.pathname === "/watch",
  });

  useEffect(() => {
    void loadSettings().then(() => {
      setVolume(useSettingsStore.getState().settings.playback.volume);
    });
  }, [loadSettings, setVolume]);

  useEffect(() => {
    // Initialize tauri client port on client boot
    const initTauri = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const config = await invoke<{ port: number; token: string }>(
          "get_stream_config",
        );
        setStreamConfig(config);
      } catch (err) {
        console.warn(
          "Tauri environment not detected or server port call failed:",
          err,
        );
      }
    };

    initTauri();
  }, [setStreamConfig]);

  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <div className="h-screen w-screen overflow-hidden bg-dark-bg text-gray-200">
          <div
            className={`flex h-full w-full flex-col overflow-hidden ${isWatchRoute ? "invisible pointer-events-none" : ""}`}
          >
            <Titlebar />

            <div className="flex flex-1 overflow-hidden relative">
              <Sidebar />
              <main className="flex-1 flex flex-col h-full overflow-hidden bg-linear-to-br from-dark-bg to-[#12070a]">
                <div className="flex-1 overflow-y-auto p-4 md:p-8 pb-8">
                  <Outlet />
                </div>
              </main>
              <NowPlayingDrawer />
            </div>

            <PlayerBar />
          </div>
          <WatchView isActive={isWatchRoute} />
        </div>
        <ToastViewport />
        <KeyboardShortcuts />
        <Scripts />
      </body>
    </html>
  );
}
