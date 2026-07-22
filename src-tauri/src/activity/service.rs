use super::models::{
  ActivityDatabase, ActivityEntry, ActivityMedia, PlaybackMilestone, ACTIVITY_DATABASE_VERSION,
};
use super::storage::{load_database, load_theater_entries, normalize_path, save_database};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

const ABSENT_RETENTION_MS: u64 = 90 * 24 * 60 * 60 * 1_000;
const MAX_ACTIVITY_ENTRIES: usize = 10_000;

/// Serialized owner of Navio's durable local playback activity.
#[derive(Clone)]
pub struct ActivityStore {
  database_path: PathBuf,
  theater_path: PathBuf,
  database: Arc<tokio::sync::Mutex<ActivityDatabase>>,
}

impl ActivityStore {
  /// Loads the activity service from Navio's application data directory.
  pub fn load(app_handle: &AppHandle) -> Result<Self, String> {
    let app_data = app_handle
      .path()
      .app_data_dir()
      .map_err(|error| format!("Could not resolve activity data directory: {error}"))?;
    Self::for_paths(
      app_data.join("activity.json"),
      app_data.join("theater-media.json"),
    )
  }

  /// Creates a store for explicit paths, allowing isolated persistence tests.
  pub fn for_paths(database_path: PathBuf, theater_path: PathBuf) -> Result<Self, String> {
    let database = load_database(&database_path)?;
    Ok(Self {
      database_path,
      theater_path,
      database: Arc::new(tokio::sync::Mutex::new(database)),
    })
  }

  /// Reconciles current media at the system clock time.
  pub async fn reconcile(
    &self,
    media: &[ActivityMedia],
  ) -> Result<HashMap<String, ActivityEntry>, String> {
    self.reconcile_at(media, now_ms()).await
  }

  /// Reconciles current media with an explicit timestamp for deterministic tests.
  pub async fn reconcile_at(
    &self,
    media: &[ActivityMedia],
    now: u64,
  ) -> Result<HashMap<String, ActivityEntry>, String> {
    let mut database = self.database.lock().await;
    let is_initial_catalog = !database.initialized;
    let theater_entries = if is_initial_catalog {
      load_theater_entries(&self.theater_path)
    } else {
      HashMap::new()
    };

    for item in media {
      let is_new = !database.entries.contains_key(&item.id);
      let entry = database
        .entries
        .entry(item.id.clone())
        .or_insert_with(|| ActivityEntry {
          media_id: item.id.clone(),
          path: item.path.clone(),
          added_at_ms: (!is_initial_catalog).then_some(now),
          duration_secs: item.duration_secs.max(0.0),
          last_seen_at_ms: now,
          ..ActivityEntry::default()
        });

      entry.path = item.path.clone();
      entry.duration_secs = item.duration_secs.max(0.0);
      entry.last_seen_at_ms = now;

      if is_initial_catalog && is_new && item.media_type == "video" {
        if let Some(theater) = theater_entries.get(&normalize_path(&item.path)) {
          entry.resume_position_secs = theater.resume_position_secs.max(0.0);
          entry.progress_updated_at_ms = Some(theater.last_accessed_ms);
        }
      }
    }

    let current_ids = media
      .iter()
      .map(|item| item.id.as_str())
      .collect::<HashSet<_>>();
    database.entries.retain(|media_id, entry| {
      current_ids.contains(media_id.as_str())
        || now.saturating_sub(entry.last_seen_at_ms) <= ABSENT_RETENTION_MS
    });
    if database.entries.len() > MAX_ACTIVITY_ENTRIES {
      let mut absent = database
        .entries
        .iter()
        .filter(|(media_id, _)| !current_ids.contains(media_id.as_str()))
        .map(|(media_id, entry)| (media_id.clone(), entry.last_seen_at_ms))
        .collect::<Vec<_>>();
      absent.sort_unstable_by_key(|(_, last_seen)| *last_seen);
      let remove_count = database.entries.len() - MAX_ACTIVITY_ENTRIES;
      for (media_id, _) in absent.into_iter().take(remove_count) {
        database.entries.remove(&media_id);
      }
    }

    database.version = ACTIVITY_DATABASE_VERSION;
    database.initialized = true;
    save_database(&self.database_path, &database)?;
    Ok(database.entries.clone())
  }

  /// Records one threshold milestone for a playback session.
  pub async fn record_milestone(
    &self,
    media_id: &str,
    path: &str,
    milestone: PlaybackMilestone,
  ) -> Result<ActivityEntry, String> {
    self
      .record_milestone_at(media_id, path, milestone, now_ms())
      .await
  }

  /// Records a milestone at an explicit timestamp for deterministic tests.
  pub async fn record_milestone_at(
    &self,
    media_id: &str,
    path: &str,
    milestone: PlaybackMilestone,
    now: u64,
  ) -> Result<ActivityEntry, String> {
    let mut database = self.database.lock().await;
    let entry = database
      .entries
      .entry(media_id.to_string())
      .or_insert_with(|| ActivityEntry {
        media_id: media_id.to_string(),
        path: path.to_string(),
        last_seen_at_ms: now,
        ..ActivityEntry::default()
      });
    entry.path = path.to_string();
    entry.last_seen_at_ms = now;
    match milestone {
      PlaybackMilestone::RecentlyPlayed => entry.last_played_at_ms = Some(now),
      PlaybackMilestone::PlayCount => entry.play_count = entry.play_count.saturating_add(1),
    }
    let updated = entry.clone();
    save_database(&self.database_path, &database)?;
    Ok(updated)
  }

  /// Mirrors a validated video checkpoint into the activity database.
  pub async fn record_progress(
    &self,
    media_id: &str,
    path: &str,
    position_secs: f64,
    duration_secs: f64,
  ) -> Result<ActivityEntry, String> {
    let now = now_ms();
    let mut database = self.database.lock().await;
    let entry = database
      .entries
      .entry(media_id.to_string())
      .or_insert_with(|| ActivityEntry {
        media_id: media_id.to_string(),
        path: path.to_string(),
        last_seen_at_ms: now,
        ..ActivityEntry::default()
      });
    entry.path = path.to_string();
    entry.resume_position_secs = position_secs.max(0.0);
    entry.duration_secs = duration_secs.max(0.0);
    entry.progress_updated_at_ms = Some(now);
    entry.last_seen_at_ms = now;
    let updated = entry.clone();
    save_database(&self.database_path, &database)?;
    Ok(updated)
  }

  /// Clears both the in-memory activity state and its durable JSON file.
  pub async fn reset(&self) -> Result<(), String> {
    let mut database = self.database.lock().await;
    *database = ActivityDatabase::default();
    if self.database_path.exists() {
      std::fs::remove_file(&self.database_path)
        .map_err(|error| format!("Could not remove activity data: {error}"))?;
    }
    Ok(())
  }
}

fn now_ms() -> u64 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .unwrap_or_default()
    .as_millis()
    .min(u128::from(u64::MAX)) as u64
}
