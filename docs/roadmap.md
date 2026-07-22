# Navio Development Roadmap

This roadmap records the next major product milestones in implementation order. It is intentionally release-agnostic: milestone numbers describe priority, not promised version numbers or dates.

Navio remains a local-first, video-friendly media player. Library improvements should rely on useful activity and file data rather than artist, album, genre, or other metadata that is commonly absent from video files.

## Milestone 1: Activity and Smart Playlists

Make Navio remember how the local library is used and surface useful automatic collections.

- Track when media is added to the library.
- Track when media is played and maintain a bounded recent-play history.
- Surface true Recently Added and Recently Played collections.
- Surface resumable videos as Continue Watching.
- Add automatic smart playlists derived from local activity and existing file data.
- Keep generated collections separate from user-created playlists.
- Preserve all activity locally without accounts or network services.

## Milestone 2: Core Library and Queue UX

Make common library and playback-management actions clearer and faster.

- Add a global toast and actionable error-feedback system.
- Add library sorting without introducing permanently empty metadata columns.
- Add drag-and-drop queue reordering.
- Add drag-and-drop ordering for tracks in user-created playlists.
- Improve progress and failure feedback for scans, filesystem changes, and local operations.

## Milestone 3: Desktop Playback Integration

Make Navio behave like a first-class desktop media application.

- Support global media keys and operating-system media-session information.
- Add system-tray controls and a compact mini-player.
- Add a sleep timer.
- Add picture-in-picture for compatible video playback.

## Milestone 4: Advanced Audio Playback

Add higher-complexity audio features after the shared playback architecture is ready for them.

- Add gapless playback where supported.
- Add configurable crossfade.
- Add an equalizer and optional audio normalization.
- Keep advanced processing optional so normal playback remains lightweight and reliable.

## Delivery Principles

- Design, implement, and verify one milestone at a time.
- Preserve compatibility with the browser-development experience when Tauri APIs are unavailable.
- Keep filesystem access and persistent data validation at the Rust boundary.
- Avoid accounts, cloud dependencies, and automatic online metadata enrichment.
- Prefer focused shared playback components over duplicating behavior across player surfaces.
