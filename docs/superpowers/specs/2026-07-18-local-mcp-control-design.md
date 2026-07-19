# Navio local MCP control design

## Goal

Expose Navio as a local Model Context Protocol server so Codex, Cursor, and other MCP hosts can inspect and control music/video playback without leaving the agent. The integration must preserve Navio's local-first filesystem boundary, start Navio automatically when needed, search only the user's indexed library by name, and accept online media only through an explicit URL that is downloaded before playback.

## User-visible behavior

- The installed Navio executable also serves MCP over stdio when launched with `--mcp`; users do not install Node.js or a second package.
- An MCP host can list tools even while the desktop UI is closed. The first tool that needs Navio launches the normal desktop process and waits briefly for it to become ready.
- Name-based lookup searches only Navio's indexed library. No local match returns the exact user-facing message `No music found.` and never falls back to an internet search.
- Online media requires an explicit public URL. Navio validates and inspects the URL through its managed downloader, creates a normal durable download job, and automatically plays the first completed media file.
- Playback continues in Navio while the user remains in the agent. Video can be sent to the Now Playing drawer or theater view through an MCP view command.
- Multiple MCP hosts may connect at the same time. They control the one running Navio desktop instance and receive current state rather than keeping independent playback state.

## Architecture

### One executable, two modes

`src-tauri/src/main.rs` dispatches on `--mcp`. Normal startup runs the existing Tauri application. MCP startup runs a Tokio stdio server implemented with the official Rust MCP SDK. Reusing the packaged executable avoids a sidecar build and keeps Codex/Cursor configuration to one command plus the `--mcp` argument.

The MCP process never loads arbitrary media files itself. It translates typed MCP tools into authenticated loopback control requests to the running Navio app. If the app is unavailable, it starts the same executable without `--mcp` and waits for a valid control descriptor.

### Authenticated loopback control bridge

The existing dynamic localhost Axum server gains a separate control bearer token and `/control/health` plus `/control/command` endpoints. Stream and control tokens remain distinct. The control endpoint does not enable CORS and requires the bearer token, preventing ordinary browser pages from issuing commands.

At startup Navio atomically writes a small per-user runtime descriptor containing the process ID, dynamic port, control token, and protocol version. The descriptor uses owner-only permissions where the platform supports them. It is removed on graceful shutdown. MCP processes treat an unreadable, malformed, unauthorized, or unreachable descriptor as stale and use a per-user launch lock so concurrent clients do not open duplicate Navio windows.

The control endpoint places each request into a bounded in-process queue and waits for a correlated response with a fixed timeout. A Tauri long-poll command lets the renderer receive the next request; a second Tauri command completes it. The queue is bounded so abandoned MCP callers cannot consume unbounded memory.

### Renderer control adapter

A root-level React hook owns the agent-control loop. It dispatches commands through the existing Zustand library/player stores and downloader helpers, then returns a serializable result to Rust. The renderer remains the source of truth for HTML media state, while Rust remains the security boundary for paths, processes, downloader operations, and the localhost token.

The adapter supports:

- current playback and view state;
- local library search with bounded results and optional audio/video filtering;
- play by stable track ID, with an optional exact-name convenience path;
- play, pause, stop, previous, next, and absolute/relative seek;
- volume changes;
- queue inspection and add/remove/clear/play-index operations;
- Now Playing drawer and theater presentation changes;
- explicit-URL download creation, durable download status inspection, and play-on-completion.

Queue mutations are added to `playerStore` so UI and MCP calls share one implementation. Seek and stop update both Zustand and the active HTML media element.

### Download then play

`download_and_play_url` requires an explicit URL and a requested kind (`audio` or `video`). The renderer first invokes the existing URL inspection command, then creates a single-item durable job using Navio's existing safe defaults. The MCP response returns the job ID immediately because downloads can outlive an MCP tool timeout.

The control hook listens for the existing `download-updated` event. When a registered job completes, it asks Rust to convert the first completed path into a validated `MediaItem`, then calls the shared `playTrack` action. The Rust conversion command accepts only files within the existing streaming allowlist, so an MCP caller cannot use it to inspect an arbitrary path. Failed or cancelled jobs clear the pending autoplay registration and remain visible through download status tools.

## MCP tools

The stdio server exposes a focused tool set with precise schemas and side-effect annotations:

1. `get_playback_state` — current media, playing state, time, volume, queue position, and view state.
2. `search_library` — query, optional `audio`/`video` filter, and a capped result count.
3. `play_media` — play a track ID or exact local name; no match returns `No music found.`.
4. `control_playback` — `play`, `pause`, `stop`, `next`, `previous`, `seek_to`, or `seek_by` with validated seconds.
5. `set_volume` — integer percentage from 0 through 100.
6. `get_queue` — ordered queue and active index.
7. `edit_queue` — add track, remove index, clear, or play index.
8. `set_player_view` — `hidden`, `drawer`, or `theater`; theater requires an active video.
9. `download_and_play_url` — explicit URL plus `audio`/`video`; returns a durable job ID.
10. `get_downloads` — optional job ID filter over durable download records.

Tool instructions tell agents to search before playing when the user gives a loose name, never invent URLs, and never interpret a missing local result as permission to search online.

## Validation and errors

- MCP inputs are schema-validated and narrowed again at the renderer/Rust boundary.
- Search queries are trimmed, length-limited, case-insensitive, and result-limited.
- Volume, seek values, queue indexes, and result limits are range checked.
- URL downloads reuse the existing public-URL validation, verified yt-dlp installation, durable queue, and normalized errors.
- Control requests use bounded bodies, a bounded queue, bearer authentication, and timeouts. Errors returned to agents are concise and do not expose control tokens or internal filesystem configuration.
- If the UI cannot start, the MCP tool reports that Navio could not be launched. A stale descriptor is replaced only after its authenticated health check fails.
- MCP protocol messages are the only stdout output in `--mcp` mode; diagnostics go to stderr.

## Verification

- Rust unit tests cover descriptor parsing/staleness, bearer extraction, control queue correlation/timeouts, launch locking, MCP argument validation, tool-to-control request mapping, and exact no-match wording.
- TypeScript unit tests cover search ranking, command dispatch, queue edits, playback controls, download registration, and completed-download autoplay.
- Rust integration tests exercise authenticated and unauthorized health/control requests without launching the Tauri UI.
- The official MCP Inspector starts `Navio Player --mcp`, lists every tool, and calls read-only and playback tools against a running development app.
- Final project checks are `npm run lint`, `npm run typecheck`, `npm run test`, `cargo fmt --check`, `cargo clippy`, and `cargo test`. No production build or development server is run without explicit permission.

## Documentation and onboarding

README documentation includes generic stdio configuration plus concrete Codex and Cursor examples pointing at the installed Navio executable with `args = ["--mcp"]` or JSON equivalent. It explains that the agent inherits the user's Navio library access, online media requires an explicit URL, downloads finish asynchronously, and MCP hosts may still show their own approval prompt before side-effecting tools.

## Non-goals

- No remote/network-accessible MCP server, OAuth flow, or cloud account.
- No internet search from a title, artist, or natural-language media name.
- No direct streaming of online media before download completion.
- No arbitrary filesystem path playback outside Navio's library, playlists, cache, or authorized download directory.
- No automatic edits to Codex, Cursor, or other agents' global configuration files.
- No downloader redesign or new media provider integration.
