use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const ACTIVITY_DATABASE_VERSION: u32 = 1;

/// Minimal live-media information required to reconcile persistent activity.
#[derive(Clone, Debug)]
pub struct ActivityMedia {
  pub id: String,
  pub path: String,
  pub duration_secs: f64,
  pub media_type: String,
}

/// Durable activity fields associated with one stable Navio media ID.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
pub struct ActivityEntry {
  pub media_id: String,
  pub path: String,
  #[serde(default)]
  pub added_at_ms: Option<u64>,
  #[serde(default)]
  pub last_played_at_ms: Option<u64>,
  #[serde(default)]
  pub play_count: u64,
  #[serde(default)]
  pub resume_position_secs: f64,
  #[serde(default)]
  pub duration_secs: f64,
  #[serde(default)]
  pub progress_updated_at_ms: Option<u64>,
  #[serde(default)]
  pub last_seen_at_ms: u64,
}

/// One meaningful playback milestone emitted at most once per frontend session.
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PlaybackMilestone {
  RecentlyPlayed,
  PlayCount,
}

/// Versioned JSON document stored in Navio's application data directory.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct ActivityDatabase {
  #[serde(default = "current_version")]
  pub(super) version: u32,
  #[serde(default)]
  pub(super) initialized: bool,
  #[serde(default)]
  pub(super) entries: HashMap<String, ActivityEntry>,
}

impl Default for ActivityDatabase {
  fn default() -> Self {
    Self {
      version: ACTIVITY_DATABASE_VERSION,
      initialized: false,
      entries: HashMap::new(),
    }
  }
}

fn current_version() -> u32 {
  ACTIVITY_DATABASE_VERSION
}

/// Resume fields imported once from the existing theater database.
#[derive(Clone, Debug, Default, Deserialize)]
pub(super) struct TheaterDatabase {
  #[serde(default)]
  pub(super) entries: HashMap<String, TheaterEntry>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub(super) struct TheaterEntry {
  #[serde(default)]
  pub(super) path: String,
  #[serde(default)]
  pub(super) resume_position_secs: f64,
  #[serde(default)]
  pub(super) last_accessed_ms: u64,
}
