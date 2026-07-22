mod models;
mod service;
mod storage;

pub use models::{ActivityEntry, ActivityMedia, PlaybackMilestone};
pub use service::ActivityStore;

#[cfg(test)]
mod tests {
  use super::{ActivityMedia, ActivityStore, PlaybackMilestone};
  use std::path::PathBuf;

  fn test_paths(name: &str) -> (PathBuf, PathBuf) {
    let root = std::env::temp_dir().join(format!("navio-activity-{name}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).expect("create activity test directory");
    (root.join("activity.json"), root.join("theater-media.json"))
  }

  fn media(id: &str) -> ActivityMedia {
    ActivityMedia {
      id: id.to_string(),
      path: format!(r"C:\Media\{id}.mp4"),
      duration_secs: 600.0,
      media_type: "video".to_string(),
    }
  }

  #[tokio::test]
  async fn first_catalog_is_known_without_becoming_recently_added() {
    let (activity_path, theater_path) = test_paths("initial");
    let store = ActivityStore::for_paths(activity_path, theater_path).expect("create store");

    let snapshot = store
      .reconcile_at(&[media("existing")], 1_000)
      .await
      .expect("reconcile existing catalog");

    assert_eq!(snapshot["existing"].added_at_ms, None);
    assert_eq!(snapshot["existing"].last_seen_at_ms, 1_000);
  }

  #[tokio::test]
  async fn later_discovery_receives_the_discovery_timestamp() {
    let (activity_path, theater_path) = test_paths("discovery");
    let store = ActivityStore::for_paths(activity_path, theater_path).expect("create store");
    store
      .reconcile_at(&[media("existing")], 1_000)
      .await
      .expect("initialize catalog");

    let snapshot = store
      .reconcile_at(&[media("existing"), media("new")], 2_000)
      .await
      .expect("reconcile changed catalog");

    assert_eq!(snapshot["existing"].added_at_ms, None);
    assert_eq!(snapshot["new"].added_at_ms, Some(2_000));
  }

  #[tokio::test]
  async fn playback_milestones_update_only_the_requested_fields() {
    let (activity_path, theater_path) = test_paths("milestones");
    let store = ActivityStore::for_paths(activity_path, theater_path).expect("create store");
    store
      .reconcile_at(&[media("movie")], 1_000)
      .await
      .expect("initialize catalog");

    let recent = store
      .record_milestone_at(
        "movie",
        r"C:\Media\movie.mp4",
        PlaybackMilestone::RecentlyPlayed,
        2_000,
      )
      .await
      .expect("record recent milestone");
    let counted = store
      .record_milestone_at(
        "movie",
        r"C:\Media\movie.mp4",
        PlaybackMilestone::PlayCount,
        3_000,
      )
      .await
      .expect("record count milestone");

    assert_eq!(recent.last_played_at_ms, Some(2_000));
    assert_eq!(recent.play_count, 0);
    assert_eq!(counted.last_played_at_ms, Some(2_000));
    assert_eq!(counted.play_count, 1);
  }

  #[tokio::test]
  async fn unavailable_records_are_pruned_after_ninety_days() {
    const NINETY_DAYS_MS: u64 = 90 * 24 * 60 * 60 * 1_000;
    let (activity_path, theater_path) = test_paths("pruning");
    let store = ActivityStore::for_paths(activity_path, theater_path).expect("create store");
    store
      .reconcile_at(&[media("stale"), media("current")], 1)
      .await
      .expect("initialize catalog");

    let snapshot = store
      .reconcile_at(&[media("current")], NINETY_DAYS_MS + 2)
      .await
      .expect("reconcile after retention window");

    assert!(!snapshot.contains_key("stale"));
    assert!(snapshot.contains_key("current"));
  }
}
