//! Client connector used when this Navio desktop instance connects to another remote Navio host.

use super::models::{
  ConnectMessage, ConnectPermissions, ConnectPlaybackAction, DeviceType, Platform,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

/// Active client session state when controlling a remote host.
#[derive(Clone)]
pub struct ConnectClientManager {
  app_handle: AppHandle,
  command_tx: Arc<Mutex<Option<mpsc::UnboundedSender<ConnectPlaybackAction>>>>,
  active_host: Arc<Mutex<Option<ConnectedHostInfo>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedHostInfo {
  pub host_id: String,
  pub host_name: String,
  pub address: String,
  pub port: u16,
  pub permissions: ConnectPermissions,
}

impl ConnectClientManager {
  pub fn new(app_handle: AppHandle) -> Self {
    Self {
      app_handle,
      command_tx: Arc::new(Mutex::new(None)),
      active_host: Arc::new(Mutex::new(None)),
    }
  }

  /// Connects to a remote Navio host using an existing authentication token.
  pub async fn connect_with_token(
    &self,
    host_id: String,
    address: String,
    port: u16,
    token: String,
    client_id: String,
  ) -> Result<ConnectedHostInfo, String> {
    let ws_url = format!("ws://{}:{}/connect/ws", address, port);
    println!("[Navio Connect Client] Connecting to host at {}...", ws_url);

    let (ws_stream, _) = connect_async(&ws_url)
      .await
      .map_err(|e| format!("Failed to connect to remote host: {e}"))?;

    let (mut sender, mut receiver) = ws_stream.split();

    // Send Auth frame
    let auth_msg = ConnectMessage::Auth { token, client_id };
    let auth_text = serde_json::to_string(&auth_msg).map_err(|e| e.to_string())?;
    sender
      .send(Message::Text(auth_text))
      .await
      .map_err(|e| format!("Failed to send auth frame: {e}"))?;

    // Await AuthResult
    let mut host_name = "Remote Host".to_string();
    let mut permissions = ConnectPermissions::default();

    if let Some(Ok(Message::Text(text))) = receiver.next().await {
      if let Ok(ConnectMessage::AuthResult {
        success,
        error_message,
        host_name: name,
        permissions: perms,
      }) = serde_json::from_str::<ConnectMessage>(&text)
      {
        if !success {
          return Err(error_message.unwrap_or_else(|| "Authentication failed".to_string()));
        }
        host_name = name;
        if let Some(p) = perms {
          permissions = p;
        }
      }
    }

    let host_info = ConnectedHostInfo {
      host_id,
      host_name: host_name.clone(),
      address,
      port,
      permissions,
    };

    *self.active_host.lock().unwrap() = Some(host_info.clone());

    // Setup command transmission channel
    let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<ConnectPlaybackAction>();
    *self.command_tx.lock().unwrap() = Some(cmd_tx);

    let app_handle = self.app_handle.clone();
    let active_host_ref = self.active_host.clone();

    // Spawn task to forward outgoing commands to remote host
    let mut send_task = tokio::spawn(async move {
      while let Some(action) = cmd_rx.recv().await {
        let msg = ConnectMessage::Command { action };
        if let Ok(text) = serde_json::to_string(&msg) {
          if sender.send(Message::Text(text)).await.is_err() {
            break;
          }
        }
      }
    });

    // Spawn task to receive incoming StateSync updates from remote host
    let mut recv_task = tokio::spawn(async move {
      while let Some(Ok(msg)) = receiver.next().await {
        if let Message::Text(text) = msg {
          if let Ok(connect_msg) = serde_json::from_str::<ConnectMessage>(&text) {
            match connect_msg {
              ConnectMessage::StateSync { state } => {
                let _ = app_handle.emit("navio-connect://remote-state-sync", state);
              }
              ConnectMessage::RemoteDownloadProgress {
                job_id,
                url,
                percent,
                speed,
                status,
              } => {
                let payload = serde_json::json!({
                  "jobId": job_id,
                  "url": url,
                  "percent": percent,
                  "speed": speed,
                  "status": status,
                });
                let _ = app_handle.emit("navio-connect://remote-download-progress", payload);
              }
              _ => {}
            }
          }
        }
      }
      // Connection dropped
      println!("[Navio Connect Client] Disconnected from remote host");
      *active_host_ref.lock().unwrap() = None;
      let _ = app_handle.emit("navio-connect://remote-disconnected", ());
    });

    tokio::spawn(async move {
      tokio::select! {
        _ = (&mut send_task) => recv_task.abort(),
        _ = (&mut recv_task) => send_task.abort(),
      };
    });

    Ok(host_info)
  }

  /// Pairs with a remote Navio host using a PIN code.
  pub async fn pair_with_pin(
    &self,
    host_id: String,
    address: String,
    port: u16,
    pin: String,
    client_id: String,
    client_name: String,
  ) -> Result<(ConnectedHostInfo, String), String> {
    let ws_url = format!("ws://{}:{}/connect/ws", address, port);
    println!(
      "[Navio Connect Client] Pairing with host at {} using PIN [{}]...",
      ws_url, pin
    );

    let (ws_stream, _) = connect_async(&ws_url)
      .await
      .map_err(|e| format!("Failed to connect for pairing: {e}"))?;

    let (mut sender, mut receiver) = ws_stream.split();

    // Send PairRequest
    let pair_msg = ConnectMessage::PairRequest {
      client_id: client_id.clone(),
      client_name,
      device_type: DeviceType::Desktop,
      platform: Platform::current(),
      pin,
    };
    let pair_text = serde_json::to_string(&pair_msg).map_err(|e| e.to_string())?;
    sender
      .send(Message::Text(pair_text))
      .await
      .map_err(|e| format!("Failed to send pairing frame: {e}"))?;

    let mut token = String::new();
    let mut host_name = "Remote Host".to_string();
    let mut permissions = ConnectPermissions::default();

    if let Some(Ok(Message::Text(text))) = receiver.next().await {
      if let Ok(ConnectMessage::PairResponse {
        success,
        token: returned_token,
        error_message,
        host_name: name,
        permissions: perms,
      }) = serde_json::from_str::<ConnectMessage>(&text)
      {
        if !success {
          return Err(error_message.unwrap_or_else(|| "Pairing failed".to_string()));
        }
        token = returned_token.ok_or_else(|| "No token returned from host".to_string())?;
        host_name = name;
        if let Some(p) = perms {
          permissions = p;
        }
      }
    }

    let host_info = ConnectedHostInfo {
      host_id,
      host_name,
      address,
      port,
      permissions,
    };

    *self.active_host.lock().unwrap() = Some(host_info.clone());

    // Setup command transmission channel
    let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<ConnectPlaybackAction>();
    *self.command_tx.lock().unwrap() = Some(cmd_tx);

    let app_handle = self.app_handle.clone();
    let active_host_ref = self.active_host.clone();

    // Spawn send and receive tasks
    let mut send_task = tokio::spawn(async move {
      while let Some(action) = cmd_rx.recv().await {
        let msg = ConnectMessage::Command { action };
        if let Ok(text) = serde_json::to_string(&msg) {
          if sender.send(Message::Text(text)).await.is_err() {
            break;
          }
        }
      }
    });

    let mut recv_task = tokio::spawn(async move {
      while let Some(Ok(Message::Text(text))) = receiver.next().await {
        if let Ok(ConnectMessage::StateSync { state }) =
          serde_json::from_str::<ConnectMessage>(&text)
        {
          let _ = app_handle.emit("navio-connect://remote-state-sync", state);
        }
      }
      *active_host_ref.lock().unwrap() = None;
      let _ = app_handle.emit("navio-connect://remote-disconnected", ());
    });

    tokio::spawn(async move {
      tokio::select! {
        _ = (&mut send_task) => recv_task.abort(),
        _ = (&mut recv_task) => send_task.abort(),
      };
    });

    Ok((host_info, token))
  }

  /// Sends a playback command to the currently active remote host.
  pub fn send_command(&self, action: ConnectPlaybackAction) -> Result<(), String> {
    if let Some(tx) = self.command_tx.lock().unwrap().as_ref() {
      tx.send(action)
        .map_err(|e| format!("Failed to send remote command: {e}"))?;
      Ok(())
    } else {
      Err("No active remote connection".to_string())
    }
  }

  /// Disconnects from the remote host.
  pub fn disconnect(&self) {
    *self.command_tx.lock().unwrap() = None;
    *self.active_host.lock().unwrap() = None;
  }

  /// Returns the currently active connected host info if any.
  pub fn get_active_host(&self) -> Option<ConnectedHostInfo> {
    self.active_host.lock().unwrap().clone()
  }
}
