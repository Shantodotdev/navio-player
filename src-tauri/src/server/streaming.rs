use super::*;

fn is_path_allowed(path: &StdPath, allowed_directories: &HashSet<PathBuf>) -> bool {
  let Ok(canonical_path) = path.canonicalize() else {
    return false;
  };

  allowed_directories.iter().any(|dir| {
    dir
      .canonicalize()
      .map(|canonical_dir| canonical_path.starts_with(canonical_dir))
      .unwrap_or(false)
  })
}

/// Axum route handler that streams local media files.
/// Implements HTTP Range requests so that the WebView's `<video>` or `<audio>`
/// players can scrub/seek cleanly without loading entire media files into memory.
pub(super) async fn stream_file(
  State(state): State<ServerState>,
  Query(query): Query<StreamQuery>,
  headers: HeaderMap,
  Path(encoded_path): Path<String>,
) -> Result<Response, StatusCode> {
  println!("[Navio Server] stream request received");

  if query.token != state.stream_token {
    println!("[Navio Server] stream request rejected: invalid token");
    return Err(StatusCode::FORBIDDEN);
  }

  // Decode the URL encoded file path
  let decoded_bytes = percent_encoding::percent_decode_str(&encoded_path).collect::<Vec<u8>>();
  let path = PathBuf::from(String::from_utf8(decoded_bytes).map_err(|_| StatusCode::BAD_REQUEST)?);
  println!("[Navio Server] stream request path decoded: {:?}", path);

  if !path.exists() || !path.is_file() {
    println!(
      "[Navio Server] stream request rejected: file not found or not a file: {:?}",
      path
    );
    return Err(StatusCode::NOT_FOUND);
  }

  // SECURITY CHECK: Is the file path within the user's allowed (scanned) directories?
  let is_allowed = {
    let dirs = state.allowed_directories.lock().unwrap();
    let allowed = is_path_allowed(&path, &dirs);

    if !allowed {
      println!(
        "[Navio Server] Access denied for streaming path: {:?}",
        path
      );
      println!("[Navio Server] Allowed directories were: {:?}", *dirs);
    }

    allowed
  };

  if !is_allowed {
    return Err(StatusCode::FORBIDDEN);
  }
  println!("[Navio Server] stream request authorized: {:?}", path);

  // Open the file asynchronously
  let file = File::open(&path)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
  let metadata = file
    .metadata()
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
  let file_len = metadata.len();

  if file_len == 0 {
    println!("[Navio Server] streaming empty file: {:?}", path);
    return Response::builder()
      .status(StatusCode::OK)
      .header(header::CONTENT_LENGTH, 0)
      .body(Body::empty())
      .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR);
  }

  // Sniff the file extension to get the correct MIME type (e.g., video/mp4, audio/mpeg)
  let mime_type = mime_guess::from_path(&path)
    .first_or_octet_stream()
    .to_string();

  // Check and parse the HTTP Range Header (e.g. "bytes=1000-5000")
  let (start, end) = if let Some(range_header) = headers.get(header::RANGE) {
    let range_str = range_header.to_str().unwrap_or("");
    println!("[Navio Server] stream range header: {}", range_str);
    parse_range(range_str, file_len).unwrap_or((0, file_len - 1))
  } else {
    (0, file_len - 1)
  };

  // Basic validation of range values
  if start >= file_len || end >= file_len || start > end {
    println!(
      "[Navio Server] stream request rejected: unsatisfiable range {}-{} for len {}",
      start, end, file_len
    );
    return Err(StatusCode::RANGE_NOT_SATISFIABLE);
  }

  // Calculate the chunk size
  let chunk_size = end - start + 1;

  // Seek to the start position of the range inside the file
  use tokio::io::AsyncSeekExt;
  let mut file = file;
  file
    .seek(std::io::SeekFrom::Start(start))
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

  // Stream only the requested chunk size.
  // Using ReaderStream with capacity ensures we only hold a tiny chunk of data (64KB buffer)
  // in memory at any point. This ensures flat, low-RAM usage for files of arbitrary sizes.
  let stream = ReaderStream::with_capacity(file.take(chunk_size), 64 * 1024);
  let body = Body::from_stream(stream);

  let status = if chunk_size < file_len {
    StatusCode::PARTIAL_CONTENT // HTTP 206 indicates partial byte-range content
  } else {
    StatusCode::OK // HTTP 200 for full file content
  };
  println!(
    "[Navio Server] streaming response | status={} path={:?} bytes={}-{} len={} mime={}",
    status.as_u16(),
    path,
    start,
    end,
    file_len,
    mime_type
  );

  Response::builder()
    .status(status)
    .header(header::CONTENT_TYPE, mime_type)
    // Captions are fetched with CORS even when the video itself can stream
    // without it. The bearer token and path allowlist remain the access
    // boundary, so this permits the local WebView to load generated WebVTT.
    .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
    .header(header::ACCEPT_RANGES, "bytes")
    .header(
      header::CONTENT_RANGE,
      format!("bytes {}-{}/{}", start, end, file_len),
    )
    .header(header::CONTENT_LENGTH, chunk_size)
    .body(body)
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}
