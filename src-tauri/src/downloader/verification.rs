use super::*;

pub(super) fn sha256_hex(bytes: &[u8]) -> String {
  let mut hasher = Sha256::new();
  hasher.update(bytes);
  format!("{:x}", hasher.finalize())
}

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

pub(super) fn write_verified_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
  let tmp_path = path.with_extension("tmp");
  fs::write(&tmp_path, bytes)
    .map_err(|e| format!("Failed to write temporary file {:?}: {}", tmp_path, e))?;
  fs::rename(&tmp_path, path)
    .map_err(|e| format!("Failed to install verified file {:?}: {}", path, e))?;
  Ok(())
}

pub(super) fn file_matches_sha256(path: &Path, expected_sha256: &str) -> bool {
  fs::read(path)
    .map(|bytes| sha256_hex(&bytes) == expected_sha256)
    .unwrap_or(false)
}

pub(super) fn parse_node_major(version: &str) -> Option<u32> {
  version
    .trim()
    .strip_prefix('v')
    .unwrap_or_else(|| version.trim())
    .split('.')
    .next()
    .and_then(|major| major.parse::<u32>().ok())
}

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
