# Navio Local MCP Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package a local stdio MCP server inside Navio's executable that securely starts, inspects, and controls the desktop player and downloads explicit URLs before playback.

**Architecture:** `Navio Player --mcp` runs the official Rust MCP SDK over stdio and forwards typed tool calls to the normal app through an authenticated dynamic loopback endpoint. A bounded Rust request broker hands commands to one root React control hook, preserving Zustand/HTML media as playback truth and Rust as the filesystem/process security boundary.

**Tech Stack:** Rust 2021, Tauri 2, Tokio, Axum, official `rmcp` Rust SDK, Reqwest, React 19, TypeScript, Zustand, Vitest.

## Global Constraints

- Always use the product name Navio in user-facing text, code comments, documentation, and conversation.
- Online media requires an explicit public URL and is downloaded before playback.
- Name lookup searches only the indexed local library and returns exactly `No music found.` when empty.
- Control is loopback-only, bearer authenticated, bounded, and never exposes filesystem access outside Navio's existing allowlist.
- `--mcp` mode writes only MCP protocol messages to stdout; diagnostics use stderr.
- Do not use TypeScript `any`.
- Add or update meaningful documentation comments for changed TypeScript and Rust functions.
- Do not run development servers or production builds.
- Do not run git write commands; project instructions override the generic skill commit steps.

---

## File structure

- Create `src-tauri/src/control/mod.rs` — control module exports.
- Create `src-tauri/src/control/models.rs` — serializable control requests, responses, descriptor, and playback snapshot.
- Create `src-tauri/src/control/broker.rs` — bounded request queue, correlation, completion, and timeout.
- Create `src-tauri/src/control/runtime.rs` — owner-only descriptor and launch-lock lifecycle.
- Create `src-tauri/src/control/http.rs` — authenticated Axum health/command handlers.
- Create `src-tauri/src/mcp/mod.rs` — MCP stdio service and tool declarations.
- Create `src-tauri/src/mcp/client.rs` — descriptor discovery, health check, app launch, and control HTTP client.
- Create `src-tauri/src/mcp/params.rs` — strict MCP input enums and schemas.
- Create `src/hooks/useMcpControl.ts` — renderer long-poll dispatcher and completed-download autoplay.
- Create `src/lib/mcpControl.ts` — strict command/result types plus pure search/validation helpers.
- Create `src/lib/mcpControl.test.ts` — renderer command/search behavior tests.
- Modify `src-tauri/src/main.rs` — dispatch normal versus `--mcp` mode.
- Modify `src-tauri/src/lib.rs` and `src-tauri/src/application.rs` — own broker/control state and register Tauri commands.
- Modify `src-tauri/src/server/{mod.rs,state.rs,startup.rs}` — mount authenticated control routes.
- Modify `src-tauri/src/library/{mod.rs,scanner.rs}` and `src-tauri/src/commands.rs` — validate and inspect one allowlisted downloaded media file.
- Modify `src/store/playerStore.ts` — shared stop, seek, and queue mutations.
- Modify `src/routes/__root.tsx` — start the renderer MCP adapter.
- Modify `src-tauri/Cargo.toml` — official MCP SDK and JSON-schema dependencies.
- Modify `README.md` — Codex/Cursor stdio setup and safety semantics.

---

### Task 1: Typed control protocol and bounded broker

**Files:**
- Create: `src-tauri/src/control/models.rs`
- Create: `src-tauri/src/control/broker.rs`
- Create: `src-tauri/src/control/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `ControlRequest { id: Uuid, command: ControlCommand }`, `ControlReply`, `ControlBroker::new(capacity)`, `enqueue(command)`, `next()`, and `complete(id, result)`.
- Consumers: HTTP handler and Tauri renderer commands.

- [ ] **Step 1: Write broker tests**

Add Tokio tests proving FIFO delivery, matching response IDs, rejection of unknown completion IDs, bounded-queue failure, and timeout cleanup. Use a 50 ms test timeout and assert the public error strings do not include payload data.

- [ ] **Step 2: Run the focused Rust test and verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml control::broker`

Expected: compilation fails because the control module does not exist.

- [ ] **Step 3: Implement models and broker**

Use a bounded `tokio::sync::mpsc` channel and `Arc<tokio::sync::Mutex<HashMap<Uuid, oneshot::Sender<_>>>>`. `enqueue` inserts the pending sender, uses `try_send`, awaits the reply under `tokio::time::timeout`, and removes pending state on every error. `next` serializes one queued command for Tauri; `complete` consumes exactly one pending sender.

- [ ] **Step 4: Run focused tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml control::broker`

Expected: all control broker tests pass.

---

### Task 2: Authenticated loopback endpoints and runtime descriptor

**Files:**
- Create: `src-tauri/src/control/http.rs`
- Create: `src-tauri/src/control/runtime.rs`
- Modify: `src-tauri/src/server/mod.rs`
- Modify: `src-tauri/src/server/state.rs`
- Modify: `src-tauri/src/server/startup.rs`
- Modify: `src-tauri/src/application.rs`

**Interfaces:**
- Consumes: `ControlBroker::enqueue`.
- Produces: `GET /control/health`, `POST /control/command`, `RuntimeDescriptor::write(port, token)`, `runtime_descriptor_path()`, and `LaunchLock`.

- [ ] **Step 1: Write HTTP and runtime tests**

Test that missing/wrong bearer tokens return 401, the correct token returns `{ "status": "ready" }`, command bodies over the configured limit return 413, malformed descriptors fail closed, atomic descriptor replacement works, and a second launch lock cannot be acquired until the first is dropped.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml control::http control::runtime`

Expected: tests fail because endpoint/runtime implementations are absent.

- [ ] **Step 3: Implement endpoint authentication and runtime files**

Generate a control UUID distinct from `stream_token`. Require `Authorization: Bearer <token>` before body deserialization. Mount routes on the existing `127.0.0.1:0` router without CORS. Write the descriptor atomically under a per-user temp/runtime directory; on Unix create it with mode `0600`. Include `version: 1`, PID, port, token, and executable path. Remove it only when it still belongs to the exiting PID.

- [ ] **Step 4: Wire application startup/shutdown**

Create one broker and control token before `start_server`, place the broker in `AppState`, write the descriptor after the listener binds, and remove the descriptor during `RunEvent::Exit` after signalling server shutdown.

- [ ] **Step 5: Run focused tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml control::http control::runtime`

Expected: authenticated endpoint and descriptor tests pass.

---

### Task 3: Tauri command bridge and allowlisted downloaded-media inspection

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/application.rs`
- Modify: `src-tauri/src/library/mod.rs`
- Modify: `src-tauri/src/library/scanner.rs`

**Interfaces:**
- Consumes: `ControlBroker::next` and `ControlBroker::complete`.
- Produces: Tauri commands `wait_for_mcp_command`, `complete_mcp_command`, and `inspect_authorized_media_file`.

- [ ] **Step 1: Write path-boundary tests**

Add tests around a temporary allowed directory proving a supported file inside it can be inspected, a sibling path is rejected after canonicalization, a missing file is rejected, and an unsupported extension is rejected.

- [ ] **Step 2: Run focused test and verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml inspect_authorized_media_file`

Expected: compilation or assertion failure because the function is absent.

- [ ] **Step 3: Implement and register Tauri commands**

`wait_for_mcp_command` awaits the next bounded broker item. `complete_mcp_command` accepts a UUID plus `Result<Value, String>` represented by explicit success/error fields. `inspect_authorized_media_file` canonicalizes the file and every allowed directory, verifies containment, and reuses the scanner's single-file metadata extraction.

- [ ] **Step 4: Run focused tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml inspect_authorized_media_file control::broker`

Expected: all focused tests pass.

---

### Task 4: Shared player actions and pure renderer control helpers

**Files:**
- Modify: `src/store/playerStore.ts`
- Create: `src/lib/mcpControl.ts`
- Create: `src/lib/mcpControl.test.ts`

**Interfaces:**
- Produces: store actions `stopPlayback()`, `seekTo(seconds)`, `seekBy(delta)`, `addToQueue(track)`, `removeQueueIndex(index)`, `clearQueue()`, `playQueueIndex(index)`; helpers `searchLocalTracks`, `resolveLocalTrack`, and `validateMcpCommand`.

- [ ] **Step 1: Write failing Vitest cases**

Cover case-insensitive title/name matching, exact matches ranked first, media-type filtering, capped results, exact `No music found.` errors, volume/seek/index range validation, queue removal before/at/after the active index, and stop resetting both DOM time and store time.

- [ ] **Step 2: Run focused test and verify failure**

Run: `npm run test -- src/lib/mcpControl.test.ts`

Expected: module/action imports fail because implementation is absent.

- [ ] **Step 3: Implement minimal typed helpers and actions**

Keep matching pure and deterministic. Never search a URL or filesystem path. Clamp media-element seeks to finite duration where available; reject non-finite inputs. Queue removal updates `playIndex` and `currentTrack` consistently, and clearing the queue keeps the current track as a singleton only while it is active.

- [ ] **Step 4: Run focused frontend tests**

Run: `npm run test -- src/lib/mcpControl.test.ts`

Expected: focused renderer tests pass.

---

### Task 5: Root renderer dispatcher and download autoplay

**Files:**
- Create: `src/hooks/useMcpControl.ts`
- Modify: `src/routes/__root.tsx`
- Modify: `src/lib/mcpControl.test.ts`

**Interfaces:**
- Consumes: Tauri bridge commands, player actions, library store, `inspectDownloadUrl`, `startDownload`, `loadDownloads`, and `listenToDownloads`.
- Produces: `useMcpControl()` and serializable replies for every `ControlCommand`.

- [ ] **Step 1: Add dispatcher tests with injected dependencies**

Test state serialization, search, play by ID/name, no-match response, each transport control action, queue edits, drawer/theater validation, download URL inspection before job creation, completed-job first-path autoplay, and failed/cancelled pending-job cleanup.

- [ ] **Step 2: Run focused test and verify failure**

Run: `npm run test -- src/lib/mcpControl.test.ts`

Expected: dispatcher cases fail because the dispatcher is absent.

- [ ] **Step 3: Implement the dispatcher and hook**

Use an abort flag around the long-poll loop. In browser-only development, a failed dynamic Tauri import stops quietly. For each received request, catch unknown errors, normalize them to a bounded string, and always invoke completion. Register one downloader event listener and a `Map<jobId, requestedKind>` for autoplay.

- [ ] **Step 4: Mount the hook once in the root component**

Call `useMcpControl()` beside the existing library/settings initialization so the bridge is ready whenever the main renderer is mounted.

- [ ] **Step 5: Run focused frontend tests**

Run: `npm run test -- src/lib/mcpControl.test.ts`

Expected: all renderer MCP tests pass.

---

### Task 6: Same-executable MCP stdio service and automatic app launch

**Files:**
- Create: `src-tauri/src/mcp/params.rs`
- Create: `src-tauri/src/mcp/client.rs`
- Create: `src-tauri/src/mcp/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: runtime descriptor and authenticated control HTTP endpoint.
- Produces: `app_lib::run_mcp()`, official MCP tools named in the design, and normal/`--mcp` process dispatch.

- [ ] **Step 1: Add the official SDK dependency through Cargo metadata**

Add the current stable official `rmcp` crate with server/macros/stdio support and `schemars` matching its public API. Allow Cargo—not manual editing—to update `Cargo.lock` during the first compile.

- [ ] **Step 2: Write client and mapping tests**

Test healthy-descriptor reuse, stale descriptor rejection, one-launch behavior under concurrent calls, launch timeout, every MCP enum/schema range, each tool's exact `ControlCommand`, JSON response preservation, and no-match wording.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml mcp::`

Expected: compilation fails because the MCP module is absent.

- [ ] **Step 4: Implement the descriptor-aware control client**

On each call, read and authenticate health against the descriptor. If unavailable, acquire `LaunchLock`, recheck health, spawn `current_exe()` without `--mcp`, and poll with bounded exponential backoff. POST commands with the control bearer token and fixed connect/request timeouts. Never log the token.

- [ ] **Step 5: Implement MCP tools and instructions**

Use `#[tool_router]`/`#[tool_handler]` with strict `schemars::JsonSchema` inputs. Annotate read-only tools as read-only and mutations as side-effecting. Return JSON text/structured output that includes explicit success, message, and data fields. Server instructions state that names are local-only and URLs must be user-supplied.

- [ ] **Step 6: Dispatch executable mode**

In `main`, detect one exact `--mcp` argument before Tauri starts. Run `app_lib::run_mcp()` and print startup/runtime failures only to stderr. Otherwise call `app_lib::run()` unchanged.

- [ ] **Step 7: Run focused MCP tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml mcp::`

Expected: client, parameter, and tool mapping tests pass.

---

### Task 7: Documentation and full verification

**Files:**
- Modify: `README.md`
- Modify as needed: files changed in Tasks 1–6

**Interfaces:**
- Produces: installation/configuration examples and a verified implementation.

- [ ] **Step 1: Document setup and workflows**

Add the installed-executable command with `--mcp`, a Codex `codex mcp add navio -- "<absolute Navio Player executable>" --mcp` example, Cursor global/project `mcp.json`, tool summary, local-only lookup rule, explicit-URL rule, asynchronous download/autoplay behavior, and host approval note.

- [ ] **Step 2: Format Rust**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml`

Expected: Rust sources are formatted.

- [ ] **Step 3: Run frontend checks**

Run: `npm run lint`

Run: `npm run typecheck`

Run: `npm run test`

Expected: all commands exit successfully.

- [ ] **Step 4: Run Rust checks**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: all commands exit successfully.

- [ ] **Step 5: Exercise stdio protocol without building a release**

Run the debug executable produced by Cargo tests/checks with `--mcp`, send an MCP initialize request and `tools/list` through stdin, and verify stdout contains only valid JSON-RPC responses with all ten tools. Call a read-only tool while the app is unavailable and verify the bridge attempts auto-launch and returns a bounded result or launch diagnostic.

- [ ] **Step 6: Inspect the final diff**

Run: `git diff --check`

Run: `git status --short`

Expected: no whitespace errors; only intended source, dependency, documentation, spec, and plan files are changed.
