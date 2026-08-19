use super::*;

/// Spawns a lightweight local HTTP streaming & connect server on a dynamic port.
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
  let cors = tower_http::cors::CorsLayer::new()
    .allow_methods(tower_http::cors::Any)
    .allow_origin(tower_http::cors::Any)
    .allow_headers(tower_http::cors::Any);

  // Setup the server router
  let app = Router::new()
    .route("/stream/:file_path", get(stream_file))
    .with_state(state.clone())
    .merge(crate::control::http::control_router(state.clone()))
    .merge(crate::connect::http::connect_router(
      state.connect_hub.clone(),
    ))
    .layer(cors);

  // Bind to 0.0.0.0 on a dynamic port so both localhost and LAN peers can connect
  let listener = tokio::net::TcpListener::bind("0.0.0.0:0")
    .await
    .map_err(|e| format!("Failed to bind to network port: {}", e))?;

  let port = listener
    .local_addr()
    .map_err(|e| format!("Failed to get local address: {}", e))?
    .port();

  // Print startup logs so developers can see the server address in the terminal
  println!(
    "[Navio Server] Started streaming & connect server on port {} (0.0.0.0:{})",
    port, port
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
