# Concurrent Library Scans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Add folder reusable while different configured directories scan concurrently with independent progress and cancellation inside the directory card.

**Architecture:** Replace the exclusive Rust scan coordinator with a job registry keyed by UUID and serialize only configuration writes and short SQLite publications. React tracks progress per job/root, separates the native-picker guard from scan state, and renders scan controls in each directory row.

**Tech Stack:** Rust, Tauri 2, rusqlite, rayon, React 19, TypeScript, Zustand, Vitest.

## Global Constraints

- Always call the product Navio.
- Different roots scan concurrently; the same normalized root cannot scan twice.
- Rayon's global pool bounds metadata work across all jobs.
- Do not show routine success toasts or a page-wide scan status panel.
- Do not run development servers or builds.
- Do not commit without explicit user authorization.

---

### Task 1: Concurrent scan registry

**Files:**
- Modify: `src-tauri/src/library/scan.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/watcher/runtime.rs`

**Interfaces:**
- Produces: `ScanCoordinator::begin(root)`, `statuses()`, `cancel(job_id)`, `has_active_jobs()`, and root-scoped `finish(job)`.
- Changes commands to return all statuses and cancel by `job_id`.

- [x] Add failing tests proving different roots coexist, duplicate roots fail, and cancelling one job leaves the other active.
- [x] Run focused Rust tests and confirm failure.
- [x] Replace singular coordinator state with a job registry keyed by job ID and normalized root.
- [x] Add a SQLite busy timeout and adapt watcher deferral to `has_active_jobs()`.
- [x] Run focused Rust tests until green.

### Task 2: Race-safe folder registration and concurrent rebuild

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/application.rs`
- Modify: `src-tauri/src/commands.rs`

**Interfaces:**
- Produces: `library_config_lock: tokio::sync::Mutex<()>`.
- `scan_folder` persists and authorizes a root before scanning.
- `rebuild_library_index` runs one independent job per inactive configured root.

- [x] Reuse normalized-root tests and inspect the serialized reload/merge/save critical section.
- [x] Run focused Rust tests for active-root deduplication.
- [x] Serialize reload/add/save configuration while leaving metadata scanning concurrent.
- [x] Preserve configured roots after cancellation or failure.
- [x] Run focused Rust tests until green.

### Task 3: Per-directory frontend progress

**Files:**
- Modify: `src/store/libraryStore.ts`
- Modify: `src/store/libraryStore.test.ts`
- Modify: `src/hooks/useLibrary.ts`
- Modify: `src/hooks/useLibrarySync.ts`
- Modify: `src/routes/library.tsx`
- Modify: `src/routes/settings.tsx`

**Interfaces:**
- Produces: `scanJobs`, `pendingScanRoots`, `isFolderPickerOpen`, `setScanProgress`, and `cancelLibraryScan(jobId)`.
- The directory card renders progress by normalized root.

- [x] Add failing Vitest cases for immediate button reuse, multiple jobs, job-scoped completion, and job-scoped cancellation.
- [x] Run focused tests and confirm failure.
- [x] Separate picker state from scan promises and merge status arrays/events by job ID.
- [x] Move spinner, counts, and cancellation into each directory row.
- [x] Keep Add folder icon/label stable and disable it only while the picker is open.
- [x] Run focused frontend tests until green.

### Task 4: Documentation and verification

**Files:**
- Modify: `README.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/superpowers/plans/2026-07-26-concurrent-library-scans.md`

- [x] Document concurrent per-root scans and per-directory progress.
- [x] Run Rust formatting and strict Clippy.
- [x] Run all Rust and frontend tests.
- [x] Run TypeScript, ESLint, and `git diff --check`.
- [x] Inspect the changed files and mark this plan complete.
