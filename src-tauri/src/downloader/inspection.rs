//! Metadata-only public URL inspection for Navio's universal downloader.

use super::*;
use serde_json::Value;
use std::collections::BTreeSet;
use std::time::Duration;

pub const PUBLIC_UNAVAILABLE_MESSAGE: &str =
  "This media requires authentication or is otherwise unavailable for public download.";
const MAX_INSPECTION_OUTPUT_BYTES: usize = 8 * 1024 * 1024;
const INSPECTION_TIMEOUT: Duration = Duration::from_secs(45);

/// Stable, presentation-ready metadata returned before Navio creates a queue job.
#[derive(Debug, serde::Serialize)]
pub struct DownloadInspection {
  pub source: String,
  pub title: String,
  pub thumbnail: Option<String>,
  pub is_collection: bool,
  pub item_count: Option<u32>,
  pub video_qualities: Vec<u32>,
  pub subtitle_languages: Vec<String>,
}

/// Accepts only remote public-media schemes and rejects credentials embedded in URLs.
pub(super) fn validate_public_media_url(url: &str) -> Result<reqwest::Url, String> {
  let parsed = reqwest::Url::parse(url).map_err(|_| "Enter a valid media URL.".to_string())?;
  if !matches!(parsed.scheme(), "http" | "https" | "ftp" | "ftps") {
    return Err("Navio supports HTTP, HTTPS, FTP, and FTPS media URLs.".to_string());
  }
  if !parsed.username().is_empty() || parsed.password().is_some() {
    return Err(PUBLIC_UNAVAILABLE_MESSAGE.to_string());
  }
  Ok(parsed)
}

/// Normalizes yt-dlp's single-JSON response into the small shape used by the form.
fn parse_inspection_json(json: &str) -> Result<DownloadInspection, String> {
  let value: Value = serde_json::from_str(json)
    .map_err(|_| "The media source returned an unreadable response.".to_string())?;
  let entries = value.get("entries").and_then(Value::as_array);
  let is_collection = matches!(
    value.get("_type").and_then(Value::as_str),
    Some("playlist" | "multi_video")
  ) || entries.is_some();
  let item_count = value
    .get("playlist_count")
    .and_then(Value::as_u64)
    .or_else(|| entries.map(|items| items.len() as u64))
    .and_then(|count| u32::try_from(count).ok());

  let mut video_qualities = value
    .get("formats")
    .and_then(Value::as_array)
    .into_iter()
    .flatten()
    .filter_map(|format| format.get("height").and_then(Value::as_u64))
    .filter_map(|height| u32::try_from(height).ok())
    .collect::<Vec<_>>();
  video_qualities.sort_unstable_by(|left, right| right.cmp(left));
  video_qualities.dedup();

  let mut subtitle_languages = BTreeSet::new();
  for key in ["subtitles", "automatic_captions"] {
    if let Some(languages) = value.get(key).and_then(Value::as_object) {
      subtitle_languages.extend(languages.keys().cloned());
    }
  }

  Ok(DownloadInspection {
    source: value
      .get("extractor_key")
      .or_else(|| value.get("extractor"))
      .and_then(Value::as_str)
      .unwrap_or("Generic")
      .to_string(),
    title: value
      .get("title")
      .and_then(Value::as_str)
      .unwrap_or("Untitled media")
      .to_string(),
    thumbnail: value
      .get("thumbnail")
      .and_then(Value::as_str)
      .map(str::to_string),
    is_collection,
    item_count,
    video_qualities,
    subtitle_languages: subtitle_languages.into_iter().collect(),
  })
}

/// Converts authentication failures to simple product copy and bounds all other diagnostics.
fn normalize_inspection_error(error: &str) -> String {
  let lower = error.to_ascii_lowercase();
  if [
    "login",
    "log in",
    "sign in",
    "cookie",
    "authentication",
    "account",
    "private",
    "members-only",
    "subscription",
    "premium",
    "payment",
    "unsupported url",
    "drm",
    "no video formats",
    "not available",
    "geo-restricted",
    "copyright",
    "has been removed",
    "unable to extract",
  ]
  .iter()
  .any(|marker| lower.contains(marker))
  {
    return PUBLIC_UNAVAILABLE_MESSAGE.to_string();
  }
  error
    .lines()
    .rev()
    .find(|line| !line.trim().is_empty())
    .unwrap_or(PUBLIC_UNAVAILABLE_MESSAGE)
    .trim()
    .chars()
    .take(500)
    .collect()
}

/// Inspects a public URL through Navio's verified yt-dlp without downloading media.
#[tauri::command]
pub async fn inspect_download_url(
  url: String,
  app_handle: AppHandle,
) -> Result<DownloadInspection, String> {
  validate_public_media_url(&url)?;
  let ytdlp_path = ensure_ytdlp_installed(&app_handle, "inspection").await?;
  let mut command = Command::new(ytdlp_path);
  super::command::hide_console_window(&mut command);
  command.kill_on_drop(true);
  if detect_node_js_runtime().await {
    command.arg("--js-runtimes").arg("node");
  }
  command
    .arg("--ignore-config")
    .args(YTDLP_OUTPUT_ENCODING_ARGS)
    .arg("--dump-single-json")
    .arg("--skip-download")
    .arg("--flat-playlist")
    .arg("--no-warnings")
    .arg("--yes-playlist")
    .arg(&url)
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

  let output = tokio::time::timeout(INSPECTION_TIMEOUT, command.output())
    .await
    .map_err(|_| "Media inspection timed out. Check the URL and try again.".to_string())?
    .map_err(|error| format!("Could not inspect this media URL: {error}"))?;
  if output.stdout.len() > MAX_INSPECTION_OUTPUT_BYTES
    || output.stderr.len() > MAX_INSPECTION_OUTPUT_BYTES
  {
    return Err("This collection is too large to inspect safely.".to_string());
  }
  if !output.status.success() {
    return Err(normalize_inspection_error(&String::from_utf8_lossy(
      &output.stderr,
    )));
  }
  parse_inspection_json(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn public_media_urls_allow_network_schemes_without_credentials() {
    for url in [
      "https://example.test/video",
      "http://example.test/video.mp4",
      "ftp://example.test/audio.flac",
      "ftps://example.test/video.webm",
    ] {
      assert!(validate_public_media_url(url).is_ok(), "{url} should pass");
    }
    assert!(validate_public_media_url("file:///tmp/video.mp4").is_err());
    assert!(validate_public_media_url("https://user:secret@example.test/video").is_err());
  }

  #[test]
  fn inspection_json_normalizes_formats_subtitles_and_collections() {
    let video = parse_inspection_json(
      r#"{
        "extractor_key":"Generic","title":"Public video","thumbnail":"https://example.test/thumb.jpg",
        "formats":[{"height":720},{"height":1080},{"height":720},{"height":null}],
        "subtitles":{"en":[]},"automatic_captions":{"bn":[]}
      }"#,
    )
    .expect("video inspection should parse");
    assert_eq!(video.source, "Generic");
    assert_eq!(video.video_qualities, vec![1080, 720]);
    assert_eq!(video.subtitle_languages, vec!["bn", "en"]);
    assert!(!video.is_collection);

    let collection = parse_inspection_json(
      r#"{"_type":"playlist","extractor_key":"facebook","title":"Saved videos","entries":[{"id":"1"},{"id":"2"}]}"#,
    )
    .expect("collection inspection should parse");
    assert!(collection.is_collection);
    assert_eq!(collection.item_count, Some(2));
  }

  #[test]
  fn unavailable_sources_use_a_non_technical_message() {
    assert_eq!(
      normalize_inspection_error("ERROR: Login required. Use --cookies-from-browser"),
      PUBLIC_UNAVAILABLE_MESSAGE
    );
    assert_eq!(
      normalize_inspection_error("ERROR: Unsupported URL: https://example.test/media"),
      PUBLIC_UNAVAILABLE_MESSAGE
    );
  }
}
