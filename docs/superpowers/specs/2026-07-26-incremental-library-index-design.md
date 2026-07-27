# Incremental Library Index Design

## Goal

Make Navio’s local library responsive and bounded even when a user selects a
large, frequently changing, or deeply nested folder.

## Confirmed Product Behavior

- Cached media appears immediately after startup.
- Adding a folder scans only that folder.
- Filesystem notifications update only affected files or subtrees.
- Generated and development directories are excluded by default.
- Exclusion names are editable in Settings.
- Saved paths are canonicalized and exact duplicates are removed.
- A compact spinner remains inside the Add Folder button; no large scan-status
  panel returns.
- Scans report real discovery and indexing counts and can be cancelled.
- All index data remains local.

## Storage

`library.json` remains the source of truth for configured directories.
`library-index.sqlite3` becomes a rebuildable media index. SQLite stores media
metadata separately from root membership so overlapping configured roots do not
corrupt removal behavior. WAL mode and transactions keep watcher updates and
folder scans atomic.

The index contains:

- A `media` table keyed by a normalized absolute path.
- A `media_roots` table relating media paths to configured roots.
- File size and modification time for avoiding unnecessary metadata probes.
- The existing `MediaItem` fields consumed by React.

Reset removes the SQLite database, WAL, and shared-memory files. Missing or
corrupt index data can be rebuilt from configured folders without affecting
playlists or media files.

## Path Policy and Exclusions

Rust canonicalizes configured paths before persistence, removes the Windows
extended-length prefix for display, compares Windows paths case-insensitively,
and removes exact duplicates. Directory symlinks are not followed.

Default excluded directory names are:

`.git`, `.hg`, `.svn`, `node_modules`, `target`, `dist`, `build`, `.next`,
`.nuxt`, `.cache`, `__pycache__`, `.venv`, `venv`, and `vendor`.

The comparison is case-insensitive on Windows. The explicitly selected root is
always eligible; exclusions apply to descendants. Users edit the list in
Settings and can request a reindex.

## Scanning

A single scan coordinator owns foreground and startup reconciliation. A scan:

1. Enumerates supported files iteratively without following directory links.
2. Emits discovery counts while walking.
3. Reuses indexed metadata when size and modification time are unchanged.
4. Probes changed files with bounded parallelism.
5. Atomically replaces membership for each completed root.
6. Deletes media records that no configured root references.
7. Emits completion, cancellation, or failure.

Cancellation is cooperative. It stops discovery and prevents unpublished root
results from replacing the prior index.

On first launch after this migration, Navio returns an empty or partial cached
index immediately and starts a background reconciliation. Later launches return
the populated index immediately.

## Watcher Synchronization

The watcher keeps its existing debounce. After the quiet period, Rust filters
excluded paths and updates only changed files or directory subtrees. It writes
the index before emitting `library-updated`; the existing frontend refresh then
reads SQLite instead of rescanning the filesystem.

Deleted and renamed paths remove stale index rows. Existing supported files are
re-probed only when their size or modification timestamp changed.

## Frontend

The library store receives `library-scan-progress` events with:

- Job identifier and phase.
- Root path.
- Discovered, processed, indexed, skipped, and failed counts.

The Add Folder button shows a spinner and `Scanning…`, optionally including the
processed/total count when known. A compact adjacent cancel control appears
during an active scan. No page-wide status card is shown.

Background failures use the existing global error toast. Successful scans do
not create routine success toasts.

Settings exposes the excluded directory names and a Reindex Library action.
Browser development continues to work when Tauri APIs are unavailable.

## Testing

Rust tests cover path normalization, duplicate migration, exclusions, index
upsert/removal, unchanged-file reuse, cancellation, and incremental watcher
updates. Frontend tests cover progress merging, cancellation, settings contract
conversion, and scan-state cleanup. Final verification runs Rust formatting,
Clippy, Rust tests, frontend tests, TypeScript validation, ESLint, and diff
validation.

## Non-Goals

- Online metadata lookup.
- Artist, album, or genre enrichment.
- Following directory symlinks.
- Native operating-system notifications for scans.
- Persisting scan notification history.
