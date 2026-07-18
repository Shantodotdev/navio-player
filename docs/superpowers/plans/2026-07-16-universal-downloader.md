# Universal Downloader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public, inspect-first universal media downloader with safe defaults, curated advanced options, and clear unavailable/authentication errors.

**Architecture:** A new Rust inspection module invokes Navio's verified yt-dlp in metadata-only mode and normalizes its JSON/error output. The durable request model stores typed, backward-compatible download options, while the worker translates only validated values into allowlisted yt-dlp arguments. React inspects before queueing and presents advanced controls in a collapsed panel.

**Tech Stack:** Rust, Tauri 2, Tokio, serde/serde_json, React 19, TypeScript, TanStack Router, Vitest.

## Global Constraints

- Accept only public HTTP, HTTPS, FTP, and FTPS media URLs without embedded credentials.
- Do not add cookies, credentials, custom headers, raw yt-dlp arguments, DRM handling, or arbitrary file downloads.
- Preserve durable queue recovery, private staging, and library import behavior.
- Keep best video, automatic container, no subtitles, and full collection as defaults.
- Do not run development servers or production builds.
- Do not create git commits without explicit user authorization.

---

### Task 1: Typed, backward-compatible request options

**Files:**
- Modify: `src-tauri/src/downloader/models.rs`
- Modify: `src/lib/downloads.ts`
- Modify: `src/lib/downloads.test.ts`

**Interfaces:**
- Produces Rust enums `MediaMode`, `DownloadQuality`, `VideoContainer`, `AudioFormat`, `SubtitleMode` and expanded `DownloadRequest`.
- Produces TypeScript `DownloadOptions`, `DEFAULT_DOWNLOAD_OPTIONS`, and an expanded start payload.

- [ ] Add Rust serde enums whose defaults map legacy records to video, best, auto, original, and none.
- [ ] Add optional playlist bounds and bounded subtitle-language strings to `DownloadRequest` while retaining legacy `format` deserialization.
- [ ] Add model tests that deserialize an old `{url, format, no_playlist}` record and assert all new defaults.
- [ ] Mirror the enums and defaults in `src/lib/downloads.ts` and update `createStartDownloadPayload`.
- [ ] Add frontend payload tests for defaults and explicit advanced settings.

### Task 2: Public URL inspection boundary

**Files:**
- Create: `src-tauri/src/downloader/inspection.rs`
- Modify: `src-tauri/src/downloader/mod.rs`
- Modify: `src-tauri/src/downloader/tools.rs`
- Modify: `src-tauri/src/application.rs`

**Interfaces:**
- Produces `pub async fn inspect_download_url(url: String, app_handle: AppHandle) -> Result<DownloadInspection, String>`.
- Produces shared `validate_public_media_url(url: &str) -> Result<reqwest::Url, String>`.
- Produces `DownloadInspection { source, title, thumbnail, is_collection, item_count, video_qualities, subtitle_languages }`.

- [ ] Add validation tests for allowed schemes, rejected schemes, and rejected URL userinfo.
- [ ] Add JSON fixture tests that normalize one video and one playlist response into stable inspection data.
- [ ] Add diagnostic tests mapping login/cookies/account/private/subscription errors to the public unavailable message.
- [ ] Expose the verified yt-dlp path helper to the inspection module without weakening hash checks.
- [ ] Spawn yt-dlp with `--ignore-config --dump-single-json --skip-download --no-warnings --no-playlist` only where single-item inspection is explicitly requested; otherwise inspect the source shape.
- [ ] Bound inspection to a timeout and cap stdout/stderr before JSON parsing.
- [ ] Register `inspect_download_url` with Tauri.

### Task 3: Safe yt-dlp argument generation

**Files:**
- Modify: `src-tauri/src/downloader/command.rs`
- Modify: `src-tauri/src/downloader/models.rs`

**Interfaces:**
- Consumes the Task 1 request enums.
- Produces `format_selector(request: &DownloadRequest) -> String` and an allowlisted option appender used by the worker.

- [ ] Replace string-only format validation with enum-based request validation, positive playlist bounds, ordered ranges, and bounded subtitle languages.
- [ ] Add selector tests for default video, every quality ceiling, container preference, and source audio.
- [ ] Add option tests for audio conversion, subtitle selection/all-minus-live-chat, merge containers, and playlist ranges.
- [ ] Generate `-f`, `--merge-output-format`, `--extract-audio`, `--audio-format`, subtitle, and playlist arguments exclusively from typed values.
- [ ] Reuse public URL validation in both inspection and `start_download`, so bypassing the frontend cannot launch unsupported schemes or embedded credentials.
- [ ] Expand finalized media extensions only for declared supported outputs and preserve staging containment checks.

### Task 4: Universal inspect-first frontend

**Files:**
- Modify: `src/lib/downloads.ts`
- Modify: `src/routes/downloader.tsx`

**Interfaces:**
- Produces `inspectDownloadUrl(url: string): Promise<DownloadInspection>`.
- Consumes the Task 1 default/options types and Task 2 inspection result.

- [ ] Rename the heading to `Download media` and replace the YouTube-specific placeholder with public media URL copy.
- [ ] Replace `check_url_type` with `inspectDownloadUrl`; show inspection errors without creating a queue record.
- [ ] Add a collapsed `<details>` Advanced options panel with quality, video container, audio format, subtitles, subtitle language, playlist start, and playlist end controls.
- [ ] Keep defaults preselected and show only controls relevant to Video or Audio.
- [ ] Generalize the modal to `Collection detected`, `Download entire collection`, and `Download single item`.
- [ ] Carry the inspected request/options through the modal without losing state and clear the URL only after the job is accepted.
- [ ] Use the unavailable message returned by Rust for auth-dependent sources; add no cookie or login guidance.

### Task 5: Verification and documentation alignment

**Files:**
- Modify: `README.md`
- Verify all files above.

**Interfaces:**
- Documents actual universal public-download behavior and the pinned yt-dlp update policy.

- [ ] Update README downloader wording to public yt-dlp-supported sources and remove the inaccurate `yt-dlp -U` self-update claim.
- [ ] Run `npm run test -- src/lib/downloads.test.ts` and fix only feature-related failures.
- [ ] Run `npm run lint` and fix feature-related findings.
- [ ] Run `cargo fmt --check`; if formatting differs, run `cargo fmt` and check again.
- [ ] Run `cargo test downloader::` and fix feature-related failures.
- [ ] Run `cargo clippy` and fix feature-related findings.
- [ ] Inspect `git diff --check` and the final scoped diff; do not stage or commit.
