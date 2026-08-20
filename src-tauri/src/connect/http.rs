//! Axum HTTP routes and WebSocket connection upgrade handlers for Navio Connect.
//!
//! # Protocol Lifecycle over `/connect/ws`
//!
//! 1. **Handshake & Upgrade**:
//!    - The remote client connects via HTTP GET with WebSocket upgrade headers.
//!    - Axum upgrades the TCP stream to full-duplex WebSocket framing.
//!
//! 2. **Authentication / Pairing Phase**:
//!    - The connection initially enters an unauthenticated staging loop.
//!    - If the client sends `Auth { token, client_id }`, the hub checks the saved token.
//!    - If the client sends `PairRequest { pin, ... }`, the hub verifies the 4-digit PIN.
//!    - On success, the server replies with `AuthResult` / `PairResponse` and immediately
//!      sends the first `StateSync` snapshot.
//!    - On failure, the server sends an error message and terminates the connection.
//!
//! 3. **Bidirectional Communication Phase**:
//!    - The socket is split into `(sender, receiver)`:
//!      - **Sender Task**: Listens to the `hub.subscribe_broadcast()` channel and forwards
//!        live player updates (`StateSync`, `RemoteDownloadProgress`) to the client.
//!      - **Receiver Task**: Reads incoming commands (`Play`, `Pause`, `Seek`, `Download`)
//!        from the client, validates permissions, and dispatches events to the Tauri renderer.

use super::hub::ConnectHub;
use super::models::ConnectMessage;
use axum::{
  extract::{
    ws::{Message, WebSocket, WebSocketUpgrade},
    State,
  },
  http::StatusCode,
  response::{IntoResponse, Json},
  routing::get,
  Router,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use std::sync::Arc;

/// Builds the Axum router for all Navio Connect network endpoints.
///
/// Merged into the main server router in `src/server/startup.rs`.
pub fn connect_router(hub: Arc<std::sync::RwLock<Option<ConnectHub>>>) -> Router {
  Router::new()
    .route("/connect/status", get(get_status))
    .route("/connect/ws", get(ws_handler))
    .with_state(hub)
}

/// Endpoint returning public status and machine identity of this Navio host.
///
/// Used by remote clients for pre-flight connectivity checks before opening WebSockets.
async fn get_status(
  State(hub_lock): State<Arc<std::sync::RwLock<Option<ConnectHub>>>>,
) -> impl IntoResponse {
  if let Some(hub) = hub_lock.read().unwrap().as_ref() {
    let info = hub.get_local_info();
    Json(info).into_response()
  } else {
    StatusCode::SERVICE_UNAVAILABLE.into_response()
  }
}

/// WebSocket upgrade handler.
///
/// Validates the HTTP upgrade request and spawns the full-duplex socket handler task.
async fn ws_handler(
  ws: WebSocketUpgrade,
  State(hub_lock): State<Arc<std::sync::RwLock<Option<ConnectHub>>>>,
) -> impl IntoResponse {
  if let Some(hub) = hub_lock.read().unwrap().as_ref().cloned() {
    ws.on_upgrade(move |socket| handle_socket(socket, Arc::new(hub)))
      .into_response()
  } else {
    StatusCode::SERVICE_UNAVAILABLE.into_response()
  }
}

/// Manages an active WebSocket connection with a remote client (Mac, Linux, iPhone, or PWA).
async fn handle_socket(socket: WebSocket, hub: Arc<ConnectHub>) {
  // Split the duplex WebSocket into independent Send and Receive halves.
  // This allows concurrent reading and writing without mutex contention.
  let (mut sender, mut receiver) = socket.split();

  println!("[Navio Connect] New WebSocket connection established");

  let mut authenticated_peer_id: Option<String> = None;
  let mut peer_permissions = None;

  // Phase 1: Authentication / Pairing Loop
  // The client must prove its identity before receiving state broadcasts or dispatching commands.
  while let Some(Ok(msg)) = receiver.next().await {
    if let Message::Text(text) = msg {
      if let Ok(connect_msg) = serde_json::from_str::<ConnectMessage>(&text) {
        match connect_msg {
          // Keep-alive ping from client
          ConnectMessage::Ping => {
            let pong = serde_json::to_string(&ConnectMessage::Pong).unwrap();
            let _ = sender.send(Message::Text(pong)).await;
          }

          // Case A: Client possesses an existing auth token (reconnection)
          ConnectMessage::Auth { token, client_id } => {
            if let Some(paired_device) = hub.validate_token(&token, &client_id) {
              println!(
                "[Navio Connect] Client authenticated successfully: \"{}\" ({})",
                paired_device.name, paired_device.id
              );
              authenticated_peer_id = Some(paired_device.id.clone());
              peer_permissions = Some(paired_device.permissions.clone());

              let auth_response = ConnectMessage::AuthResult {
                success: true,
                error_message: None,
                host_name: hub.get_local_info().name,
                permissions: Some(paired_device.permissions),
              };
              let resp_text = serde_json::to_string(&auth_response).unwrap();
              let _ = sender.send(Message::Text(resp_text)).await;

              // Send immediate playback state sync so the remote UI updates instantly
              let state = hub.get_current_player_state();
              let state_msg = serde_json::to_string(&ConnectMessage::StateSync { state }).unwrap();
              let _ = sender.send(Message::Text(state_msg)).await;
              break;
            } else {
              println!(
                "[Navio Connect] Authentication failed for client ID: {}",
                client_id
              );
              let auth_response = ConnectMessage::AuthResult {
                success: false,
                error_message: Some("Invalid token or unauthorized device".to_string()),
                host_name: hub.get_local_info().name,
                permissions: None,
              };
              let resp_text = serde_json::to_string(&auth_response).unwrap();
              let _ = sender.send(Message::Text(resp_text)).await;
            }
          }

          // Case B: New client pairing with 4-digit PIN code
          ConnectMessage::PairRequest {
            client_id,
            client_name,
            device_type,
            platform,
            pin,
          } => {
            if hub.verify_pin(&pin) {
              let (paired, token) = hub.add_paired_device(
                client_id.clone(),
                client_name.clone(),
                device_type,
                platform,
              );
              authenticated_peer_id = Some(paired.id.clone());
              peer_permissions = Some(paired.permissions.clone());

              let pair_response = ConnectMessage::PairResponse {
                success: true,
                token: Some(token),
                error_message: None,
                host_name: hub.get_local_info().name,
                permissions: Some(paired.permissions),
              };
              let resp_text = serde_json::to_string(&pair_response).unwrap();
              let _ = sender.send(Message::Text(resp_text)).await;

              // Send immediate playback state sync
              let state = hub.get_current_player_state();
              let state_msg = serde_json::to_string(&ConnectMessage::StateSync { state }).unwrap();
              let _ = sender.send(Message::Text(state_msg)).await;
              break;
            } else {
              println!(
                "[Navio Connect] Pairing failed: Invalid PIN [{}] from \"{}\"",
                pin, client_name
              );
              let pair_response = ConnectMessage::PairResponse {
                success: false,
                token: None,
                error_message: Some("Invalid PIN code. Please try again.".to_string()),
                host_name: hub.get_local_info().name,
                permissions: None,
              };
              let resp_text = serde_json::to_string(&pair_response).unwrap();
              let _ = sender.send(Message::Text(resp_text)).await;
            }
          }

          _ => {}
        }
      }
    }
  }

  // If the loop finished without authenticating (e.g. client disconnected or failed auth), exit
  let peer_id = match authenticated_peer_id {
    Some(id) => id,
    None => {
      println!("[Navio Connect] Closing unauthenticated WebSocket connection");
      return;
    }
  };

  // Phase 2: Full-Duplex Real-Time Operation
  // Task 1: Outgoing Broadcast Forwarder (Host -> Client)
  let mut broadcast_rx = hub.subscribe_broadcast();
  let mut send_task = tokio::spawn(async move {
    while let Ok(msg) = broadcast_rx.recv().await {
      if let Ok(text) = serde_json::to_string(&msg) {
        if sender.send(Message::Text(text)).await.is_err() {
          break;
        }
      }
    }
  });

  // Task 2: Incoming Command Receiver (Client -> Host)
  let hub_clone = hub.clone();
  let peer_id_clone = peer_id.clone();

  let mut recv_task = tokio::spawn(async move {
    while let Some(Ok(msg)) = receiver.next().await {
      if let Message::Text(text) = msg {
        if let Ok(connect_msg) = serde_json::from_str::<ConnectMessage>(&text) {
          match connect_msg {
            ConnectMessage::Ping => {
              hub_clone.broadcast_message(ConnectMessage::Pong);
            }

            // Client sent playback command (Play, Pause, Seek, Volume, Next/Previous)
            ConnectMessage::Command { action } => {
              // Permission check: ensure playback control is allowed for this peer
              if let Some(perms) = &peer_permissions {
                if !perms.allow_playback_control {
                  println!(
                    "[Navio Connect] Blocked command from {}: playback control permission disabled",
                    peer_id_clone
                  );
                  continue;
                }
              }

              println!(
                "[Navio Connect] Received command from {}: {:?}",
                peer_id_clone, action
              );

              // Dispatch command event to Tauri renderer
              let _ = hub_clone.emit_event("navio-connect://playback-command", action);
            }

            // Client requested a remote media download on this host
            ConnectMessage::RemoteDownloadRequest { url, title } => {
              // Permission check: ensure remote downloader is allowed for this peer
              if let Some(perms) = &peer_permissions {
                if !perms.allow_remote_download {
                  println!(
                    "[Navio Connect] Blocked remote download from {}: permission disabled",
                    peer_id_clone
                  );
                  continue;
                }
              }

              println!(
                "[Navio Connect] Received remote download request from {}: {}",
                peer_id_clone, url
              );

              let payload = json!({
                "url": url,
                "title": title,
                "requestedBy": peer_id_clone
              });
              let _ = hub_clone.emit_event("navio-connect://remote-download", payload);
            }

            _ => {}
          }
        }
      }
    }
  });

  // Wait for either sending or receiving task to finish (e.g. client disconnects or socket breaks)
  // `tokio::select!` cancels the other task cleanly to prevent zombie coroutines.
  tokio::select! {
    _ = (&mut send_task) => recv_task.abort(),
    _ = (&mut recv_task) => send_task.abort(),
  };

  println!("[Navio Connect] Client disconnected: {}", peer_id);
}
