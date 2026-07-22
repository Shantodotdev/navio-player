# Activity and Smart Playlists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist meaningful local playback activity and expose Recently Added, Recently Played, Continue Watching, and Most Played throughout Navio.

**Architecture:** A versioned Rust `activity` service owns `activity.json`, reconciliation, progress, pruning, and corruption recovery. React receives activity records with the live library, tracks meaningful playback through one root hook, derives the four collections through a pure helper, and renders shared read-only collection UI.

**Tech Stack:** Rust 2021, Tauri 2, Serde JSON, Tokio, React 19, TypeScript, Zustand, TanStack Router, Vitest, Tailwind CSS 4.

## Global Constraints

- Refer to the product as Navio in user-facing text and code comments.
- Keep all activity data local and validate paths at the Rust boundary.
- Do not add artist, album, genre, accounts, cloud services, or online metadata.
- Existing library files initialize without `added_at`; only later discoveries enter Recently Added.
- Recently Played qualifies after 10 seconds of meaningful playback.
- Most Played increments once per session after 50 percent or four minutes, whichever comes first.
- Do not implement Milestones 2–4.
- Do not run development servers or production builds.
- Do not perform git write commands unless explicitly requested.

---

### Task 1: Rust activity database

**Files:**
- Create: `src-tauri/src/activity/mod.rs`
- Create: `src-tauri/src/activity/models.rs`
- Create: `src-tauri/src/activity/storage.rs`
- Create: `src-tauri/src/activity/service.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: Rust unit tests colocated in the new activity modules

**Interfaces:**
- Produces: `ActivityStore::load`, `ActivityStore::reconcile`, `ActivityStore::record_milestone`, `ActivityStore::record_progress`, and serializable `ActivityEntry`.

- [ ] Write failing Rust tests for first initialization, later discovery, atomic round trip, malformed backup, theater resume import, pruning, and milestone updates.
- [ ] Run the focused activity tests and confirm they fail because the module is absent.
- [ ] Add the versioned database models:

```rust
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ActivityEntry {
  pub media_id: String,
  pub path: String,
  pub added_at_ms: Option<u64>,
  pub last_played_at_ms: Option<u64>,
  pub play_count: u64,
  pub resume_position_secs: f64,
  pub duration_secs: f64,
  pub progress_updated_at_ms: Option<u64>,
  pub last_seen_at_ms: u64,
}
```

- [ ] Implement serialized, atomic load/modify/save operations and recover malformed files by renaming them before initializing defaults.
- [ ] Implement reconciliation so the first current catalog is known without dates while later IDs receive `added_at_ms`.
- [ ] Implement the one-time theater resume import and absent-entry pruning.
- [ ] Run the focused Rust activity tests and confirm they pass.

### Task 2: Tauri activity commands and library integration

**Files:**
- Modify: `src-tauri/src/application.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/library/scanner.rs`
- Modify: `src-tauri/src/media_tools/operations.rs`
- Modify: `src-tauri/src/settings.rs`
- Test: relevant Rust module tests

**Interfaces:**
- Consumes: `ActivityStore` and `ActivityEntry` from Task 1.
- Produces: library response field `activity`, command `record_playback_milestone`, and `activity-updated` progress events.

- [ ] Write failing tests for stable ID validation, reset coverage, and activity response serialization.
- [ ] Add `ActivityStore` to `AppState` and initialize it during Tauri setup.
- [ ] Make the existing stable media ID helper available at the crate boundary.
- [ ] Reconcile activity after each live-library build and return `HashMap<String, ActivityEntry>` beside tracks.
- [ ] Add a typed milestone command accepting only `recently_played` or `play_count`, validate the canonical path and stable ID, and return the updated entry.
- [ ] Mirror theater progress into activity after a successful existing theater-state save and emit the updated entry.
- [ ] Add `activity.json` to the full reset list.
- [ ] Run relevant Rust tests and confirm they pass.

### Task 3: Smart-playlist domain helpers

**Files:**
- Create: `src/lib/smartPlaylists.ts`
- Create: `src/lib/smartPlaylists.test.ts`
- Modify: `src/store/libraryStore.ts`
- Modify: `src/hooks/useLibrary.ts`

**Interfaces:**
- Produces: `MediaActivity`, `SmartPlaylist`, `deriveSmartPlaylists`, and Zustand `updateActivity`.

- [ ] Write failing Vitest cases for filtering, 30-item limits, ordering, unavailable media, resume cutoffs, and deterministic ties.
- [ ] Define the fixed collection descriptors and pure derivation function:

```ts
export type SmartPlaylistId =
  | "recently-added"
  | "recently-played"
  | "continue-watching"
  | "most-played";

export function deriveSmartPlaylists(
  tracks: Track[],
  activity: Record<string, MediaActivity>,
): SmartPlaylist[];
```

- [ ] Extend the library response/store with activity records and merge updated records without rescanning.
- [ ] Expose derived smart playlists from `useLibrary`.
- [ ] Run `npm run test:unit -- src/lib/smartPlaylists.test.ts` and confirm it passes.

### Task 4: Meaningful playback tracker

**Files:**
- Create: `src/lib/playbackActivity.ts`
- Create: `src/lib/playbackActivity.test.ts`
- Create: `src/hooks/usePlaybackActivity.ts`
- Modify: `src/routes/__root.tsx`
- Modify: `src/hooks/useLibrarySync.ts`

**Interfaces:**
- Consumes: the shared `mediaElement`, current `Track`, and `updateActivity`.
- Produces: one session controller that emits `recently_played` and `play_count` milestones once.

- [ ] Write failing tests for ten-second recent qualification, half-or-four-minute count qualification, paused time, seek resets, short media, once-per-session delivery, and track changes.
- [ ] Implement a pure playback session controller that accumulates bounded forward media-time deltas and exposes milestone events.
- [ ] Implement one root hook that attaches to the shared media element, preserves a session across player-surface changes for the same track, invokes Rust, and merges returned entries.
- [ ] Subscribe to `activity-updated` events so video progress appears without a library rescan.
- [ ] Mount the hook once in the root route.
- [ ] Run the focused playback-activity tests and confirm they pass.

### Task 5: Shared smart-playlist UI

**Files:**
- Modify: `src/routes/index.tsx`
- Modify: `src/routes/playlists.tsx`
- Modify: `src/components/NowPlayingDrawer.tsx`

**Interfaces:**
- Consumes: `SmartPlaylist[]` from `useLibrary` and `playTrack(track, playlist.tracks)`.
- Produces: Home sections, Smart playlists cards, Now Playing sidebar integration, See all, and Play All.

- [ ] Replace the false filesystem-order recent list on Home with non-empty activity collections.
- [ ] Render video resume progress for Continue Watching.
- [ ] Add Smart playlists above Your playlists while retaining all existing playlist editing behavior.
- [ ] Open generated collections in the standard Now Playing sidebar and retain Play All.
- [ ] Ensure empty smart cards remain visible only on Playlists and explain how they populate.
- [ ] Inspect responsive states and keyboard-accessible button semantics.

### Task 6: Major-change verification and documentation alignment

**Files:**
- Modify if required: `README.md`
- Modify if required: `docs/roadmap.md`

- [ ] Run focused frontend unit tests.
- [ ] Run `npm run lint`.
- [ ] Run `npm run typecheck`.
- [ ] Run `cargo fmt --check --manifest-path src-tauri/Cargo.toml` or the equivalent manifest-scoped format check.
- [ ] Run `cargo clippy --manifest-path src-tauri/Cargo.toml`.
- [ ] Confirm no production build or development server was run.
- [ ] Inspect the final diff for unrelated changes and generated-file edits.
