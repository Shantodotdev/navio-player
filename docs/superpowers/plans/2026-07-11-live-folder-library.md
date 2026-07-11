# Live Folder Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Navio persist only scanned folders and derive the current media library from the filesystem whenever the app loads or refreshes.

**Architecture:** `library.json` stores only `scanned_directories`. Rust builds a transient `LibraryView` by scanning those directories on demand, while the runtime watcher emits refresh events without persisting file records. Playlists remain independent snapshots, and theater metadata remains in its existing cache.

**Tech Stack:** Tauri 2, Rust, notify, React 19, TypeScript, Zustand.

## Global Constraints

- Refer to the product as Navio.
- Do not hand-edit generated files.
- Do not use `any`.
- Preserve independent playlist persistence.
- Preserve secure directory-based streaming authorization.
- Do not run development servers or production builds.

### Task 1: Define the new persistence and view contracts

**Files:** `src-tauri/src/library/models.rs`, `src-tauri/src/library/mod.rs`, Rust unit tests.

- [x] Make `LibraryDb` persist only `scanned_directories`.
- [x] Add serializable `LibraryView` containing scanned directories and derived tracks.
- [x] Add tests proving legacy persisted track arrays are ignored and new saves contain only folder configuration.

### Task 2: Build live views from configured folders

**Files:** `src-tauri/src/library/scanner.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/application.rs`.

- [x] Add a Rust helper that scans every configured folder and returns a `LibraryView`.
- [x] Make `get_library` derive the view from disk.
- [x] Make `scan_folder` add/normalize the folder, persist only configuration, then return a complete live view.
- [x] Refresh secure streaming authorization from the configured directories.

### Task 3: Change watcher behavior from catalog mutation to refresh notification

**Files:** `src-tauri/src/watcher/synchronization.rs`, `src-tauri/src/watcher/runtime.rs`.

- [x] Stop modifying `library.json` in response to events.
- [x] Emit `library-updated` after relevant debounced filesystem activity.
- [x] Keep startup watch registration based only on persisted folders.

### Task 4: Update frontend library persistence calls

**Files:** `src/store/libraryStore.ts`, `src/hooks/useLibrary.ts`.

- [x] Use the live `LibraryView` response while keeping the current Track UI contract.
- [x] Load library and playlists independently.
- [x] Save only scanned directory configuration when removing a folder.
- [x] Keep playlist snapshots untouched by live library refreshes.

### Task 5: Harden path handling and verify

**Files:** `src-tauri/src/commands.rs`, `src-tauri/src/server/streaming.rs`, `src-tauri/src/media_tools/persistence.rs`, affected tests.

- [x] Replace raw path-prefix authorization with component-aware directory containment.
- [x] Normalize folder paths before persistence and watcher registration.
- [x] Run Rust formatting/checks and frontend lint/type checks.
- [x] Inspect the final diff for unrelated changes and generated-file edits.
