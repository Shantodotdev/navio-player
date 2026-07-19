use super::*;

/// Spawns a lightweight local HTTP streaming server on a dynamic port.
///
/// # Arguments
/// * `state` - The shared server configuration containing allowed directory paths.
/// * `shutdown_rx` - A oneshot receiver used to trigger graceful server shutdown on exit.
///
/// # Returns
pub async fn start_server(
  state: ServerState,
  shutdown_rx: oneshot::Receiver<()>,
) -> Result<u16, String> {
  // Setup the server router
  // We use percent-decoded path parameters to avoid URL segment clashes with file path separators.
  let app = Router::new()
    .route("/stream/:file_path", get(stream_file))
    .with_state(state.clone())
    .merge(crate::control::http::control_router(state));

  // Bind to 127.0.0.1 on a random available port (port 0 requests dynamic allocation)
  let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
    .await
    .map_err(|e| format!("Failed to bind to local port: {}", e))?;

  let port = listener
    .local_addr()
    .map_err(|e| format!("Failed to get local address: {}", e))?
    .port();

  // Print startup logs so developers can see the server address in the terminal
  println!(
    "[Navio Server] Started local streaming server at http://127.0.0.1:{}",
    port
  );
  // Spawn the server task with a graceful shutdown trigger
  tokio::spawn(async move {
    axum::serve(listener, app)
      .with_graceful_shutdown(async move {
        // Wait for the shutdown signal from the Tauri lifecycle thread
        let _ = shutdown_rx.await;
        println!("[Navio Server] Local streaming server shutting down gracefully.");
      })
      .await
      .unwrap();
  });

  Ok(port)
}
