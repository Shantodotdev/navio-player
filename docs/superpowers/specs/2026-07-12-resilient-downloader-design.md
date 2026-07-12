# Resilient Downloader Design

**Goal:** Make Navio download jobs persistent, controllable, and recoverable across failures, app exits, and restarts.

## Decisions

- The Rust backend is the source of truth for every job. The renderer displays the persisted job list and subscribes only for live updates.
- Each job persists its original URL, format, playlist selection, state, diagnostic text, timestamps, progress, and a private staging directory.
- yt-dlp writes each job into an isolated staging directory. On success Navio moves completed media into the user Downloads/Navio Player directory; Cancel removes only that staging directory.
- Pause is a safe soft pause: Navio terminates yt-dlp, retains `.part` files, and Retry/Resume invokes yt-dlp with the same job ID and staging directory. yt-dlp resumes partial fragments by default.
- Cancel is destructive: it stops the active process, deletes the job staging directory, and ends as `cancelled`. Retry is intentionally unavailable for cancelled jobs.
- A failed or interrupted job keeps its staging files and may be retried. Jobs persisted as active at startup become `interrupted`; Navio never assumes an old process survived a crash or app exit.
- A playlist remains one user-visible job. Its title, current item and item count are surfaced during progress; a non-zero yt-dlp exit records an actionable error and retains all resumable artifacts.

## State Model

`queued -> preparing -> downloading -> completed`

`queued|preparing|downloading -> paused|cancelled|failed|interrupted`

`paused|failed|interrupted -> queued` through Resume/Retry.

Only queued, preparing, and downloading states belong in the Active filter. A process command may be requested during preparation; cancellation is observed before spawning yt-dlp.

## Process and Persistence Rules

1. Create and persist a job before launching asynchronous work.
2. Store active controls in a Rust registry keyed by job ID; only the registry can terminate a child process.
3. Use yt-dlp's `--progress-template` and `--print after_move:filepath` markers rather than parsing human-facing output.
4. Set `kill_on_drop(true)` for every yt-dlp child. Mark all active records interrupted synchronously at app exit; startup recovery handles crash paths that never receive an exit event.
5. Serialize JSON updates under one manager lock and write them atomically. Every mutation emits the complete job record after it is durable.
6. Only move completed media after a successful exit. A move failure is a retryable failure and leaves staging data untouched.

## Error and Cleanup Policy

- Preserve the most useful yt-dlp stderr message, normalized into safe UI text; never replace it with a generic title.
- Failure includes preparation, spawn, network/extractor, download, merge/post-process, and final-move errors.
- A stale or duplicate UI command is rejected by current state and never affects another job.
- Startup cleans orphaned staging directories only for cancelled records; resumable job directories remain intact.
- Deleting a history card is allowed only for terminal jobs and removes its persisted record, never downloaded media.
