/// Helper function to parse standard HTTP byte-range header strings.
///
/// # Arguments
/// * `range_str` - The raw range header value (e.g. "bytes=2048-")
pub(super) fn parse_range(range_str: &str, file_len: u64) -> Option<(u64, u64)> {
  if !range_str.starts_with("bytes=") {
    return None;
  }
  let ranges: Vec<&str> = range_str["bytes=".len()..].split('-').collect();
  if ranges.len() != 2 {
    return None;
  }

  let start = ranges[0].parse::<u64>().ok()?;
  let end = if ranges[1].is_empty() {
    file_len - 1
  } else {
    ranges[1].parse::<u64>().ok()?
  };

  Some((start, end))
}
