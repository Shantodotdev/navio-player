# Incremental Library Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace full recursive library rebuilds with a persistent, cancellable, incremental local media index.

**Architecture:** `library.json` continues to store configured roots while a rebuildable SQLite database stores media metadata and root membership. A Rust scan coordinator emits progress, watcher batches update only changed paths, and React displays compact button-level progress without restoring the removed status panel.

**Tech Stack:** Rust, Tauri 2, rusqlite, rayon, notify, React 19, TypeScript, Zustand, Vitest.

## Global Constraints

- Always call the product Navio.
- Keep all index data local and preserve playlists independently.
- Do not follow directory symlinks.
- Do not show routine success toasts.
- Do not reintroduce the large library scan-status panel.
- Do not hand-edit generated lockfile content.

---

### Task 1: Path policy and index storage

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock` through Cargo
- Create: `src-tauri/src/library/path_policy.rs`
- Create: `src-tauri/src/library/index.rs`
- Modify: `src-tauri/src/library/mod.rs`
- Modify: `src-tauri/src/library/models.rs`
- Modify: `src-tauri/src/settings.rs`

**Interfaces:**
- Produces: `normalize_existing_directory`, `path_key`,
  `is_excluded_descendant`, and `LibraryIndex`.
- Produces: `DEFAULT_EXCLUDED_DIRECTORY_NAMES`.

- [x] Write failing Rust tests for Windows-prefix normalization, exact path
  deduplication, descendant exclusions, SQLite round trips, root removal, and
  orphan cleanup.
- [x] Run the focused Rust tests and confirm the missing interfaces fail.
- [x] Add `rusqlite` with bundled SQLite and `rayon` through Cargo.
- [x] Implement the path policy and transactional SQLite index.
- [x] Extend settings with excluded folder names and reset cleanup for SQLite
  sidecar files.
- [x] Run the focused Rust tests until green.

### Task 2: Cancellable incremental scanning

**Files:**
- Create: `src-tauri/src/library/scan.rs`
- Modify: `src-tauri/src/library/scanner.rs`
- Modify: `src-tauri/src/library/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/application.rs`

**Interfaces:**
- Consumes: `LibraryIndex`, path policy, and configured exclusions.
- Produces: `ScanCoordinator`, `LibraryScanProgress`,
  `scan_roots_incrementally`, and `cancel`.

- [x] Write failing Rust tests for excluded-tree pruning, unchanged metadata
  reuse, cancellation before publication, and per-root replacement.
- [x] Run focused tests and confirm the new scan contract fails.
- [x] Implement iterative discovery and bounded parallel metadata probing.
- [x] Emit throttled progress and publish each completed root transactionally.
- [x] Add the coordinator to `AppState` and start first-run/background
  reconciliation without blocking renderer startup.
- [x] Run focused Rust tests until green.

### Task 3: Cached commands and incremental watcher

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/application.rs`
- Modify: `src-tauri/src/watcher/runtime.rs`
- Modify: `src-tauri/src/watcher/synchronization.rs`

**Interfaces:**
- Produces Tauri commands: `get_library`, `scan_folder`,
  `cancel_library_scan`, `get_library_scan_status`, and
  `rebuild_library_index`.
- Produces event: `library-scan-progress`.

- [x] Write failing tests proving `get_library` reads cached rows, adding a
  folder scans only that root, duplicates normalize to one root, and changed
  paths do not request a full rebuild.
- [x] Run the tests and confirm current full-scan behavior fails them.
- [x] Switch `get_library` to the index and migrate configured paths.
- [x] Make add-folder scans root-local and make removal clear root membership.
- [x] Replace watcher refresh broadcasts with changed-path index updates before
  `library-updated`.
- [x] Register cancellation, status, and explicit reindex commands.
- [x] Run focused Rust tests until green.

### Task 4: Compact frontend progress and settings

**Files:**
- Modify: `src/store/libraryStore.ts`
- Modify: `src/store/libraryStore.test.ts`
- Modify: `src/hooks/useLibrary.ts`
- Modify: `src/hooks/useLibrarySync.ts`
- Modify: `src/routes/library.tsx`
- Modify: `src/store/settingsStore.ts`
- Modify: `src/store/settingsStore.test.ts`
- Modify: `src/routes/settings.tsx`

**Interfaces:**
- Consumes: scan-progress events and cancellation/reindex commands.
- Produces: `scanProgress`, `cancelLibraryScan`, and
  `rebuildLibraryIndex` frontend actions.

- [x] Write failing Vitest cases for progress state, terminal-state cleanup,
  cancellation, and exclusion-settings conversion.
- [x] Run focused tests and confirm the new contracts fail.
- [x] Subscribe once to progress events and reconcile status on startup.
- [x] Keep progress inside the Add Folder button and add a compact cancel
  control without a page-wide status panel.
- [x] Add editable excluded-directory names and Reindex Library to Settings.
- [x] Run focused frontend tests until green.

### Task 5: Documentation and complete verification

**Files:**
- Modify: `README.md`
- Modify: `docs/roadmap.md`

- [x] Update the architecture description from live full scans to a rebuildable
  SQLite index and incremental watcher synchronization.
- [x] Run `cargo fmt --check --manifest-path src-tauri/Cargo.toml`.
- [x] Run `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`.
- [x] Run `npm run test:rust`.
- [x] Run `npm run test:unit`.
- [x] Run `npm run typecheck`.
- [x] Run `npm run lint`.
- [x] Run `git diff --check` and inspect every changed file.
