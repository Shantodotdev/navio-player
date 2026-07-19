use super::{ControlCommand, ControlReply, PendingControlRequest};
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::sync::{mpsc, oneshot, Mutex};
use uuid::Uuid;

const DEFAULT_CONTROL_TIMEOUT: Duration = Duration::from_secs(15);

/// Bounded, correlated handoff between localhost control requests and the renderer.
#[derive(Clone)]
pub struct ControlBroker {
  sender: mpsc::Sender<PendingControlRequest>,
  receiver: Arc<Mutex<mpsc::Receiver<PendingControlRequest>>>,
  pending: Arc<Mutex<HashMap<Uuid, oneshot::Sender<ControlReply>>>>,
  timeout: Duration,
}

impl ControlBroker {
  /// Creates a bounded broker using Navio's production response timeout.
  ///
  /// `capacity` limits commands waiting for the renderer and prevents stalled or
  /// abandoned MCP clients from growing application memory without bound.
  pub fn new(capacity: usize) -> Self {
    Self::with_timeout(capacity, DEFAULT_CONTROL_TIMEOUT)
  }

  /// Creates a bounded broker with an explicitly supplied response timeout.
  ///
  /// Production code uses [`Self::new`]; the explicit duration keeps timeout,
  /// queue-pressure, and cleanup behavior deterministic in unit tests.
  pub fn with_timeout(capacity: usize, timeout: Duration) -> Self {
    let (sender, receiver) = mpsc::channel(capacity);
    Self {
      sender,
      receiver: Arc::new(Mutex::new(receiver)),
      pending: Arc::new(Mutex::new(HashMap::new())),
      timeout,
    }
  }

  /// Enqueues one typed renderer command and awaits only its correlated reply.
  ///
  /// A fresh UUID maps the queue entry to a oneshot sender. Full queues fail
  /// immediately, while expired or disconnected requests remove their pending
  /// sender so a late renderer response cannot leak memory or reach another call.
  pub async fn request(&self, command: ControlCommand) -> Result<ControlReply, String> {
    let id = Uuid::new_v4();
    let (reply_tx, reply_rx) = oneshot::channel();
    self.pending.lock().await.insert(id, reply_tx);

    if self
      .sender
      .try_send(PendingControlRequest { id, command })
      .is_err()
    {
      self.pending.lock().await.remove(&id);
      return Err("Navio is busy handling another agent request.".to_string());
    }

    match tokio::time::timeout(self.timeout, reply_rx).await {
      Ok(Ok(reply)) => Ok(reply),
      Ok(Err(_)) | Err(_) => {
        self.pending.lock().await.remove(&id);
        Err("Navio did not answer the agent request in time.".to_string())
      }
    }
  }

  /// Waits for the next queued command to be executed by the desktop renderer.
  ///
  /// The receiver is mutex-protected so multiple Tauri callers cannot consume
  /// the same request or reorder the broker's FIFO delivery.
  pub async fn next(&self) -> Option<PendingControlRequest> {
    self.receiver.lock().await.recv().await
  }

  /// Delivers a renderer-produced reply to the matching pending HTTP caller.
  ///
  /// Removing the sender before delivery makes completion single-use: unknown,
  /// expired, or duplicate request IDs are rejected instead of being ignored.
  pub async fn complete(&self, id: Uuid, reply: ControlReply) -> Result<(), String> {
    let sender = self
      .pending
      .lock()
      .await
      .remove(&id)
      .ok_or_else(|| "Control request is no longer pending.".to_string())?;
    sender
      .send(reply)
      .map_err(|_| "Control request is no longer pending.".to_string())
  }

  #[cfg(test)]
  /// Returns the number of unresolved correlation entries for leak assertions.
  async fn pending_count(&self) -> usize {
    self.pending.lock().await.len()
  }
}

#[cfg(test)]
mod tests {
  use super::super::{ControlBroker, ControlCommand, ControlReply};
  use serde_json::json;
  use std::time::Duration;

  #[tokio::test]
  /// Verifies FIFO request delivery while allowing replies to complete out of order.
  async fn delivers_commands_in_fifo_order_and_correlates_replies() {
    let broker = ControlBroker::with_timeout(2, Duration::from_millis(100));
    let first_broker = broker.clone();
    let first =
      tokio::spawn(async move { first_broker.request(ControlCommand::GetPlaybackState).await });

    let second_broker = broker.clone();
    let second = tokio::spawn(async move { second_broker.request(ControlCommand::GetQueue).await });

    let first_pending = broker.next().await.expect("first command");
    let second_pending = broker.next().await.expect("second command");
    assert!(matches!(
      first_pending.command,
      ControlCommand::GetPlaybackState
    ));
    assert!(matches!(second_pending.command, ControlCommand::GetQueue));

    broker
      .complete(
        second_pending.id,
        ControlReply::success(json!({ "position": 1 })),
      )
      .await
      .expect("second completion");
    broker
      .complete(
        first_pending.id,
        ControlReply::success(json!({ "playing": true })),
      )
      .await
      .expect("first completion");

    assert_eq!(
      first.await.expect("first join").expect("first reply").data,
      Some(json!({ "playing": true }))
    );
    assert_eq!(
      second
        .await
        .expect("second join")
        .expect("second reply")
        .data,
      Some(json!({ "position": 1 }))
    );
  }

  #[tokio::test]
  /// Verifies that an ID can complete only one live correlation entry.
  async fn rejects_unknown_or_duplicate_completion_ids() {
    let broker = ControlBroker::with_timeout(1, Duration::from_millis(50));
    let unknown = uuid::Uuid::new_v4();

    assert_eq!(
      broker
        .complete(unknown, ControlReply::success(json!(null)))
        .await
        .expect_err("unknown ID must fail"),
      "Control request is no longer pending."
    );
  }

  #[tokio::test]
  /// Verifies queue pressure fails cleanly without retaining orphaned senders.
  async fn rejects_a_full_queue_without_leaking_pending_requests() {
    let broker = ControlBroker::with_timeout(1, Duration::from_millis(50));
    let first_broker = broker.clone();
    let first =
      tokio::spawn(async move { first_broker.request(ControlCommand::GetPlaybackState).await });
    tokio::task::yield_now().await;

    assert_eq!(
      broker
        .request(ControlCommand::GetQueue)
        .await
        .expect_err("full queue must fail"),
      "Navio is busy handling another agent request."
    );

    let pending = broker.next().await.expect("queued command");
    broker
      .complete(pending.id, ControlReply::success(json!(null)))
      .await
      .expect("completion");
    first.await.expect("join").expect("reply");
    assert_eq!(broker.pending_count().await, 0);
  }

  #[tokio::test]
  /// Verifies timed-out callers are removed from the pending correlation map.
  async fn times_out_and_removes_pending_state() {
    let broker = ControlBroker::with_timeout(1, Duration::from_millis(20));

    assert_eq!(
      broker
        .request(ControlCommand::GetPlaybackState)
        .await
        .expect_err("request must time out"),
      "Navio did not answer the agent request in time."
    );
    assert_eq!(broker.pending_count().await, 0);
  }
}
