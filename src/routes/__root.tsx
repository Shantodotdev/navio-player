import {
  Outlet,
  HeadContent,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { Titlebar } from "../components/Titlebar";
import { Sidebar } from "../components/Sidebar";
import { PlayerBar } from "../components/PlayerBar";
import { NowPlayingDrawer } from "../components/NowPlayingDrawer";
import { usePlayerStore } from "../store/playerStore";
import "../styles.css";

export const Route = createRootRoute({
  component: Root,
});

export default function Root() {
  const { setStreamPort } = usePlayerStore();

  useEffect(() => {
    // Initialize tauri client port on client boot
    const initTauri = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const port = await invoke<number>("get_stream_port");
        setStreamPort(port);
      } catch (err) {
        console.warn(
          "Tauri environment not detected or server port call failed:",
          err,
        );
      }
    };

    initTauri();
  }, [setStreamPort]);

  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <div className="flex flex-col h-screen w-screen overflow-hidden bg-dark-bg text-gray-200">
          <Titlebar />

          <div className="flex flex-1 overflow-hidden relative">
            <Sidebar />
            <main className="flex-1 flex flex-col h-full overflow-hidden bg-linear-to-br from-dark-bg to-[#12070a]">
              <div className="flex-1 overflow-y-auto p-8 pb-8">
                <Outlet />
              </div>
            </main>
            <NowPlayingDrawer />
          </div>

          <PlayerBar />
        </div>
        <Scripts />
      </body>
    </html>
  );
}
