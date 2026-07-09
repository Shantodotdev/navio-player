# Video-first Now Playing drawer

## Goal

Make the existing Now Playing drawer a capable media-viewing surface, especially for video, without taking the user away from the library or other page they are using.

## Scope

- Open Now Playing automatically when the user starts a track from the library, dashboard, or playlist, for both audio and video.
- Respect an explicit close: queue navigation and natural autoplay must not reopen the drawer.
- Replace the fixed 384px drawer with a wider, horizontally resizable panel that remembers the user's preferred width.
- Make video a prominent, interactive 16:9 viewing stage with direct playback and fullscreen actions.
- Improve the audio presentation within the same drawer shell, and remove the fake queue/current-track fallback when nothing is playing.

## User experience

### Playback and drawer state

`playTrack` represents a user selecting a new item. It sets the new track, starts playback, and opens the drawer. `nextTrack` and `prevTrack` change tracks but leave the drawer state unchanged. As a result, a manually closed drawer remains closed during previous/next actions and automatic queue advancement; selecting another library, dashboard, or playlist item opens it again.

With no current track, the drawer shows an intentional empty state rather than mock media. It never opens automatically without a selected track.

### Size and resize behavior

The drawer remains an overlay on the right, so browsing pages do not jump or reflow. Its default width is 640px. A visible left-edge drag handle resizes it horizontally:

- Minimum width: 480px.
- Maximum width: the smaller of 860px and 70% of the viewport width.
- The current width is clamped on window resize and saved in local storage, then restored on the next launch.
- Pointer capture keeps dragging reliable even when the pointer leaves the handle. Text selection is suppressed only during a resize.
- The handle is keyboard-accessible as a vertical separator, with arrow keys adjusting width in small increments.

### Adaptive media layout

The top of the drawer is the primary media surface.

- **Video:** a black 16:9 stage sized to the panel width. Clicking it toggles play/pause. A hover/focus control layer provides play/pause and fullscreen actions, while the global player bar continues to provide seek, skip, and volume. A short loading indicator appears while media buffers; a clear inline playback error appears when the browser cannot load the file.
- **Audio:** the same stage becomes a large cover-art treatment with the existing visual fallback, title, and media type. The layout remains spacious rather than pretending to be a video frame.
- **Queue:** beside the media details when the drawer is wide enough, otherwise below them. It keeps the active item obvious and remains independently scrollable so a long queue never shrinks the video stage.

The compact player bar continues to provide global controls. Its leading artwork area uses a film treatment for videos so the active item does not read as audio-only, and its Now Playing control remains available to reopen the drawer.

## Component and state design

`playerStore` remains the source of truth for selected media, playback state, the queue, and open/closed state. `playTrack` will set `isDrawerOpen` to `true`; `nextTrack` and `prevTrack` will not change it.

`NowPlayingDrawer` owns its persisted presentation width because it is UI-only state. It will read, clamp, and write one local-storage value, and use pointer events for the resize interaction. The single shared HTML video element stays in this component, so the player bar and direct video interactions continue to control the same stream.

The drawer will be split into focused subcomponents for the resizer, media stage, metadata, empty state, and queue when that makes the component easier to maintain. Each receives only the state/actions it needs.

## Accessibility and failure handling

- All new controls have names, focus states, and buttons rather than click-only decorative layers.
- The resize handle exposes its orientation and current width to assistive technology and responds to keyboard input.
- Fullscreen failures are ignored safely when the webview cannot enter fullscreen.
- Buffering does not reset playback state. Recoverable media errors retain the existing queue-skip protection, with user-visible feedback before advancing.
- The responsive clamp prevents a saved large width from making the panel unusable in a smaller window.

## Verification

- Start audio and video from the library, dashboard, and playlist; confirm the drawer opens in each case.
- Close the drawer, then use previous/next and allow a queued item to finish; confirm it stays closed.
- Resize from the handle by pointer and keyboard, relaunch, and confirm the width is restored and correctly clamped in a smaller window.
- Check video play/pause, fullscreen, buffering, stream error, seek, volume, queue selection, and no-track state.
- Run the project's appropriate frontend checks after implementation and resolve any regressions.

## Non-goals

- No dedicated Now Playing route or page-wide theater mode in this change.
- No persistent playback position, playback-speed controls, subtitle selection, or picture-in-picture support.
- No redesign of library, playlist, or downloader page layouts beyond their existing invocation of `playTrack`.
