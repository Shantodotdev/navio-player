# Activity and Smart Playlists Design

## Goal

Give Navio useful, local activity-based organization without relying on artist, album, genre, or other metadata that is frequently absent from video files.

Milestone 1 adds four built-in, read-only collections: Recently Added, Recently Played, Continue Watching, and Most Played.

## Scope

This milestone includes activity persistence, meaningful playback tracking, collection derivation, Home integration, and a Smart playlists section on the Playlists page.

It does not include customizable rules, copying a smart playlist into a normal playlist, global toasts, library sorting, drag-and-drop ordering, desktop media integration, or advanced audio processing.

## Persistence

Navio stores activity in a versioned `activity.json` file in the application data directory. Rust owns validation, reconciliation, migration, pruning, and atomic persistence.

Each entry is keyed by Navio's stable media ID and stores:

- Canonical media path.
- Optional date-added timestamp.
- Optional last-played timestamp.
- Play count.
- Resume position, known duration, and the last progress-update timestamp.
- Last-seen timestamp for pruning unavailable media.

On the first activity initialization, every current library file is registered without a date-added timestamp. Only files discovered by later reconciliations receive the current time as their date added. Existing valid video resume positions are imported from `theater-media.json`; audio and subtitle preferences remain in that database.

Activity records that are not in the current live library do not appear in collections. Unavailable records older than 90 days may be pruned, and the database has a fixed maximum entry count as a final size limit.

The full local-data reset removes `activity.json` alongside Navio's other databases.

## Meaningful Playback

A root-level frontend tracker monitors the shared primary media element and accumulates actual forward playback time. Paused time, stalled time, and seek jumps do not count.

For each playback session:

- Recently Played is recorded after ten seconds of accumulated playback.
- Play count is incremented once after 50 percent of the media duration or four minutes, whichever comes first.
- Short media whose duration is below a threshold uses its reachable duration so it can still qualify.
- Switching between the sidebar and Theater must not start a second session for the same uninterrupted track.
- Changing tracks resets session milestones.

Video progress continues to use Navio's existing checkpoint behavior. Activity progress mirrors those checkpoints for collection derivation, while `theater-media.json` remains responsible for playback restoration and track preferences.

## Data Flow and Boundaries

The Rust `activity` module is split into models, storage, reconciliation, and update operations. Writes are serialized and atomically replace the prior JSON document.

Library responses include activity records keyed by media ID. Playback activity commands return the updated record so the frontend can merge it without rescanning the filesystem.

The frontend owns a pure smart-playlist derivation helper. It combines the current live tracks with activity records and returns consistently ordered collection descriptors used by Home and Playlists.

## Built-in Collections

- **Recently Added:** up to 30 available files ordered by date added descending.
- **Recently Played:** up to 30 unique available files ordered by last played descending.
- **Continue Watching:** available videos with a resume position of at least five seconds and more than fifteen seconds remaining, ordered by the latest progress update.
- **Most Played:** up to 30 available files with a positive play count, ordered by count descending and then last played descending.

Playing a collection item uses that collection's current track order as the playback queue.

## User Interface

Home replaces its current filesystem-order recent list with activity-backed sections. Empty sections remain hidden. Continue Watching shows playback progress. Each non-empty section offers a See all action.

Playlists is divided into Smart playlists and Your playlists. All four smart-playlist cards remain visible there, including empty collections with explanatory text. Opening a smart playlist loads its current contents into the standard Now Playing sidebar, while Play All starts its derived queue. Smart playlists cannot be renamed, deleted, manually reordered, or edited.

The visual implementation reuses Navio's existing dark panels, cards, media labels, thumbnails, and responsive layout patterns.

## Failure Handling

Activity failures never block library loading or playback. A missing file initializes normally. A malformed database is preserved under a recoverable backup filename before Navio starts with an empty store. Failed writes return clear errors and leave playback operational. User-facing global toast reporting remains part of Milestone 2.

## Verification

Rust tests cover first initialization, later discovery, existing resume import, atomic round trips, malformed-data recovery, pruning, activity updates, and reset coverage.

Frontend tests cover meaningful-play thresholds, paused and seek behavior, once-per-session counting, track changes, smart-playlist filtering and ordering, Continue Watching completion, and collection queue ordering.

After implementation, run the relevant frontend lint, type checks, and focused tests plus Rust formatting and clippy checks. Do not run production builds or development servers.
