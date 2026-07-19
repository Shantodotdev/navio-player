# Navio Player: Modern Media Player & Downloader

**Navio Player** is a state-of-the-art desktop media player and playlist downloader designed to be the modern successor to traditional players like VLC. Built for speed, privacy, and visual elegance, Navio Player runs entirely on your local machine with no login or accounts required.

## Key Features

- 🎬 **Universal Playback**: A premium, custom-styled media player for both audio tracks and video streams.
- 📂 **Local Library Scanning**: Automatically scans your folders for music and videos, extracting metadata and organizing them into a unified catalog.
- 📋 **Custom Playlists**: Create and manage custom, user-defined local playlists stored securely on your desktop.
- 📥 **Universal Media Downloader**: Inspects and downloads public videos, audio tracks, and collections supported by Navio's managed `yt-dlp`, with quality, format, subtitle, and collection-range controls.
- 🤖 **Local AI Agent Control**: A packaged STDIO MCP server lets compatible coding agents inspect and control playback, search the local library, manage the queue, and download explicit media URLs without leaving the agent.
- ⚡ **High-Performance Streaming**: Uses a native Rust-based HTTP server to feed local files to the UI, enabling instant seek-scrubbing for large high-definition video files.

---

## Architecture Overview

Navio Player operates via two cooperative layers:

```
┌─────────────────────────────────────────────────────────┐
│               Frontend (TanStack Start SPA)             │
│  - React UI & Sidebar Navigation                        │
│  - Unified Background Player (Media Controller)         │
├───────────────────────────┬─────────────────────────────┤
│   Tauri IPC / Commands    │   Local HTTP Stream Server  │
│  - Trigger scans          │  - Serves media over HTTP   │
│  - Query video info       │  - Bypasses webview limits  │
│  - Manage downloads       │  - Full Range-seek support  │
├───────────────────────────┴─────────────────────────────┤
│                   Rust Backend (Tauri)                  │
│  - Directory Scanner & Lofty Tag Extractor              │
│  - Dynamic yt-dlp downloader manager                    │
│  - AppData navio-player/library.json database           │
└─────────────────────────────────────────────────────────┘
```

### 1. Frontend (Vite + React)

The frontend runs as a static Single Page Application (SPA) inside the Tauri WebView.

- **SPA Routing**: Managed client-side by TanStack Router.
- **Media Player**: Unified background video element, styled with custom design tokens.
- **Entrypoint**: TanStack Start compiles to `dist/client/_shell.html`, which a custom Vite plugin (`tauriSpaPlugin`) duplicates as `index.html` for Tauri's entrypoint.

### 2. Rust Backend & Streaming Server

The Rust backend performs security-checked file actions and system access.

- **Local HTTP Stream Server**: Running on a dynamic localhost port (via `axum`), it streams local files securely with full HTTP Range request support to allow smooth seeking and scrubbing on both audio and video files.
- **JSON Local Database**: Scanned folder configuration is stored at `$APPDATA/navio-player/library.json`; the current media list is derived from those folders at startup and on filesystem changes. Independent playlists are stored in `$APPDATA/navio-player/playlists.json`.
- **Verified yt-dlp sidecar**: Instead of bundling `yt-dlp` statically, Rust installs a pinned, checksum-verified release into `$APPDATA/navio-player/bin/` on demand. Navio updates the pinned version through application releases so an unverified executable cannot silently replace it.
- **Private MCP bridge**: The same packaged executable runs as a STDIO MCP server with `--mcp`. It discovers or starts the desktop app and communicates through a per-run authenticated loopback channel. Local searches never fall back to the internet, and online downloads require a URL explicitly supplied by the user.

---

## AI Agent Integration (STDIO MCP)

Navio's installed desktop executable is also its MCP server. Replace the example executable path below with the actual installed location on your machine. The MCP process starts Navio automatically when a tool needs the desktop player.

### Codex

Register Navio once from a terminal:

```text
codex mcp add navio -- "C:\Program Files\Navio Player\Navio Player.exe" --mcp
```

Codex shares this MCP configuration across its CLI, IDE extension, and desktop app.

### Cursor

Add Navio to Cursor's MCP JSON configuration:

```json
{
  "mcpServers": {
    "navio": {
      "command": "C:\\Program Files\\Navio Player\\Navio Player.exe",
      "args": ["--mcp"]
    }
  }
}
```

Restart or refresh the client's MCP servers after changing its configuration. Agents can then inspect playback, search and play local media, control transport and volume, edit the queue, change the player view, and download then play an explicit URL. Downloads are asynchronous: the tool returns a job ID immediately, and Navio starts playback after the completed file passes its local path validation. A missing local title returns exactly `No music found.` Some MCP hosts may ask for approval before running tools that change playback or start a download.

---

## Prerequisites for Development

Before running or building the project, ensure your environment has:

1. **Node.js**: v18 or later.
2. **Rust Toolchain**: Installed via [rustup](https://rustup.rs/).
3. **C++ Build Tools (Windows)**: Visual Studio Build Tools with the **"Desktop development with C++"** workload selected.

---

## Commands Reference

### Development

To run the desktop application in hot-reloading development mode:

```bash
npm run tauri dev
```

To run only the web interface in the browser (without compiling the desktop shell):

```bash
npm run dev
```

### Build & Release

To package the application into a standalone installer (e.g. `.msi` or `.exe` on Windows):

```bash
npm run tauri build
```

---

## File Structure

- `/src/routes` — TanStack Router file-based pages (Now Playing, Library, Playlists, Downloader).
- `/src/router.tsx` — Client router instantiation.
- `/src-tauri` — Rust backend source code.
  - `/src-tauri/src/main.rs` — Main entrypoint.
  - `/src-tauri/src/lib.rs` — Tauri setup & plugins registration.
  - `/src-tauri/capabilities/default.json` — Frontend permission capability definitions.
- `/vite.config.ts` — Vite configurations, including Tailwind CSS v4 and the `tauriSpaPlugin`.
