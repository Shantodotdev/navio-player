# Theater Player Design

## Goal

Provide an immersive, Netflix-style movie-watching experience for local videos while exposing only the embedded audio languages and subtitle tracks that each file actually contains.

## User experience

Videos continue to start in the Now Playing drawer. The user can press a Theater button to open a full-app video overlay, then press Fullscreen when they want OS-level fullscreen. Closing Theater returns to the drawer without interrupting playback.

The theater overlay has a black, distraction-free stage with controls that fade after a short idle period and return on pointer movement, keyboard use, or focus. The controls provide:

- Previous and next queue items, play/pause, mute/volume, and a scrubbable progress bar.
- Ten-second backward/forward seek.
- Theater exit and fullscreen toggle.
- An audio-language menu and a subtitles menu, shown only when the video exposes those tracks.
- A Next up card when 20 seconds remain, with a clear play-now action; normal queue advancement remains unchanged at the end.
- Keyboard shortcuts: Space/K play/pause, J/L seek, left/right seek, M mute, F fullscreen, and Esc exit fullscreen or Theater.

Menus identify track labels by embedded title when present, then ISO language label, then a readable fallback such as `Audio 2` or `Subtitle 1`. Subtitle options include Off. Selected audio/subtitle choices are retained for the current theater session.

## Media pipeline

The existing verified FFmpeg download also supplies ffprobe. A new Rust media-tools service will verify both executables in the application binary directory and expose them for player use.

When Theater opens for a video, the frontend requests on-demand stream metadata. ffprobe returns only safe, structured stream information: video stream presence, audio streams with index/language/title/default disposition, and subtitle streams with index/language/title/default disposition. The frontend never parses raw ffprobe output.

The selected audio language and subtitle track require an FFmpeg-prepared theater session because generic HTML video cannot reliably switch embedded MKV/MP4 audio streams or render embedded subtitle codecs. The Rust backend creates a random session directory inside app cache and starts a managed FFmpeg HLS output for the selected video/audio stream. It writes selected subtitles as WebVTT into that session. The existing token-protected local stream server gains a dedicated theater-session route that serves only files inside active session directories.

Changing audio restarts the session with the selected audio stream and resumes at the prior playback time. Changing subtitles updates the rendered WebVTT track without restarting video playback when possible; if a fresh extraction is needed, the player keeps the current time. The backend terminates the previous FFmpeg process and removes its session directory when the selection changes, Theater closes, the current track changes, or the app exits.

## Components and responsibilities

- `src/components/TheaterPlayer.tsx`: overlay, custom playback controls, auto-hide behavior, keyboard controls, menus, fullscreen, and Next up prompt.
- `src/components/NowPlayingDrawer.tsx`: adds the Theater launch action for active video and retains drawer playback as the non-theater entry point.
- `src/components/theaterPlayerTypes.ts`: frontend contracts for tracks, session responses, and menus.
- `src/store/playerStore.ts`: theater-open state and actions; media element remains the sole source of playback truth.
- `src-tauri/src/media_tools.rs`: verified ffmpeg/ffprobe lookup, structured ffprobe parsing, session creation/cleanup, and FFmpeg lifecycle management.
- `src-tauri/src/server.rs`: authenticated read-only theater-session asset route, constrained to active session directories.
- `src-tauri/src/lib.rs`: commands to inspect a video, start/change/stop a theater session, and cleanup on exit.

## Data contracts

`inspect_video_tracks(path)` returns:

```text
VideoTrackInfo {
  audio_tracks: [{ stream_index, language?, title?, is_default }],
  subtitle_tracks: [{ stream_index, language?, title?, is_default, codec }]
}
```

`start_theater_session(path, audio_stream_index, subtitle_stream_index?)` returns a token-authenticated HLS playlist URL and optional WebVTT subtitle URL. A new session identifier is server-generated and opaque to the frontend.

The backend validates that the requested video path is in the application allowlist and that requested stream indexes appeared in its own inspection result. The frontend cannot request arbitrary output paths, FFmpeg arguments, or session files.

## Failure handling

- If ffprobe/FFmpeg is unavailable or metadata inspection fails, Theater opens with the raw local stream and hides unavailable language/subtitle controls.
- If a selected audio session cannot prepare, preserve the current playable stream and show a compact non-blocking error.
- If subtitle extraction fails, keep the video running and reset the subtitle menu to Off with an explanatory message.
- Unsupported codecs are reported before replacing the active stream. The original raw stream is not discarded until a theater session is ready.
- Session routes reject missing/invalid tokens, inactive session IDs, traversal attempts, and files outside the app-managed theater cache.

## Scope boundaries

- This release supports one selected video stream, one selected embedded audio stream, and one selected embedded subtitle track at a time.
- It does not provide subtitle styling controls, arbitrary external subtitle-file import, playback speed, picture-in-picture, profiles, or remote streaming.
- It does not alter audio-only playback.

## Manual verification

- Open an MP4/MKV with multiple embedded audio languages and subtitle streams; confirm menu labels match inspection results.
- Switch audio and subtitles during Theater playback; confirm position is retained and stale FFmpeg sessions are removed.
- Verify all custom controls, keyboard shortcuts, auto-hiding controls, Next up prompt, theater exit, and fullscreen behavior.
- Confirm a missing ffprobe/FFmpeg tool or unsupported track falls back without stopping video playback.
- Attempt invalid session URLs and traversal paths; confirm the local server rejects them.
