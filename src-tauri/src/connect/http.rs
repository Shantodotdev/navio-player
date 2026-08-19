//! Axum HTTP routes and WebSocket connection upgrade handlers for Navio Connect.

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

/// Builds the Axum router for all Navio Connect endpoints.
pub fn connect_router(hub: Arc<std::sync::RwLock<Option<ConnectHub>>>) -> Router {
  Router::new()
    .route("/connect/status", get(get_status))
    .route("/connect/ws", get(ws_handler))
    .with_state(hub)
}

/// Endpoint returning public status and identity of this Navio host.
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

/// Manages an active WebSocket connection with a remote client.
async fn handle_socket(socket: WebSocket, hub: Arc<ConnectHub>) {
  let (mut sender, mut receiver) = socket.split();

  println!("[Navio Connect] New WebSocket connection established");

  let mut authenticated_peer_id: Option<String> = None;
  let mut peer_permissions = None;

  // We loop to receive initial handshake (Auth or PairRequest)
  while let Some(Ok(msg)) = receiver.next().await {
    if let Message::Text(text) = msg {
      if let Ok(connect_msg) = serde_json::from_str::<ConnectMessage>(&text) {
        match connect_msg {
          ConnectMessage::Ping => {
            let pong = serde_json::to_string(&ConnectMessage::Pong).unwrap();
            let _ = sender.send(Message::Text(pong)).await;
          }

          // Case 1: Client has an existing auth token
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

              // Send initial state sync snapshot
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

          // Case 2: New client attempting to pair with PIN
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

              // Send initial state sync snapshot
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

  // If not authenticated, close connection
  let peer_id = match authenticated_peer_id {
    Some(id) => id,
    None => {
      println!("[Navio Connect] Closing unauthenticated WebSocket connection");
      return;
    }
  };

  // Broadcast receiver task (Host -> Client)
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

  // Client message receiver loop (Client -> Host)
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

            ConnectMessage::Command { action } => {
              // Check if permissions allow playback control
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

            ConnectMessage::RemoteDownloadRequest { url, title } => {
              // Check if permissions allow remote downloads
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

  // Wait for either send or receive to end
  tokio::select! {
    _ = (&mut send_task) => recv_task.abort(),
    _ = (&mut recv_task) => send_task.abort(),
  };

  println!("[Navio Connect] Client disconnected: {}", peer_id);
}
