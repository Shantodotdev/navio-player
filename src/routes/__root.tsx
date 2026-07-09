import {
  Outlet,
  HeadContent,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import { Titlebar } from "../components/Titlebar";
import { Sidebar } from "../components/Sidebar";
import { PlayerBar } from "../components/PlayerBar";
import { NowPlayingDrawer } from "../components/NowPlayingDrawer";
import "../styles.css";

export const Route = createRootRoute({
  component: Root,
});

export default function Root() {
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
