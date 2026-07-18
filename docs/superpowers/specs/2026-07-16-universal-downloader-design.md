# Universal Downloader Design

**Goal:** Extend Navio's resilient yt-dlp queue from a YouTube-oriented form into a universal public-media downloader with inspect-first validation, curated advanced options, and clear rejection of authentication-dependent sources.

## Scope

- Accept public media and collection URLs supported by the installed yt-dlp version, including generic HTTP, HTTPS, FTP, and FTPS media URLs.
- Preserve the current durable queue, pause/resume/retry/cancel behavior, private staging directories, and final library import.
- Keep the default interaction one-click: best video, automatic container, no subtitles, and the existing single-item/full-collection choice when a collection is detected.
- Put quality, output format, subtitles, and collection range controls in a collapsed Advanced options section.
- Do not add cookies, credentials, raw yt-dlp arguments, custom headers, browser integration, DRM handling, or arbitrary non-media file downloads.

## Inspection Boundary

Add an `inspect_download_url` Tauri command that uses the same verified yt-dlp binary as downloads. It runs metadata-only inspection with Navio-owned configuration and returns a typed result containing:

- normalized source/extractor name;
- title and optional thumbnail;
- single-item or collection classification and optional item count;
- normalized available video heights and subtitle languages;
- whether the URL represents downloadable media without authentication.

Inspection accepts only `http`, `https`, `ftp`, and `ftps` URLs without embedded username/password information. It never creates a durable queue record. It uses bounded stdout and stderr collection and terminates on a fixed timeout.

yt-dlp authentication, login, cookies, payment, subscription, private-content, and unsupported/DRM-style failures are normalized into a non-technical unavailable response. The UI displays: `This media requires authentication or is otherwise unavailable for public download.` Other failures retain a concise safe diagnostic.

## Download Request

Evolve the persisted request with backward-compatible defaults:

- `media_mode`: `video` or `audio`;
- `quality`: `best`, `2160`, `1440`, `1080`, `720`, `480`, or `360`;
- `video_container`: `auto`, `mp4`, `mkv`, or `webm`;
- `audio_format`: `original`, `mp3`, `m4a`, `opus`, `flac`, or `wav`;
- `subtitle_mode`: `none`, `selected`, or `all`;
- `subtitle_languages`: bounded language-code list;
- `playlist_start` and `playlist_end`: optional positive item bounds.

Legacy `format` values continue to deserialize and are mapped to the new media mode. Retry always reuses the persisted resolved request.

Rust validates every enum and numeric bound and constructs yt-dlp arguments from an allowlist. No renderer-provided string becomes an executable option, output path, or template.

## Format Behavior

- Default video uses yt-dlp's best video-plus-audio selection and automatic output container.
- A quality ceiling selects the best video at or below the chosen height plus best audio, with a combined-format fallback.
- An explicit video container prefers compatible streams and supplies a merge output format.
- Default audio preserves the best source audio stream.
- Explicit audio formats use FFmpeg extraction and conversion.
- Selected subtitles use the chosen inspection languages; all subtitles excludes live-chat tracks and embeds subtitles when the selected video container supports it.
- Playlist start/end are applied only to collection downloads and must form a valid inclusive range.

## Frontend

Rename the page heading to `Download media` and use a universal URL placeholder.

The primary row contains URL, Video/Audio, and Download. A collapsed Advanced options panel contains context-appropriate controls:

- Video: maximum quality and container.
- Audio: output audio format.
- Both: subtitles and collection range.

Submitting changes the button to `Inspecting...`. Inspection errors remain in the form and create no queue card. Successful collection inspection opens the existing choice modal, generalized from playlist/video wording to collection/item wording. Starting a download clears the URL after the backend accepts the job.

## Completion and Auxiliary Files

The existing finalizer remains media-only. Its recognized extensions are expanded only where necessary for supported audio/video output choices. Subtitle sidecar files are not imported into the media library; embedded subtitles are preferred. Private staging containment remains mandatory for every finalized media path.

## Verification

- Rust unit tests cover scheme/userinfo validation, inspection JSON normalization, authentication error classification, request validation, format selectors, subtitle arguments, and playlist ranges.
- Frontend unit tests cover payload conversion, defaults, and advanced-option request shapes.
- Run frontend lint and relevant tests, plus `cargo fmt --check`, downloader tests, and `cargo clippy` because this is a major frontend/Rust change.
- Do not run development servers or production builds.
