# Independent Playlists Design

## Goal

Implement local playlists that are independent from the media library. Playlist data must be stored in a separate `playlists.json` file and contain complete track snapshots so removing a folder from My Library does not remove the track from a playlist.

## Scope

The MVP supports:

- Creating playlists with a required unique name.
- Renaming playlists.
- Deleting playlists.
- Adding library tracks to a playlist.
- Removing tracks from a playlist.
- Playing a playlist in its saved order.
- Keeping playlist tracks after their source folder is removed from My Library.

Drag-and-drop ordering, smart playlists, cover art, import/export, and playlist sharing are out of scope.

## Persistence

The Rust backend will persist playlists separately from the library at the application data path:

`$APPDATA/navio-player/playlists.json`

The file has this shape:

```json
{
  "playlists": [
    {
      "id": "playlist-uuid",
      "name": "Favorites",
      "tracks": [
        {
          "id": "track-uuid",
          "path": "D:\\Videos\\movie.mp4",
          "name": "movie.mp4",
          "title": "My Movie",
          "duration_secs": 3600,
          "file_size_bytes": 123456,
          "media_type": "video",
          "cover_cache_path": null
        }
      ]
    }
  ]
}
```

Playlist tracks are full `MediaItem` snapshots. They are not foreign keys into `library.json`, and library rescans or folder removal do not rewrite playlist snapshots.

Existing or missing `playlists.json` files load as an empty playlist collection. Invalid playlist records are rejected with a clear backend error rather than silently discarded. Track files do not need to exist for a playlist record to be retained, but playlist track paths must be absolute paths and are normalized before they are used for streaming authorization.

## Backend Architecture

Add playlist models and storage alongside the existing library module. Expose Tauri commands for reading and writing the independent database:

- `get_playlists() -> PlaylistsDb`
- `save_playlists(db: PlaylistsDb) -> Result<(), String>`

`save_playlists` validates playlist names, IDs, track snapshot fields, and absolute paths before writing atomically to `playlists.json`.

The application bootstrap loads playlist snapshots and adds the parent directories of their track paths to the stream allowlist when those directories exist. Saving playlists refreshes the same allowlist. This preserves the existing token and directory-boundary security model while allowing a playlist track to play after its library folder is removed.

The library watcher continues to update only `library.json`. It must not delete or mutate playlist snapshots.

## Frontend Architecture

Replace the mock playlist route with the persisted playlist store state. The playlist type will contain `id`, `name`, and `tracks: Track[]`.

The library hook/store will load playlists through `get_playlists`, while playlist mutations will call `save_playlists` and update the local playlist state only after persistence succeeds. Errors will be surfaced through the existing console error pattern and will not leave the UI claiming a change was saved when persistence failed.

The Playlists page will:

- Render real persisted playlists.
- Show track counts, media-type counts, and total duration from embedded snapshots.
- Play only existing files from the playlist, preserving saved order.
- Mark missing files as unavailable without removing them from the playlist.
- Open an editor for rename, delete, add, and remove operations.

The editor will search the current library when adding tracks. Adding a track copies its current `Track` object into the playlist. Removing a track removes the embedded snapshot from that playlist only.

## Error Handling

- Empty or duplicate playlist names are rejected in the UI and backend.
- Empty playlist playback is disabled.
- Missing playlist files remain visible and are marked unavailable.
- A failed save leaves the previous in-memory playlist state unchanged.
- Loading errors leave the UI with an empty state and a logged error, consistent with the existing library behavior.
- Stream authorization continues to reject paths outside the restored library or playlist directories.

## Verification

After implementation, run the relevant frontend lint and type checks plus Rust formatting/checking because the feature changes both frontend and backend code. Do not run development servers or production builds without explicit permission.
