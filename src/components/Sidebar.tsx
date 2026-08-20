import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  LayoutDashboard,
  Database,
  Download,
  ListMusic,
  Settings as SettingsIcon,
  Wifi,
} from "lucide-react";
import { useConnectStore } from "../store/connectStore";

/// Sidebar wrapper component displaying navigation links.
export function Sidebar() {
  return (
    <aside className="w-44 md:w-64 bg-panel-bg/95 backdrop-blur-2xl border-r border-white/5 flex flex-col p-3 md:p-6 shrink-0 transition-all duration-200">
      {/* Brand Logo */}
      <div className="flex items-center gap-2 md:gap-4 mb-8 md:mb-10">
        <img
          src="/logo.png"
          alt="Navio Player Logo"
          className="w-8 h-8 md:w-12 md:h-12 object-contain shrink-0"
        />
        <span className="text-lg md:text-2xl font-medium tracking-wide bg-linear-to-r from-zinc-200 to-zinc-400 bg-clip-text text-transparent truncate">
          Navio
        </span>
      </div>

      {/* Nav Links */}
      <nav className="space-y-1">
        <SidebarLink
          to="/"
          icon={<LayoutDashboard className="w-4 h-4 md:w-4.5 md:h-4.5" />}
          label="Dashboard"
        />
        <SidebarLink
          to="/library"
          icon={<Database className="w-4 h-4 md:w-4.5 md:h-4.5" />}
          label="My Library"
        />
        <SidebarLink
          to="/downloader"
          icon={<Download className="w-4 h-4 md:w-4.5 md:h-4.5" />}
          label="Downloader"
        />
        <SidebarLink
          to="/playlists"
          icon={<ListMusic className="w-4 h-4 md:w-4.5 md:h-4.5" />}
          label="Playlists"
        />
        <SidebarLink
          to="/settings"
          icon={<SettingsIcon className="w-4 h-4 md:w-4.5 md:h-4.5" />}
          label="Settings"
        />
      </nav>

      {/* Navio Connect Hub trigger button at bottom of sidebar */}
      <div className="mt-auto pt-4 border-t border-white/5">
        <ConnectSidebarButton />
      </div>
    </aside>
  );
}

function ConnectSidebarButton() {
  const { openConnectModal, activeRemoteHost, discoveredPeers } = useConnectStore();

  return (
    <button
      onClick={openConnectModal}
      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-all duration-200 text-xs md:text-sm font-medium ${
        activeRemoteHost
          ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-300"
          : "bg-white/5 hover:bg-white/10 border-white/5 text-zinc-300 hover:text-white"
      }`}
      title="Open Navio Connect devices"
    >
      <div className="flex items-center gap-2.5 truncate">
        <Wifi className={`w-4 h-4 shrink-0 ${activeRemoteHost ? "text-emerald-400" : "text-cyan-400"}`} />
        <span className="truncate">
          {activeRemoteHost ? activeRemoteHost.hostName : "Connect"}
        </span>
      </div>
      {discoveredPeers.length > 0 && !activeRemoteHost && (
        <span className="flex h-2 w-2 relative shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
        </span>
      )}
    </button>
  );
}

interface SidebarLinkProps {
  to: string;
  icon: ReactNode;
  label: string;
}

/// Applies active navigation styling and releases focus after pointer navigation.
function SidebarLink({ to, icon, label }: SidebarLinkProps) {
  return (
    <Link
      to={to}
      onClick={(event) => {
        // Pointer focus would suppress app shortcuts until another area is focused.
        if (event.detail > 0) event.currentTarget.blur();
      }}
      activeProps={{
        className:
          "bg-brand/10 text-brand-light border-l-2 border-brand font-medium",
      }}
      inactiveProps={{
        className: "text-zinc-400 hover:text-zinc-200 hover:bg-white/5",
      }}
      className="flex items-center gap-2 md:gap-3 px-2 py-2 md:px-4 md:py-3 rounded-lg transition-all duration-200 text-xs md:text-sm border-l-2 border-transparent font-medium min-w-0"
      title={label}
    >
      <span className="shrink-0 flex items-center justify-center">{icon}</span>
      <span className="truncate">{label}</span>
    </Link>
  );
}
