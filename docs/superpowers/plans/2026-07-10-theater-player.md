# Theater Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Build a custom theater player for local videos with a Netflix-like control surface, Next up behavior, and FFmpeg-powered embedded language/subtitle selection.

**Architecture:** Rust owns media inspection, HLS/subtitle session creation, process cleanup, and authenticated serving of session assets. React owns a single reusable media element, the theater overlay, user controls, menus, and keyboard behavior. Playback only switches from the original local stream after a prepared theater session reports ready.

**Tech Stack:** Tauri 2, Rust, Axum 0.7, Tokio, FFmpeg/ffprobe, React 19, Zustand 5, TypeScript, Tailwind CSS 4, Lucide React.

## Global Constraints

- Video starts in the existing Now Playing drawer. Theater and OS fullscreen are separate user-invoked modes.
- The local server must serve only active app-cache session files with the existing per-run token.
- Stream indexes are discovered server-side and must be validated server-side before they are passed to FFmpeg.
- One video stream, one audio stream, and one subtitle stream are active in a theater session.
- FFmpeg tool setup remains verified and uses the app-local bin directory.
- Do not add or run automated tests; the user requested manual verification for this project.

---

## File structure

- src-tauri/src/media_tools.rs — verified ffprobe lookup; structured inspection; HLS session process lifecycle.
- src-tauri/src/server.rs — token-authenticated theater-session route and MIME/range reuse.
- src-tauri/src/lib.rs — media-tools state, commands, session cleanup, and command registration.
- src-tauri/src/downloader.rs — exposes the existing FFmpeg installer for the new media-tools module.
- src/store/playerStore.ts — theater state, session URL state, and actions retaining the single media element.
- src/components/theaterPlayerTypes.ts — shared frontend metadata/session contracts.
- src/components/TheaterPlayer.tsx — overlay, controls, menus, keyboard shortcuts, and Next up card.
- src/components/NowPlayingDrawer.tsx — Theater launch button for videos.
- src/routes/__root.tsx — mounts TheaterPlayer once beside NowPlayingDrawer.

## Task 1: Make FFmpeg and ffprobe available to theater commands

**Files:**
- Modify: src-tauri/src/downloader.rs
- Create: src-tauri/src/media_tools.rs
- Modify: src-tauri/src/lib.rs

**Interfaces:**
- Produces: async fn ensure_media_tools(app_handle: &AppHandle) -> Result<MediaTools, String>.
- Produces: struct MediaTools { ffmpeg_path: PathBuf, ffprobe_path: PathBuf }.
- Consumes: the existing hash-verified FFmpeg archive and app-data bin directory.

- [ ] Extract the app-bin directory lookup and FFmpeg installation code from downloader.rs into a public helper that does not emit download-progress events.
- [ ] Verify that the installed archive contains both platform-specific executables: ffmpeg(.exe) and ffprobe(.exe). Return an explicit error if either is absent.
- [ ] Implement media_tools.rs with:

~~~rust
#[derive(Clone)]
pub struct MediaTools {
  pub ffmpeg_path: PathBuf,
  pub ffprobe_path: PathBuf,
}

pub async fn ensure_media_tools(app_handle: &AppHandle) -> Result<MediaTools, String>;
~~~

- [ ] Keep downloader start_download using the same helper, so downloading and theater playback cannot install divergent FFmpeg versions.
- [ ] Add mod media_tools; to lib.rs.

Manual check: start a download and open Theater for a video; both commands resolve identical app-data/bin executable paths.

Commit:

~~~powershell
git add src-tauri/src/downloader.rs src-tauri/src/media_tools.rs src-tauri/src/lib.rs
git commit -m "feat(media): share verified ffmpeg tools"
~~~

## Task 2: Inspect embedded streams safely

**Files:**
- Modify: src-tauri/src/media_tools.rs
- Modify: src-tauri/src/lib.rs
- Modify: src/store/playerStore.ts
- Create: src/components/theaterPlayerTypes.ts

**Interfaces:**
- Produces Tauri command inspect_video_tracks(path: String) -> Result<VideoTrackInfo, String>.
- Produces TypeScript types VideoTrackInfo and EmbeddedTrack.
- Consumes: MediaTools.ffprobe_path and AppState.allowed_directories.

- [ ] Define Rust API types:

~~~rust
#[derive(serde::Serialize)]
pub struct EmbeddedTrack {
  pub stream_index: u32,
  pub language: Option<String>,
  pub title: Option<String>,
  pub is_default: bool,
  pub codec: String,
}

#[derive(serde::Serialize)]
pub struct VideoTrackInfo {
  pub audio_tracks: Vec<EmbeddedTrack>,
  pub subtitle_tracks: Vec<EmbeddedTrack>,
}
~~~

- [ ] Validate the supplied path with the same canonical allowlist policy used by server.rs before invoking ffprobe.
- [ ] Spawn ffprobe with fixed arguments: -v error -select_streams a,s -show_entries stream=index,codec_name:stream_tags=language,title:stream_disposition=default -of json and the validated path.
- [ ] Deserialize JSON into private ffprobe structs and map only the listed safe fields into VideoTrackInfo. Treat malformed output or a non-zero exit as a command error.
- [ ] Register inspect_video_tracks in lib.rs.
- [ ] Add matching frontend types and player-store fields: videoTrackInfo, isTrackInfoLoading, trackInfoError, setVideoTrackInfo(info).
- [ ] Call inspect_video_tracks only after Theater is opened for a video; do not probe audio-only tracks.

Manual check: inspect an MKV with multiple streams and confirm menu data contains real indexes/languages/default flags only.

Commit:

~~~powershell
git add src-tauri/src/media_tools.rs src-tauri/src/lib.rs src/store/playerStore.ts src/components/theaterPlayerTypes.ts
git commit -m "feat(media): inspect embedded video tracks"
~~~

## Task 3: Create and serve managed theater sessions

**Files:**
- Modify: src-tauri/src/media_tools.rs
- Modify: src-tauri/src/server.rs
- Modify: src-tauri/src/lib.rs
- Modify: src/store/playerStore.ts

**Interfaces:**
- Produces start_theater_session(path, audio_stream_index, subtitle_stream_index) -> TheaterSession.
- Produces stop_theater_session(session_id) -> Result<(), String>.
- Produces GET /theater/:session_id/:asset?token=... for active session assets only.
- Consumes validated VideoTrackInfo and MediaTools.

- [ ] Define session response and internal session state:

~~~rust
#[derive(serde::Serialize)]
pub struct TheaterSession {
  pub id: String,
  pub playlist_url: String,
  pub subtitle_url: Option<String>,
}

struct ActiveTheaterSession {
  directory: PathBuf,
  child: tokio::process::Child,
}
~~~

- [ ] Add an Arc<Mutex<HashMap<String, ActiveTheaterSession>>> to AppState and pass the same map into ServerState.
- [ ] Validate the requested stream indexes against a fresh inspect_video_tracks result; reject unknown audio or subtitle indexes.
- [ ] Create a UUID directory under app_cache_dir()/theater/<uuid>. Never accept a frontend-provided directory or output filename.
- [ ] Start FFmpeg for a browser-compatible HLS session with fixed mapping: -map 0:v:0 -map 0:<selected-audio-index>, HLS fMP4 segments, AAC audio, copied video when compatible, and a bounded playlist named index.m3u8. Keep all generated files inside the session directory.
- [ ] When a subtitle is selected, extract only 0:<selected-subtitle-index> to subtitle.vtt in the session directory before returning the session. On extraction failure, return the session without subtitle_url and a structured warning.
- [ ] Wait for index.m3u8 to exist and be non-empty before returning a playlist URL. If FFmpeg exits first, return its captured stderr summary and delete the session directory.
- [ ] Implement stop_theater_session to terminate the child process, remove its map entry, and remove the session directory.
- [ ] Add server route /theater/:session_id/:asset. Require the existing token, reject asset path separators and dot segments, resolve the session only from the active map, canonicalize, and require it to remain within that session directory. Reuse stream_file range/MIME response logic for the approved asset.
- [ ] Stop the prior session before replacing a player-store theater session. Store playlistUrl, subtitleUrl, selectedAudioStreamIndex, selectedSubtitleStreamIndex, and theaterSessionId in playerStore.

Manual check: use a valid local URL with the current token to fetch index.m3u8 and one segment; verify an incorrect token, unknown session, ../ asset, and stale session all return errors.

Commit:

~~~powershell
git add src-tauri/src/media_tools.rs src-tauri/src/server.rs src-tauri/src/lib.rs src/store/playerStore.ts
git commit -m "feat(media): add secure theater hls sessions"
~~~

## Task 4: Add theater state and stream handoff

**Files:**
- Modify: src/store/playerStore.ts
- Create: src/components/theaterPlayerTypes.ts
- Modify: src/components/NowPlayingDrawer.tsx
- Modify: src/routes/__root.tsx

**Interfaces:**
- Produces openTheater(), closeTheater(), startTheaterSession(...), and stopTheaterSession() store actions.
- Consumes currentTrack, mediaElement, stream config, embedded-track metadata, and TheaterSession.
- Produces one stable global TheaterPlayer mount.

- [ ] Add isTheaterOpen, theaterSessionId, theaterPlaylistUrl, theaterSubtitleUrl, selectedAudioStreamIndex, and selectedSubtitleStreamIndex to PlayerState.
- [ ] Implement openTheater to return early for non-video tracks, set isTheaterOpen, and preserve currentTime.
- [ ] Implement session replacement to remember currentTime, set mediaElement.src only after the backend returns a ready playlist URL, restore currentTime at loadedmetadata, then resume playback.
- [ ] Implement closeTheater to restore the original buildStreamUrl source at the preserved time, stop the active session, clear theater state, and leave drawer playback uninterrupted.
- [ ] Add a Theater button beside the drawer video fullscreen control. It calls openTheater and is not shown for audio.
- [ ] Mount TheaterPlayer once in __root.tsx after NowPlayingDrawer so it shares the persistent video element and is not recreated on route changes.

Manual check: open Theater, close it, and reopen it while playing; current time and queue position remain stable.

Commit:

~~~powershell
git add src/store/playerStore.ts src/components/theaterPlayerTypes.ts src/components/NowPlayingDrawer.tsx src/routes/__root.tsx
git commit -m "feat(player): add theater playback state"
~~~

## Task 5: Build the custom theater interface

**Files:**
- Create: src/components/TheaterPlayer.tsx
- Modify: src/styles.css

**Interfaces:**
- Consumes playerStore theater state and the stable HTMLVideoElement.
- Produces custom controls, audio/subtitle menus, auto-hide behavior, fullscreen, keyboard input, and Next up prompt.

- [ ] Render a fixed inset-0 z-60 black overlay only when isTheaterOpen and currentTrack is video. Move the shared video element into the overlay using a React portal or keep its DOM node stable and apply theater-specific layout classes; never create a second media element.
- [ ] Add pointer-activity state that reveals controls, hides them after 2.5 seconds during playback, and never hides them while a control/menu has keyboard focus.
- [ ] Add a top gradient with exit-theater title and a bottom gradient with previous, -10s, play/pause, +10s, next, timeline, volume, captions, language, theater exit, and fullscreen.
- [ ] Implement keyboard handler active only in Theater: Space/K toggles, ArrowLeft/J seeks -10 seconds, ArrowRight/L seeks +10 seconds, M toggles mute, F enters/exits document fullscreen, and Escape exits browser fullscreen before closing Theater.
- [ ] Build an audio menu from videoTrackInfo.audio_tracks. Selecting an item invokes start_theater_session with the selected stream and existing subtitle selection. Disable the menu while session preparation is in progress.
- [ ] Build a subtitles menu with Off plus videoTrackInfo.subtitle_tracks. Selecting a track invokes session replacement and attaches a track element with kind=subtitles, src=theaterSubtitleUrl, default, and the selected language label.
- [ ] Render the Next up card when duration - currentTime <= 20, the current video has a following playlist item, and the user has not dismissed the card for this track. Play now calls nextTrack; normal onEnded remains authoritative.
- [ ] Add focused control styles, reduced-motion-safe control fades, and a compact visible error for session preparation failures.

Manual check: exercise every button and shortcut; let a queued video reach 20 seconds remaining; select a language and subtitle; verify controls hide during playback and return on movement.

Commit:

~~~powershell
git add src/components/TheaterPlayer.tsx src/styles.css
git commit -m "feat(player): add netflix-style theater controls"
~~~

## Task 6: Manual end-to-end hardening

**Files:**
- Verify: src-tauri/src/media_tools.rs, src-tauri/src/server.rs, src-tauri/src/lib.rs, src/store/playerStore.ts, src/components/TheaterPlayer.tsx

- [ ] Start the Tauri app and scan one MP4 and one MKV containing alternate audio/subtitle tracks.
- [ ] Verify opening Theater does not interrupt current playback, opening fullscreen does not close Theater, and escaping fullscreen retains Theater.
- [ ] Switch audio twice, switch subtitles on/off, close Theater, and verify no FFmpeg process/session directory remains after each replacement.
- [ ] Validate fallback behavior by temporarily making ffprobe unavailable; Theater opens against the original stream and hides track menus.
- [ ] Inspect the final diff with git diff --check and ensure only theater-player scope files changed.

Commit:

~~~powershell
git add src-tauri/src/media_tools.rs src-tauri/src/server.rs src-tauri/src/lib.rs src/store/playerStore.ts src/components/TheaterPlayer.tsx src/components/NowPlayingDrawer.tsx src/routes/__root.tsx src/styles.css
git commit -m "feat(player): complete theater video experience"
~~~

