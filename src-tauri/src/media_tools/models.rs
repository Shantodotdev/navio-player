use super::*;

/// Resolved paths to the media executables used by theater playback.
#[derive(Clone)]
pub struct MediaTools {
  /// FFmpeg is always available after [`ensure_media_tools`] succeeds.
  pub ffmpeg_path: PathBuf,
  /// FFprobe is optional because the bundled Windows package may omit it.
  pub ffprobe_path: Option<PathBuf>,
}

/// User-selectable audio or subtitle stream embedded in a video file.
#[derive(Clone, serde::Deserialize, serde::Serialize)]
pub struct EmbeddedTrack {
  /// Absolute stream index used by FFmpeg's `-map 0:<index>` syntax.
  pub stream_index: u32,
  /// Container-provided language code, usually ISO 639-2.
  pub language: Option<String>,
  /// Optional human-readable title stored in the container.
  pub title: Option<String>,
  /// Whether the container marks this stream as its default.
  pub is_default: bool,
  /// FFmpeg codec name, used to select remuxing or transcoding.
  pub codec: String,
}

/// Audio and subtitle streams discovered for one source video.
#[derive(Clone, serde::Deserialize, serde::Serialize)]
pub struct VideoTrackInfo {
  /// Selectable audio streams in container order.
  pub audio_tracks: Vec<EmbeddedTrack>,
  /// Selectable subtitle streams in container order.
  pub subtitle_tracks: Vec<EmbeddedTrack>,
}

/// Complete theater startup state returned to the React player.
///
/// Alongside track metadata, this restores the last watch position and the
/// user's language choices. `subtitle_preference_set` distinguishes an
/// explicit "subtitles off" choice from a file that has no saved preference.
#[derive(serde::Serialize)]
pub struct TheaterMediaInfo {
  /// Audio streams available in the current source file.
  pub audio_tracks: Vec<EmbeddedTrack>,
  /// Subtitle streams available in the current source file.
  pub subtitle_tracks: Vec<EmbeddedTrack>,
  /// Last persisted playback position, in seconds.
  pub resume_position_secs: f64,
  /// Audio stream explicitly selected by the user, if any.
  pub preferred_audio_stream_index: Option<u32>,
  /// Whether the user has made a subtitle choice, including choosing "off".
  pub subtitle_preference_set: bool,
  /// Preferred subtitle stream; `None` means off when preference is set.
  pub preferred_subtitle_stream_index: Option<u32>,
  /// Audio streams already prepared on disk and safe to restore immediately.
  pub cached_audio_stream_indexes: Vec<u32>,
}

/// Shared coordinator for persistent state, generated assets, and FFmpeg jobs.
///
/// Clones point to the same inner state, allowing every Tauri command to join
/// existing work and serialize JSON updates without holding global OS threads.
#[derive(Clone, Default)]
pub struct MediaCache {
  pub(super) inner: Arc<MediaCacheInner>,
}

/// Locks independent resources separately so database writes do not block
/// cache cleanup or FFmpeg job registration.
#[derive(Default)]
pub(super) struct MediaCacheInner {
  pub(super) database_lock: tokio::sync::Mutex<()>,
  pub(super) asset_index_lock: tokio::sync::Mutex<()>,
  pub(super) jobs: tokio::sync::Mutex<JobState>,
}

/// Bidirectional lookup for active preparation requests.
///
/// `by_key` deduplicates work by source fingerprint and stream. `request_keys`
/// lets the UI cancel a request using only the request ID it created.
#[derive(Default)]
pub(super) struct JobState {
  pub(super) by_key: HashMap<String, InFlightJob>,
  pub(super) request_keys: HashMap<String, String>,
}

/// One shared FFmpeg operation and all UI requests currently waiting for it.
pub(super) struct InFlightJob {
  /// Publishes the final path or error to every request that joined the job.
  pub(super) result: watch::Receiver<Option<Result<String, String>>>,
  /// Stops FFmpeg when the final interested request is cancelled.
  pub(super) cancel: Option<oneshot::Sender<()>>,
  /// Request IDs that still depend on this shared operation.
  pub(super) request_ids: HashSet<String>,
}

/// On-disk JSON database keyed by a source media fingerprint.
#[derive(Default, serde::Deserialize, serde::Serialize)]
pub(super) struct MediaDatabase {
  #[serde(default)]
  pub(super) entries: HashMap<String, MediaDatabaseEntry>,
}

/// Cached metadata and user playback state for one exact source-file version.
#[derive(Default, serde::Deserialize, serde::Serialize)]
pub(super) struct MediaDatabaseEntry {
  /// Original path retained for diagnostics; the fingerprint is the real key.
  pub(super) path: String,
  #[serde(default)]
  pub(super) tracks: Option<VideoTrackInfo>,
  #[serde(default)]
  pub(super) resume_position_secs: f64,
  #[serde(default)]
  pub(super) preferred_audio_stream_index: Option<u32>,
  #[serde(default)]
  pub(super) subtitle_preference_set: bool,
  #[serde(default)]
  pub(super) preferred_subtitle_stream_index: Option<u32>,
  #[serde(default)]
  pub(super) last_accessed_ms: u64,
}

/// Persistent LRU bookkeeping for generated files in the app cache directory.
#[derive(Default, serde::Deserialize, serde::Serialize)]
pub(super) struct AssetIndex {
  #[serde(default)]
  pub(super) entries: HashMap<String, AssetIndexEntry>,
}

/// Size and access time required to enforce a per-kind cache budget.
#[derive(serde::Deserialize, serde::Serialize)]
pub(super) struct AssetIndexEntry {
  pub(super) kind: AssetKind,
  pub(super) size_bytes: u64,
  pub(super) last_accessed_ms: u64,
}

/// Generated asset classes with independent storage limits.
#[derive(Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum AssetKind {
  Audio,
  Subtitle,
}

/// Minimal portion of FFprobe's JSON response used for track discovery.
#[derive(serde::Deserialize)]
pub(super) struct FfprobeOutput {
  #[serde(default)]
  pub(super) streams: Vec<FfprobeStream>,
}

#[derive(serde::Deserialize)]
pub(super) struct FfprobeStream {
  pub(super) index: u32,
  pub(super) codec_type: String,
  pub(super) codec_name: String,
  #[serde(default)]
  pub(super) tags: FfprobeTags,
  #[serde(default)]
  pub(super) disposition: FfprobeDisposition,
}

#[derive(Default, serde::Deserialize)]
pub(super) struct FfprobeTags {
  pub(super) language: Option<String>,
  pub(super) title: Option<String>,
}

#[derive(Default, serde::Deserialize)]
pub(super) struct FfprobeDisposition {
  #[serde(default)]
  pub(super) default: i32,
}
