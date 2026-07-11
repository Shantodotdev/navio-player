---
name: commit-message-generator
description: Use when the user asks for Navio commit messages, logical commit snapshots, changed-file grouping, or help splitting the current worktree into reviewable commits.
---

# Commit Message Generator

Generate commit snapshots that match Navio's history and local rules. The repository is directed under the name Ardio, but always call the app Navio in commit messages and user-facing output.

## Workflow

1. Read root `AGENTS.md`.
2. Inspect changes with read-only git commands:
   - `git status --short`
   - `git diff --name-only`
   - `git diff --stat`
   - `git diff -- <path>` when intent is unclear
   - `git log --pretty=format:"%s%n%b" -n 20` when style confirmation is useful
3. Group files by one logical purpose, not merely by directory.
4. Draft one commit message per group.
5. Never stage, commit, reset, switch branches, or push.

Do not guess from filenames when the diff is needed to understand the change.

## Commit Style

Use:

```text
type(scope): lowercase action-oriented subject
```

The scope is required for Navio code changes. Use the area convention below:

- `frontend/ui` - React components, routes, layouts, styling, and visible frontend behavior
- `frontend/player` - playback controls, player state, subtitles, theater mode, and media UI
- `frontend/library` - library, playlists, and browser-side media catalog behavior
- `frontend/downloader` - downloader screens and frontend downloader behavior
- `rust/storage` - Rust JSON persistence, library storage, and cache data
- `rust/media` - Rust media inspection, streaming, FFmpeg, and playback preparation
- `rust/downloader` - Rust downloader processes and download operations
- `rust/watcher` - Rust filesystem watcher behavior
- `tauri/commands` - Tauri IPC commands and frontend/backend command contracts
- `tauri/config` - Tauri configuration, permissions, capabilities, and packaging
- `docs`
- `config`

Use `frontend` or `rust` only when a more specific area does not fit. Use `tauri` for Tauri integration itself; use `rust` for backend implementation details. For a cross-layer change, choose the scope of the primary behavior, or split it into separate snapshots when the frontend and backend changes are independently reviewable.

Choose the type by intent:

- `feat` - new behavior or capability
- `fix` - bug correction
- `refactor` - behavior-preserving restructuring
- `docs` - documentation only
- `chore` - maintenance or configuration
- `deps` - dependency changes
- `test` - tests only

Keep the subject specific, lowercase, and without a trailing period. Start with an action such as `add`, `update`, `implement`, `fix`, `remove`, `simplify`, or `preserve`.

For Navio, preferred examples include:

```text
feat(rust/storage): improve library persistence
fix(tauri/commands): preserve theater state arguments
feat(frontend/player): add subtitle track selection
fix(frontend/ui): align sidebar controls
refactor(rust/media): simplify stream preparation
chore(tauri/config): update desktop capabilities
```

Add a body only when the subject does not explain the important details. Use short dashed bullets.

## Snapshot Rules

Split changes when they have independent purposes, for example:

- runtime code and unrelated documentation
- separate features or fixes
- dependency updates and feature implementation
- mechanical cleanup and behavioral changes

Keep files together when separating them would create an incomplete or misleading commit.

## Output Format

For each snapshot, provide the exact files followed by a fenced block containing only the commit message:

Snapshot 1: player controls

Files:

- `src/components/PlayerBar.tsx`
- `src/store/playerStore.ts`

Commit message:

```text
feat(frontend/player): improve playback controls

- Preserve the current player state while improving the control interactions.
```

For a small change, omit the body:

```text
docs: simplify project agent instructions
```

## Final Check

- Each snapshot has one purpose.
- Every changed file is included once unless the user requests otherwise.
- Type and scope match the actual diff.
- File paths stay outside the commit-message code block.
- The code block contains only copy-ready commit text.
- No git write command was used.
