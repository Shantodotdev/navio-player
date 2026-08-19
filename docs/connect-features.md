# Navio Connect & Remote: Product Requirements & Feature Specifications

This document records the complete feature specification, behavioral requirements, and user expectations for **Navio Connect** (Local Network Multi-Device Ecosystem) and the **Navio Remote Web App (PWA)**.

---

## 1. Core Principles & Non-Functional Requirements

- **Local-First Security & Isolation**
  - All communication occurs securely over the local network (LAN) with token-based authentication and zero open unauthenticated ports.
  - Zero cloud accounts, zero centralized tracking, and zero telemetry.
  - Memory-safe, leak-free background services built on Rust with strict boundary validation.
- **Concurrent Multi-Device Support**
  - A single host machine can serve multiple paired devices simultaneously (e.g., 3 different devices streaming a movie or controlling playback at the same time).
- **Responsive Universal UI**
  - Interfaces adapt seamlessly to all form factors: mobile phones (iOS / Android), tablets (iPad / Android tablets), and desktop operating systems (Windows, macOS, Linux).

---

## 2. Network Topology & Roles

```
┌────────────────────────────────────────────────────────┐
│                   DESKTOP PEER A                       │
│  (Host & Controller - Library, Downloader, Streaming)  │
└──────────────────────────┬─────────────────────────────┘
                           │ ◄─── Two-Way (Bi-directional) ───►
                           ▼
┌────────────────────────────────────────────────────────┐
│                   DESKTOP PEER B                       │
│  (Host & Controller - Library, Downloader, Streaming)  │
└──────────────────────────┬─────────────────────────────┘
                           │
             ▲             │ ◄─── One-Way (Controller / Client)
             │             ▼
┌────────────────────────────────────────────────────────┐
│              MOBILE / IPAD (Hosted PWA)                │
│  (Client & Remote Controller - Control, Stream, Queue) │
└────────────────────────────────────────────────────────┘
```

1. **Desktop-to-Desktop (Two-Way Peer-to-Peer)**:
   - Any desktop Navio instance can see other desktop instances' music/video libraries.
   - Either desktop can control playback on the other or stream media stored on the other.
2. **Mobile & Tablet / iPad (Client & Remote Controller)**:
   - Phones and tablets connect as authenticated client nodes.
   - They do not host local filesystem libraries; instead, they control desktop playback, stream media from desktops, and queue remote downloads.

---

## 3. Detailed Feature Specifications

### A. Granular Per-Device Permissions & Access Control

Each device has full control over what permissions are granted to each paired peer:

- **Allow Viewing Library**: Toggle whether the peer can browse your media index and playlists.
- **Allow Media Streaming**: Toggle whether the peer can stream video/audio files from your storage.
- **Allow Playback Control**: Toggle whether the peer can send play, pause, seek, volume, and queue commands.
- **Allow Remote Downloader**: Toggle whether the peer can send download requests to your machine.
- **Revoke / Block**: Instant revocation of a paired device at any time.

### B. Remote Media Downloader

- **Cross-Device Download Initiation**:
  - A phone, tablet, or secondary desktop can dispatch download jobs to a target desktop host (e.g., pasting a video/audio URL into the phone while on the couch).
  - The target desktop executes the download via its local downloader engine (`yt-dlp` / FFmpeg) and saves the media directly into its local library.
- **Live Download Progress**:
  - The initiating device receives live progress updates (percentage, speed, ETA, and completion toasts).

### C. Universal Media Streaming ("Play Here")

- Any paired device can stream videos and audio directly from a host desktop's storage over Wi-Fi.
- Instant seeking and scrubbing via chunked HTTP range streaming without waiting for entire file downloads.

### D. Smart Playback Progress & "Continue Watching" Sync

- **Automatic Progress Syncing**:
  - For long-form media (e.g., movies or videos $\ge$ 10 minutes, configurable), playback timestamps are synchronized back to the host machine in real time.
- **Seamless Resume**:
  - If a user watches 15 minutes of a movie on their phone or tablet in bed, opening the same movie on the desktop the next day automatically resumes from 15:00 under the "Continue Watching" row.

### E. Dedicated Online-Hosted PWA (Mobile & iPad)

- **Zero App Store Barrier**:
  - The remote controller and mobile player is hosted online (e.g., `remote.navio.app`).
  - Works on Safari (iOS), Chrome (Android), iPadOS, and desktop browsers.
- **Installable Standalone App**:
  - Full PWA support with "Add to Home Screen" on iOS and Android for a native, full-screen experience with no browser address bars.
- **Local LAN Pairing**:
  - Once opened or installed, the web app connects directly to the desktop on the local network via QR code scan or auto-discovery.
- **Lock-Screen & Notification Media Controls**:
  - Native media notifications and lock-screen controls via the browser MediaSession API.

---

## 4. Edge Cases, Connectivity & Host Management

1. **Auto-Reconnection (Foreground Only)**:
   - When the user opens the Navio desktop app or mobile PWA, it automatically reconnects to the last-used paired host on the local network without prompting for a PIN.
   - Reconnection only occurs while the app/PWA is active in the foreground; no battery-draining background network polling when closed or minimized.
2. **Multi-Host Switching**:
   - If multiple Navio host desktops are active on the same Wi-Fi network (e.g., "Living Room PC" and "Office Mac"), the user can switch between hosts with a single tap from the device switcher menu.
3. **Host Status & Offline Awareness**:
   - Clear visual status indicators for each host (Online, Sleeping, Offline, or Unreachable).
   - If a host goes to sleep or disconnects, the UI displays a clean, non-intrusive status banner rather than crashing or throwing errors.
4. **Format & Codec Compatibility**:
   - Direct streaming optimized for standard browser-compatible formats (MP4, WebM, MP3, AAC, FLAC, Opus).
5. **Simultaneous Stream Bandwidth Protection**:
   - Non-blocking asynchronous I/O in Rust ensuring high throughput even when 3+ devices stream simultaneously.
