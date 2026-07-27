# Concurrent Library Scans Design

## Goal

Keep Navio's Add folder action immediately reusable while every selected
directory scans independently and reports its state inside the Scanned
directories card.

## Confirmed Product Behavior

- The Add folder button never becomes a scan-status button.
- The button is unavailable only while its native folder picker is open.
- A selected directory appears in the Scanned directories card immediately.
- Different directories scan concurrently.
- Each scanning directory displays its own spinner, phase, and processed count.
- Each active directory has its own cancellation action.
- Routine completion does not show a success toast.
- Failures use Navio's existing error toast and leave the configured directory
  available for retry or removal.

## Backend Job Model

`ScanCoordinator` changes from one global job to a registry keyed by job ID.
Each job contains its normalized root, cancellation flag, and latest progress.
Only one active job is allowed for the same normalized root, while different
roots may scan concurrently.

The command contracts become:

- `scan_folder(folder_path)` registers the folder, starts one job, and returns
  its completed cached library response as it does today.
- `get_library_scan_status()` returns every active progress snapshot.
- `cancel_library_scan(job_id)` cancels only the requested job.
- `rebuild_library_index()` starts one job per inactive configured root and
  waits for those jobs before returning the combined cached view.

Progress events retain `job_id` and `root`, allowing React to update the correct
directory without relying on event order.

## Folder Registration

Folder configuration is saved before metadata scanning begins. This makes the
new row visible immediately, preserves the selection if Navio closes during a
scan, and allows startup reconciliation to resume unfinished work.

Registration is serialized with a small async configuration lock:

1. Canonicalize the selected directory.
2. Lock configuration changes.
3. Reload `library.json`, deduplicate the normalized root, and save it.
4. Add the directory to the stream allowlist and filesystem watcher.
5. Release the configuration lock.
6. Start that root's independent scan.

This prevents simultaneous selections from overwriting one another's
`library.json` changes.

Cancellation or scan failure does not remove the configured folder. Its
existing indexed snapshot remains intact, or it remains empty if it has never
completed. The user can retry through reindexing or remove the folder normally.

## Resource Bounds and SQLite Safety

Scans are concurrent at the root-job level, but metadata probing continues to
use Rayon's single global bounded pool. Starting more scans therefore does not
create an unbounded number of metadata threads.

Each scan performs discovery independently. Completed roots publish through
short SQLite transactions. SQLite WAL mode remains enabled, and connections use
a busy timeout so simultaneous publications wait briefly instead of failing
with a transient lock error.

Root membership keeps overlapping configured directories safe. Cancelling one
job prevents that job's unpublished snapshot from replacing its prior root
membership.

Filesystem watcher batches remain deferred while any full-root job is active,
then replay after the active registry becomes empty. This prevents a completed
root snapshot from overwriting a filesystem event that occurred during its
scan.

## Frontend State and UI

The library store replaces the singular `activeScan` with:

- `scanJobs`: progress snapshots keyed by job ID.
- `isFolderPickerOpen`: a short-lived guard against opening duplicate native
  dialogs.
- Pending selected roots, used until the first backend progress event arrives.

The Add folder button always reads `Add folder` and always uses the folder icon.
It becomes available again immediately after selection, even while the invoked
scan promise remains pending.

The Scanned directories card renders the union of persisted directories and
pending selected roots. A scanning row contains:

- The existing folder path.
- A compact spinner.
- `Discovering`, `Scanning 120/800`, or `Cancelling`.
- A small cancel button for that job.

Completed and cancelled jobs leave the progress map. Failed jobs leave the
normal configured row visible and produce the existing failure toast. No large
status bar or successful-action toast is introduced.

Settings shows `Scanning` while any job is active and prevents starting a
conflicting whole-library reindex, but it does not affect Add folder.

## Error Handling

- Selecting the same normalized folder twice does not create another row or
  another job.
- Starting a second job for an already-active root returns a clear duplicate-job
  error.
- One failed job does not cancel or hide other jobs.
- A failed configuration save prevents the scan from starting.
- A SQLite publication failure affects only that root and preserves its previous
  committed index snapshot.
- Browser development continues to tolerate unavailable Tauri APIs.

## Testing

Rust tests cover:

- Multiple different roots can register simultaneously.
- The same normalized root cannot run twice.
- Cancelling one job does not cancel another.
- Concurrent folder registration cannot lose a configured root.
- SQLite root publications remain valid under concurrent jobs.
- Status returns all active jobs.

Frontend tests cover:

- Add folder becomes reusable immediately after selection.
- Multiple selected folders produce independent scan rows.
- Progress events update only the matching job.
- Per-row cancellation sends the matching job ID.
- Completing one job does not clear another.
- The button never displays a scanning loader or scan label.

Final verification runs Rust formatting, strict Clippy, Rust tests, frontend
tests, TypeScript validation, ESLint, and diff validation.

## Non-Goals

- A sequential scan queue.
- Unlimited metadata worker threads.
- Per-folder bandwidth or CPU controls.
- Persisting completed scan notification history.
- Reintroducing a page-wide scan status panel.
