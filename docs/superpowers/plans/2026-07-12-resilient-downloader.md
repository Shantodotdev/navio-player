# Resilient Downloader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and control Navio yt-dlp jobs so users can pause, resume/retry, cancel, and recover accurately after interruption or app restart.

**Architecture:** Introduce a Rust `DownloadManager` that owns JSON persistence and the active-process registry. yt-dlp runs in per-job staging directories with machine-readable markers; the React page loads backend state, consumes full job events, and dispatches explicit commands.

**Tech Stack:** Tauri 2, Tokio process management, Rust serde JSON, React 19, TypeScript, Vitest.

## Global Constraints

- Navio remains local-first; no remote job service or account is added.
- Cancel must delete only that job's partial artifacts.
- Pause must retain artifacts and resume through yt-dlp's default continuation behavior.
- Never parse normal yt-dlp progress text when a structured output marker can be used.
- Do not run development servers or production builds without explicit permission.

---

### Task 1: Define and persist download jobs

**Files:**
- Create: `src-tauri/src/downloader/models.rs`
- Create: `src-tauri/src/downloader/manager.rs`
- Modify: `src-tauri/src/downloader/mod.rs`
- Test: inline Rust unit tests in `models.rs` and `manager.rs`

**Interfaces:**
- Produces `DownloadJob`, `DownloadStatus`, `DownloadRequest`, and cloneable `DownloadManager`.
- Produces `DownloadManager::{load,create,recover_interrupted,list,update,remove}`.

- [ ] Write failing tests that deserialize a legacy/missing status safely, convert every active status to `interrupted`, and reject an invalid status transition.
- [ ] Run `cargo test downloader::` and confirm the tests fail because the new model/manager do not exist.
- [ ] Add snake_case serialized statuses, a versioned `downloads.json`, atomic writes, and one lock protecting read-modify-write operations.
- [ ] Run `cargo test downloader::` and confirm model/persistence tests pass.

### Task 2: Implement supervised yt-dlp processes and cleanup

**Files:**
- Modify: `src-tauri/src/downloader/command.rs`
- Modify: `src-tauri/src/downloader/events.rs`
- Modify: `src-tauri/src/downloader/tools.rs`
- Test: inline Rust unit tests in `command.rs`

**Interfaces:**
- Consumes `DownloadManager` and `DownloadRequest`.
- Produces Tauri commands `start_download`, `pause_download`, `resume_download`, `cancel_download`, `get_downloads`, and `remove_download`.
- Emits `download-updated` with a complete `DownloadJob` after every durable transition.

- [ ] Write failing tests for command eligibility, per-job cleanup path validation, structured progress-marker parsing, and retry state reset.
- [ ] Run `cargo test downloader::` and confirm they fail for the missing helpers.
- [ ] Register each child with `kill_on_drop(true)`; use an action token to distinguish pause/cancel/exit from a genuine yt-dlp failure.
- [ ] Run yt-dlp with a private `home` and `temp` staging path, `--continue`, a fixed `--progress-template`, and `--print after_move:filepath`; parse only these markers.
- [ ] On completion move staged files to the user download directory, emitting `completed` only after the final move. On cancel remove the private staging tree; on pause/failure/interruption retain it.
- [ ] Run `cargo test downloader::` and confirm the state/control helpers pass.

### Task 3: Recover jobs through the Tauri lifecycle

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/application.rs`
- Test: inline Rust unit tests in `manager.rs`

**Interfaces:**
- Adds `download_manager: DownloadManager` to `AppState`.
- `setup` loads `downloads.json` and converts durable active states to `interrupted` before the renderer can request them.

- [ ] Write a failing recovery test showing a persisted `downloading` job becomes `interrupted` without removing its staging path.
- [ ] Initialize the manager during bootstrap and expose all job commands in the Tauri handler.
- [ ] On `RunEvent::Exit`, synchronously persist active jobs as interrupted before the runtime drops children.
- [ ] Run `cargo test downloader::` and confirm recovery is covered.

### Task 4: Replace renderer-local history with backend jobs

**Files:**
- Modify: `src/routes/downloader.tsx`
- Create: `src/lib/downloads.ts`
- Test: `src/lib/downloads.test.ts`

**Interfaces:**
- `DownloadJob` mirrors the Rust serialized job shape exactly.
- `loadDownloads`, `startDownload`, `pauseDownload`, `resumeDownload`, `cancelDownload`, `removeDownload` gracefully no-op/fail in browser mode.

- [ ] Write a failing TypeScript test for status labels/filters and an exhaustive state-to-action mapping.
- [ ] Replace localStorage reads/writes and legacy events with initial backend loading plus `download-updated` subscription.
- [ ] Add Pause/Resume, Retry, Cancel, Remove-history, and open-folder actions with disabled states while a command is in flight.
- [ ] Show `paused`, `cancelled`, `interrupted`, and diagnostic error text distinctly; make retry available only for paused, failed, and interrupted jobs.
- [ ] Run `npm run test -- src/lib/downloads.test.ts` and confirm the new state helpers pass.

### Task 5: Verify the system

**Files:**
- Modify only files above as required by verification fixes.

- [ ] Run `cargo fmt --check` and `cargo clippy`.
- [ ] Run `npm run lint` and `npm run typecheck`.
- [ ] Manually validate: start, pause, resume, cancel, retry-after-failure, app-close/relaunch, and one playlist with an intentionally unavailable item.
