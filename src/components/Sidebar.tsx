import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  LayoutDashboard,
  Database,
  Download,
  ListMusic,
  Settings as SettingsIcon,
} from "lucide-react";

/// Sidebar wrapper component displaying navigation links.
export function Sidebar() {
  return (
    <aside className="w-64 bg-panel-bg/95 backdrop-blur-2xl border-r border-white/5 flex flex-col p-6 shrink-0">
      {/* Brand Logo */}
      <div className="flex items-center gap-4 mb-10">
        <img
          src="/logo.png"
          alt="Navio Player Logo"
          className="w-15 h-15 object-contain"
        />
        <span className="text-2xl font-medium tracking-wide bg-linear-to-r from-zinc-200 to-zinc-400 bg-clip-text text-transparent">
          Navio
        </span>
      </div>

      {/* Nav Links */}
      <nav className="space-y-1">
        <SidebarLink
          to="/"
          icon={<LayoutDashboard size={18} />}
          label="Dashboard"
        />
        <SidebarLink
          to="/library"
          icon={<Database size={18} />}
          label="My Library"
        />
        <SidebarLink
          to="/downloader"
          icon={<Download size={18} />}
          label="Downloader"
        />
        <SidebarLink
          to="/playlists"
          icon={<ListMusic size={18} />}
          label="Playlists"
        />
        <SidebarLink
          to="/settings"
          icon={<SettingsIcon size={18} />}
          label="Settings"
        />
      </nav>
    </aside>
  );
}

interface SidebarLinkProps {
  to: string;
  icon: ReactNode;
  label: string;
}

/// Helper link component that applies active border and color highlights.
function SidebarLink({ to, icon, label }: SidebarLinkProps) {
  return (
    <Link
      to={to}
      activeProps={{
        className:
          "bg-brand/10 text-brand-light border-l-2 border-brand font-medium",
      }}
      inactiveProps={{
        className: "text-zinc-400 hover:text-zinc-200 hover:bg-white/5",
      }}
      className="flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 text-sm border-l-2 border-transparent font-medium"
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}
