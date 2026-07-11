# Independent Playlists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent playlists stored independently in `playlists.json`, with embedded track snapshots that remain available after library folders are removed.

**Architecture:** Add a Rust playlist model/storage module and dedicated Tauri commands. The frontend will maintain playlist snapshots in the existing library Zustand store, while the Playlists route will provide create, rename, delete, add, remove, and playback UI. Playlist directories will be included in the secure stream allowlist at startup and after saves.

**Tech Stack:** React 19, TypeScript, Zustand, TanStack Router, Tailwind CSS 4, Tauri 2, Rust, serde, UUID.

## Global Constraints

- Playlist records contain only `id`, `name`, and embedded `tracks`; no description and no library track references.
- Playlist persistence is separate from `library.json` at `$APPDATA/navio-player/playlists.json`.
- Missing source files remain in playlist data but are not playable.
- Removing a library folder must not rewrite playlist data.
- Do not run development servers or production builds.
- Do not use `any` or hand-edit generated files.

---

### Task 1: Add independent Rust playlist persistence

**Files:**
- Create: `src-tauri/src/playlists/models.rs`
- Create: `src-tauri/src/playlists/storage.rs`
- Create: `src-tauri/src/playlists/mod.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/application.rs`

**Interfaces:**
- Produces `playlists::PlaylistsDb`, `playlists::load_db`, `playlists::save_db`, `commands::get_playlists`, and `commands::save_playlists`.

- [ ] **Step 1: Define playlist snapshot models**

Create `PlaylistsDb` with `playlists: Vec<Playlist>`, and `Playlist` with `id: String`, `name: String`, and `tracks: Vec<library::MediaItem>`, deriving serde serialization, cloning, debugging, and defaults where appropriate.

- [ ] **Step 2: Implement separate JSON storage**

Resolve `$APPDATA/navio-player/playlists.json`, create the app data directory when needed, return `PlaylistsDb::default()` when the file does not exist, parse JSON on load, and write using a temporary file followed by rename so a failed write does not truncate the existing database.

- [ ] **Step 3: Implement Tauri commands and validation**

Add `get_playlists(app_handle)` and `save_playlists(app_handle, state, db)`. Validate each playlist has a non-empty name, a unique name and ID, and tracks with non-empty IDs, absolute paths, supported media types, and finite non-negative durations. Preserve missing files, but reject malformed paths and records.

- [ ] **Step 4: Register the module and commands**

Add `mod playlists`, register both commands in `tauri::generate_handler!`, and import the module in the command layer.

- [ ] **Step 5: Format Rust files**

Run `cargo fmt --manifest-path src-tauri/Cargo.toml`.

### Task 2: Authorize playlist media for secure streaming

**Files:**
- Modify: `src-tauri/src/application.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/server/streaming.rs` only if a helper extraction is needed

**Interfaces:**
- Consumes `playlists::load_db` and the existing `AppState.allowed_directories` registry.

- [ ] **Step 1: Add a shared playlist-directory authorization helper**

Implement a helper that iterates playlist tracks, resolves each absolute path’s parent directory, and inserts existing parent directories into `allowed_directories`.

- [ ] **Step 2: Restore playlist directories during app startup**

After loading the library allowlist in `application.rs`, load `playlists.json` and authorize existing playlist track parent directories. Log the number of restored playlist directories without exposing track contents.

- [ ] **Step 3: Refresh authorization after playlist saves**

Call the helper in `save_playlists` after validation and before returning success. Do not remove library directories from the allowlist while saving playlists.

- [ ] **Step 4: Inspect security boundary**

Confirm the existing stream handler still requires the per-run token, an existing file, and membership in an authorized canonical directory.

### Task 3: Add frontend playlist state and persistence actions

**Files:**
- Modify: `src/store/libraryStore.ts`
- Modify: `src/hooks/useLibrary.ts`

**Interfaces:**
- Produces exported `Playlist` and `PlaylistsDatabase` types plus store actions `createPlaylist`, `renamePlaylist`, `deletePlaylist`, `addTrackToPlaylist`, and `removeTrackFromPlaylist`.

- [ ] **Step 1: Replace the library-linked playlist type**

Define `Playlist` as `{ id: string; name: string; tracks: Track[] }` and `PlaylistsDatabase` as `{ playlists: Playlist[] }`. Remove playlist fields from the library database contract.

- [ ] **Step 2: Load playlists independently**

Update `fetchLibrary` to load `get_library` and `get_playlists` independently. Keep library initialization and playlist initialization separately guarded so a playlist load does not require library data.

- [ ] **Step 3: Add save helper and mutation actions**

Implement a shared `savePlaylists` helper that invokes `save_playlists`. Each mutation clones the current playlist array, validates the requested change, saves the complete playlist database, and calls `set` only after the save succeeds. Use `crypto.randomUUID()` with a timestamp fallback for new IDs.

- [ ] **Step 4: Expose actions from `useLibrary`**

Return playlists and all playlist mutation actions from the hook so routes do not import persistence details directly.

### Task 4: Replace mock playlist UI with the MVP editor

**Files:**
- Modify: `src/routes/playlists.tsx`
- Modify: `src/components/CreatePlaylistModal.tsx`
- Create: `src/components/PlaylistEditorModal.tsx`

**Interfaces:**
- Consumes playlist state and mutation actions from `useLibrary`, and playback through `usePlayerStore.playTrack`.

- [ ] **Step 1: Simplify create modal**

Remove the description field and make the modal submit only a trimmed playlist name.

- [ ] **Step 2: Render persisted playlists**

Remove mock data. Load real playlists through `useLibrary`, display embedded track counts and durations, disable playback for empty or fully unavailable playlists, and mark missing files visually without deleting them.

- [ ] **Step 3: Implement editor modal**

Create a modal that supports renaming, deleting, searching current library tracks, adding tracks not already in the playlist, and removing embedded tracks. Keep the saved order and use accessible labels/buttons.

- [ ] **Step 4: Wire playlist playback**

Filter only existing files for the playback queue, preserve the playlist’s order, and call `playTrack` with the first available track and the filtered queue.

- [ ] **Step 5: Preserve visual language**

Reuse the existing dark panel, border, brand, modal, button, and typography classes; do not add a dependency or modify generated route files.

### Task 5: Verify the implementation

**Files:**
- Inspect: all modified frontend and Rust files

- [ ] **Step 1: Run frontend lint and type checks**

Run `npm run lint` and `npm run typecheck`; expected result is exit code 0.

- [ ] **Step 2: Run Rust formatting and checks**

Run `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` and `cargo check --manifest-path src-tauri/Cargo.toml`; expected result is exit code 0.

- [ ] **Step 3: Review the final diff**

Run `git diff --check` and inspect the diff for accidental changes to generated files, secrets, descriptions, library playlist references, or unrelated behavior.

