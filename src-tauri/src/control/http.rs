use crate::server::ServerState;
use axum::{
  extract::{DefaultBodyLimit, State},
  http::{header::AUTHORIZATION, HeaderMap, StatusCode},
  response::IntoResponse,
  routing::{get, post},
  Json, Router,
};
use serde::Serialize;

pub const MAX_CONTROL_BODY_BYTES: usize = 16 * 1024;

#[derive(Serialize)]
struct HealthResponse {
  status: &'static str,
  version: u8,
}

/// Builds the private control router mounted beside Navio's media stream routes.
///
/// Both endpoints require the per-process control bearer token, and a strict
/// body limit is installed before JSON extraction. The router intentionally
/// adds no browser-facing CORS policy.
pub fn control_router(state: ServerState) -> Router {
  Router::new()
    .route("/control/health", get(control_health))
    .route("/control/command", post(control_command))
    .layer(DefaultBodyLimit::max(MAX_CONTROL_BODY_BYTES))
    .with_state(state)
}

/// Reports whether the descriptor's authenticated desktop endpoint is alive.
///
/// MCP clients use this lightweight probe to reject stale descriptors before
/// sending a command or deciding to launch a new desktop process.
async fn control_health(State(state): State<ServerState>, headers: HeaderMap) -> impl IntoResponse {
  if !has_valid_bearer(&headers, &state.control_token) {
    return StatusCode::UNAUTHORIZED.into_response();
  }
  Json(HealthResponse {
    status: "ready",
    version: 1,
  })
  .into_response()
}

/// Dispatches one authenticated typed command through the renderer broker.
///
/// Successful renderer replies retain HTTP 200 even when their product-level
/// `success` field is false. Broker pressure or timeout failures use HTTP 503 so
/// the MCP transport can distinguish them from a completed command response.
async fn control_command(
  State(state): State<ServerState>,
  headers: HeaderMap,
  Json(command): Json<crate::control::ControlCommand>,
) -> impl IntoResponse {
  if !has_valid_bearer(&headers, &state.control_token) {
    return StatusCode::UNAUTHORIZED.into_response();
  }
  match state.control_broker.request(command).await {
    Ok(reply) => Json(reply).into_response(),
    Err(message) => (
      StatusCode::SERVICE_UNAVAILABLE,
      Json(crate::control::ControlReply::error(message)),
    )
      .into_response(),
  }
}

/// Compares the request's bearer credential with the current per-run token.
///
/// Missing, malformed, and non-Bearer authorization headers all fail closed.
fn has_valid_bearer(headers: &HeaderMap, expected_token: &str) -> bool {
  headers
    .get(AUTHORIZATION)
    .and_then(|value| value.to_str().ok())
    .and_then(|value| value.strip_prefix("Bearer "))
    .map(|token| token == expected_token)
    .unwrap_or(false)
}

#[cfg(test)]
mod tests {
  use super::*;
  use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
  };
  use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
  };
  use tower::ServiceExt;

  /// Creates isolated server state with fixed credentials for route tests.
  fn test_state() -> ServerState {
    ServerState {
      allowed_directories: Arc::new(Mutex::new(HashSet::new())),
      stream_token: "stream-secret".to_string(),
      control_token: "control-secret".to_string(),
      control_broker: crate::control::ControlBroker::new(2),
    }
  }

  #[tokio::test]
  /// Verifies health discovery fails closed for missing and incorrect credentials.
  async fn health_requires_the_control_bearer_token() {
    let app = control_router(test_state());
    let missing = app
      .clone()
      .oneshot(Request::get("/control/health").body(Body::empty()).unwrap())
      .await
      .unwrap();
    assert_eq!(missing.status(), StatusCode::UNAUTHORIZED);

    let wrong = app
      .clone()
      .oneshot(
        Request::get("/control/health")
          .header("authorization", "Bearer wrong")
          .body(Body::empty())
          .unwrap(),
      )
      .await
      .unwrap();
    assert_eq!(wrong.status(), StatusCode::UNAUTHORIZED);

    let accepted = app
      .oneshot(
        Request::get("/control/health")
          .header("authorization", "Bearer control-secret")
          .body(Body::empty())
          .unwrap(),
      )
      .await
      .unwrap();
    assert_eq!(accepted.status(), StatusCode::OK);
    assert_eq!(
      to_bytes(accepted.into_body(), 1024).await.unwrap(),
      r#"{"status":"ready","version":1}"#
    );
  }

  #[tokio::test]
  /// Verifies oversized bodies are rejected before command JSON reaches the broker.
  async fn command_endpoint_rejects_oversized_json_before_dispatch() {
    let response = control_router(test_state())
      .oneshot(
        Request::post("/control/command")
          .header("authorization", "Bearer control-secret")
          .header("content-type", "application/json")
          .body(Body::from(vec![b'x'; MAX_CONTROL_BODY_BYTES + 1]))
          .unwrap(),
      )
      .await
      .unwrap();

    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
  }

  #[tokio::test]
  /// Verifies a valid HTTP command is correlated with its renderer completion.
  async fn authenticated_command_round_trips_through_the_renderer_broker() {
    let state = test_state();
    let broker = state.control_broker.clone();
    let response_task = tokio::spawn(async move {
      control_router(state)
        .oneshot(
          Request::post("/control/command")
            .header("authorization", "Bearer control-secret")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"type":"get_playback_state"}"#))
            .unwrap(),
        )
        .await
        .unwrap()
    });

    let pending = broker.next().await.expect("renderer command");
    assert!(matches!(
      pending.command,
      crate::control::ControlCommand::GetPlaybackState
    ));
    broker
      .complete(
        pending.id,
        crate::control::ControlReply::success(serde_json::json!({ "playing": true })),
      )
      .await
      .expect("complete renderer command");

    let response = response_task.await.expect("join HTTP request");
    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), 1024).await.unwrap();
    let reply: crate::control::ControlReply = serde_json::from_slice(&body).unwrap();
    assert!(reply.success);
    assert_eq!(reply.data, Some(serde_json::json!({ "playing": true })));
  }
}
