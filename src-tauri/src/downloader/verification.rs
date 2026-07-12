//! Low-level integrity checks for externally downloaded Navio helper binaries.
//!
//! This module receives bytes only after HTTP status and size validation, then
//! compares their SHA-256 digest against the pinned value supplied by the
//! downloader module. It writes through a sibling temporary file so a failed
//! fetch or process exit cannot leave a partially written executable at the
//! path that later launch attempts trust.

use super::*;

/// Returns the lowercase SHA-256 digest for an in-memory artifact.
///
/// Callers use this single implementation for both downloaded bytes and files
/// already installed on disk, ensuring the comparison algorithm and encoding
/// cannot drift between verification paths.
pub(super) fn sha256_hex(bytes: &[u8]) -> String {
  let mut hasher = Sha256::new();
  hasher.update(bytes);
  format!("{:x}", hasher.finalize())
}

/// Downloads one helper artifact and returns it only after every integrity check succeeds.
///
/// The response must have a successful HTTP status. Its declared content length,
/// when available, and its actual buffered byte count must both be within
/// `max_bytes`; this prevents an unexpectedly large release artifact from being
/// held in memory. Finally, the full SHA-256 digest must exactly equal the
/// caller's pinned digest before any bytes are returned for installation.
pub(super) async fn download_verified_bytes(
  url: &str,
  expected_sha256: &str,
  max_bytes: u64,
) -> Result<Vec<u8>, String> {
  let response = reqwest::get(url)
    .await
    .map_err(|e| format!("Failed to fetch {}: {}", url, e))?
    .error_for_status()
    .map_err(|e| format!("Unexpected response while fetching {}: {}", url, e))?;

  if let Some(content_len) = response.content_length() {
    if content_len > max_bytes {
      return Err(format!(
        "Refusing {} byte download from {}; limit is {} bytes",
        content_len, url, max_bytes
      ));
    }
  }

  let bytes = response
    .bytes()
    .await
    .map_err(|e| format!("Failed to read release data stream: {}", e))?;

  if bytes.len() as u64 > max_bytes {
    return Err(format!(
      "Refusing {} byte download from {}; limit is {} bytes",
      bytes.len(),
      url,
      max_bytes
    ));
  }

  let actual_sha256 = sha256_hex(&bytes);
  if actual_sha256 != expected_sha256 {
    return Err(format!(
      "Downloaded artifact hash mismatch. Expected {}, got {}",
      expected_sha256, actual_sha256
    ));
  }

  Ok(bytes.to_vec())
}

/// Atomically installs already-verified bytes at a trusted application-managed path.
///
/// The function writes a sibling `.tmp` file first, then renames it into place
/// only after the write succeeds. A failed write cannot replace a previously
/// usable helper binary with a truncated file. The caller must have verified the
/// bytes with [`download_verified_bytes`] before invoking this helper.
pub(super) fn write_verified_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
  let tmp_path = path.with_extension("tmp");
  fs::write(&tmp_path, bytes)
    .map_err(|e| format!("Failed to write temporary file {:?}: {}", tmp_path, e))?;
  fs::rename(&tmp_path, path)
    .map_err(|e| format!("Failed to install verified file {:?}: {}", path, e))?;
  Ok(())
}

/// Returns whether an existing file is readable and exactly matches a pinned SHA-256 digest.
///
/// Read errors, missing files, and digest mismatches all return `false`; the
/// caller can then reinstall a verified release rather than attempting to run
/// an unknown or incomplete executable.
pub(super) fn file_matches_sha256(path: &Path, expected_sha256: &str) -> bool {
  fs::read(path)
    .map(|bytes| sha256_hex(&bytes) == expected_sha256)
    .unwrap_or(false)
}

/// Extracts the major component from a conventional Node.js version string.
///
/// Both `v22.1.0` and `22.1.0` are accepted. Malformed, empty, or non-numeric
/// versions return `None` so runtime detection fails closed.
pub(super) fn parse_node_major(version: &str) -> Option<u32> {
  version
    .trim()
    .strip_prefix('v')
    .unwrap_or_else(|| version.trim())
    .split('.')
    .next()
    .and_then(|major| major.parse::<u32>().ok())
}

/// Detects whether a compatible external Node.js runtime is available to yt-dlp.
///
/// Node is optional for Navio itself, but modern yt-dlp extraction can use it
/// for JavaScript challenges. The command is intentionally probed without a
/// shell, and any spawn, exit-status, UTF-8, or version-parse failure is treated
/// as unavailable rather than blocking downloads that do not require Node.
pub(super) async fn detect_node_js_runtime() -> bool {
  let Ok(output) = Command::new("node").arg("--version").output().await else {
    return false;
  };

  if !output.status.success() {
    return false;
  }

  let version = String::from_utf8_lossy(&output.stdout);
  parse_node_major(&version)
    .map(|major| major >= MIN_NODE_JS_RUNTIME_MAJOR)
    .unwrap_or(false)
}
