use axum::{
  body::Body,
  extract::{Path, State},
  http::{header, HeaderMap, StatusCode},
  response::Response,
  routing::get,
  Router,
};
use std::{
  collections::HashSet,
  path::PathBuf,
  sync::{Arc, Mutex},
};
use tokio::fs::File;
use tokio::io::AsyncReadExt;
use tokio::sync::oneshot;
use tokio_util::io::ReaderStream;
use tower_http::cors::CorsLayer;

/// State shared across the local HTTP streaming server threads.
#[derive(Clone)]
pub struct ServerState {
  /// Directories that the user scanned. Only files inside these dirs can be streamed.
  /// This is a security boundary preventing arbitrary local file reads by webview scripts.
  pub allowed_directories: Arc<Mutex<HashSet<PathBuf>>>,
}

/// Spawns a lightweight local HTTP streaming server on a dynamic port.
///
/// # Arguments
/// * `state` - The shared server configuration containing allowed directory paths.
/// * `shutdown_rx` - A oneshot receiver used to trigger graceful server shutdown on exit.
///
/// # Returns
/// The randomly allocated TCP port number on which the server is listening.
pub async fn start_server(
  state: ServerState,
  shutdown_rx: oneshot::Receiver<()>,
) -> Result<u16, String> {
  // Setup the server router
  // We use percent-decoded path parameters to avoid URL segment clashes with file path separators.
  let app = Router::new()
    .route("/hello", get(hello_world))
    .route("/stream/:file_path", get(stream_file))
    .layer(CorsLayer::permissive())
    .with_state(state);

  // Bind to 127.0.0.1 on a random available port (port 0 requests dynamic allocation)
  let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
    .await
    .map_err(|e| format!("Failed to bind to local port: {}", e))?;
  
  let port = listener
    .local_addr()
    .map_err(|e| format!("Failed to get local address: {}", e))?
    .port();

  // Print startup logs so developers can see the server address in the terminal
  println!("[Ardio Server] Started local streaming server at http://127.0.0.1:{}", port);
  println!("[Ardio Server] Hello testing endpoint: http://127.0.0.1:{}/hello", port);

  // Spawn the server task with a graceful shutdown trigger
  tokio::spawn(async move {
    axum::serve(listener, app)
      .with_graceful_shutdown(async move {
        // Wait for the shutdown signal from the Tauri lifecycle thread
        let _ = shutdown_rx.await;
        println!("[Ardio Server] Local streaming server shutting down gracefully.");
      })
      .await
      .unwrap();
  });

  Ok(port)
}

/// Simple testing endpoint to verify that the local HTTP server is running.
async fn hello_world() -> &'static str {
  "Hello from Ardio Streaming Server!"
}

/// Axum route handler that streams local media files.
/// Implements HTTP Range requests so that the WebView's `<video>` or `<audio>`
/// players can scrub/seek cleanly without loading entire media files into memory.
async fn stream_file(
  State(state): State<ServerState>,
  headers: HeaderMap,
  Path(encoded_path): Path<String>,
) -> Result<Response, StatusCode> {
  // Decode the URL encoded file path
  let decoded_bytes = percent_encoding::percent_decode_str(&encoded_path).collect::<Vec<u8>>();
  let path = PathBuf::from(
    String::from_utf8(decoded_bytes).map_err(|_| StatusCode::BAD_REQUEST)?,
  );

  // SECURITY CHECK: Is the file path within the user's allowed (scanned) directories?
  let is_allowed = {
    let dirs = state.allowed_directories.lock().unwrap();
    dirs.iter().any(|dir| path.starts_with(dir))
  };

  if !is_allowed {
    log::warn!("Access denied for streaming path: {:?}", path);
    return Err(StatusCode::FORBIDDEN);
  }

  if !path.exists() {
    return Err(StatusCode::NOT_FOUND);
  }

  // Open the file asynchronously
  let file = File::open(&path)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
  let metadata = file
    .metadata()
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
  let file_len = metadata.len();

  // Sniff the file extension to get the correct MIME type (e.g., video/mp4, audio/mpeg)
  let mime_type = mime_guess::from_path(&path)
    .first_or_octet_stream()
    .to_string();

  // Check and parse the HTTP Range Header (e.g. "bytes=1000-5000")
  let (start, end) = if let Some(range_header) = headers.get(header::RANGE) {
    let range_str = range_header.to_str().unwrap_or("");
    parse_range(range_str, file_len).unwrap_or((0, file_len - 1))
  } else {
    (0, file_len - 1)
  };

  // Basic validation of range values
  if start >= file_len || end >= file_len || start > end {
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

  Response::builder()
    .status(status)
    .header(header::CONTENT_TYPE, mime_type)
    .header(header::ACCEPT_RANGES, "bytes")
    .header(header::CONTENT_RANGE, format!("bytes {}-{}/{}", start, end, file_len))
    .header(header::CONTENT_LENGTH, chunk_size)
    .body(body)
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

/// Helper function to parse standard HTTP byte-range header strings.
///
/// # Arguments
/// * `range_str` - The raw range header value (e.g. "bytes=2048-")
/// * `file_len` - The total length of the file in bytes.
fn parse_range(range_str: &str, file_len: u64) -> Option<(u64, u64)> {
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
