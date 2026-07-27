use super::MediaItem;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::Manager;

#[derive(Clone, Debug)]
pub struct IndexedMedia {
  pub path_key: String,
  pub root_key: String,
  pub modified_ns: i64,
  pub item: MediaItem,
}

pub struct LibraryIndex {
  connection: Connection,
}

impl LibraryIndex {
  /// Opens the rebuildable index and initializes its transactional schema.
  pub fn open(path: &Path) -> Result<Self, String> {
    if let Some(parent) = path.parent() {
      std::fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create library index directory: {error}"))?;
    }
    let connection =
      Connection::open(path).map_err(|error| format!("Could not open library index: {error}"))?;
    connection
      .busy_timeout(Duration::from_secs(10))
      .map_err(|error| format!("Could not configure library index locking: {error}"))?;
    connection
      .execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         CREATE TABLE IF NOT EXISTS media (
           path_key TEXT PRIMARY KEY,
           id TEXT NOT NULL,
           path TEXT NOT NULL,
           name TEXT NOT NULL,
           title TEXT,
           duration_secs REAL NOT NULL,
           file_size_bytes INTEGER NOT NULL,
           media_type TEXT NOT NULL,
           cover_cache_path TEXT,
           modified_ns INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS media_roots (
           path_key TEXT NOT NULL,
           root_key TEXT NOT NULL,
           PRIMARY KEY (path_key, root_key),
           FOREIGN KEY (path_key) REFERENCES media(path_key) ON DELETE CASCADE
         );
         CREATE INDEX IF NOT EXISTS media_roots_root_key
           ON media_roots(root_key);",
      )
      .map_err(|error| format!("Could not initialize library index: {error}"))?;
    Ok(Self { connection })
  }

  /// Opens Navio's index inside its local application-data directory.
  pub fn open_for_app(app_handle: &tauri::AppHandle) -> Result<Self, String> {
    Self::open(&index_path(app_handle)?)
  }

  /// Returns every cached media item without touching the filesystem.
  pub fn load_all(&self) -> Result<Vec<MediaItem>, String> {
    let mut statement = self
      .connection
      .prepare(
        "SELECT id, path, name, title, duration_secs, file_size_bytes,
                media_type, cover_cache_path
         FROM media
         ORDER BY name COLLATE NOCASE, path COLLATE NOCASE",
      )
      .map_err(|error| format!("Could not query library index: {error}"))?;
    let rows = statement
      .query_map([], media_item_from_row)
      .map_err(|error| format!("Could not read library index: {error}"))?;
    rows
      .collect::<Result<Vec<_>, _>>()
      .map_err(|error| format!("Could not decode library index: {error}"))
  }

  /// Looks up cached metadata and its fingerprint by normalized path.
  pub fn lookup(&self, path_key: &str) -> Result<Option<IndexedMedia>, String> {
    self
      .connection
      .query_row(
        "SELECT m.path_key, COALESCE(MIN(r.root_key), ''), m.modified_ns,
                m.id, m.path, m.name, m.title, m.duration_secs,
                m.file_size_bytes, m.media_type, m.cover_cache_path
         FROM media m
         LEFT JOIN media_roots r ON r.path_key = m.path_key
         WHERE m.path_key = ?1
         GROUP BY m.path_key",
        [path_key],
        |row| {
          Ok(IndexedMedia {
            path_key: row.get(0)?,
            root_key: row.get(1)?,
            modified_ns: row.get(2)?,
            item: MediaItem {
              id: row.get(3)?,
              path: row.get(4)?,
              name: row.get(5)?,
              title: row.get(6)?,
              duration_secs: row.get(7)?,
              file_size_bytes: row.get(8)?,
              media_type: row.get(9)?,
              cover_cache_path: row.get(10)?,
            },
          })
        },
      )
      .optional()
      .map_err(|error| format!("Could not look up library media: {error}"))
  }

  /// Loads cached metadata and fingerprints for one scan without repeated SQL lookups.
  pub fn load_indexed(&self) -> Result<HashMap<String, IndexedMedia>, String> {
    let mut statement = self
      .connection
      .prepare(
        "SELECT m.path_key, COALESCE(MIN(r.root_key), ''), m.modified_ns,
                m.id, m.path, m.name, m.title, m.duration_secs,
                m.file_size_bytes, m.media_type, m.cover_cache_path
         FROM media m
         LEFT JOIN media_roots r ON r.path_key = m.path_key
         GROUP BY m.path_key",
      )
      .map_err(|error| format!("Could not query cached library metadata: {error}"))?;
    let rows = statement
      .query_map([], indexed_media_from_row)
      .map_err(|error| format!("Could not read cached library metadata: {error}"))?;
    let entries = rows
      .collect::<Result<Vec<_>, _>>()
      .map_err(|error| format!("Could not decode cached library metadata: {error}"))?;
    Ok(
      entries
        .into_iter()
        .map(|entry| (entry.path_key.clone(), entry))
        .collect(),
    )
  }

  /// Atomically publishes the complete indexed membership for one root.
  pub fn replace_root(&mut self, root_key: &str, entries: &[IndexedMedia]) -> Result<(), String> {
    let transaction = self
      .connection
      .transaction()
      .map_err(|error| format!("Could not start library index update: {error}"))?;
    transaction
      .execute("DELETE FROM media_roots WHERE root_key = ?1", [root_key])
      .map_err(|error| format!("Could not replace indexed root: {error}"))?;
    for entry in entries {
      upsert_media(&transaction, entry)?;
      transaction
        .execute(
          "INSERT OR IGNORE INTO media_roots(path_key, root_key) VALUES (?1, ?2)",
          params![entry.path_key, root_key],
        )
        .map_err(|error| format!("Could not link indexed media to its root: {error}"))?;
    }
    delete_orphans(&transaction)?;
    transaction
      .commit()
      .map_err(|error| format!("Could not publish library index update: {error}"))
  }

  /// Replaces only one subtree's memberships while preserving unrelated media.
  pub fn replace_subtree(
    &mut self,
    containing_root_keys: &[String],
    eligible_root_keys: &[String],
    prefix: &str,
    entries: &[IndexedMedia],
  ) -> Result<(), String> {
    let root_set = containing_root_keys
      .iter()
      .collect::<std::collections::HashSet<_>>();
    let prefix_with_separator = format!("{prefix}/");
    let stale_links = {
      let mut statement = self
        .connection
        .prepare("SELECT path_key, root_key FROM media_roots")
        .map_err(|error| format!("Could not query subtree memberships: {error}"))?;
      let rows = statement
        .query_map([], |row| {
          Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("Could not read subtree memberships: {error}"))?;
      rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not decode subtree memberships: {error}"))?
        .into_iter()
        .filter(|(path_key, root_key)| {
          root_set.contains(root_key)
            && (path_key == prefix || path_key.starts_with(&prefix_with_separator))
        })
        .collect::<Vec<_>>()
    };

    let transaction = self
      .connection
      .transaction()
      .map_err(|error| format!("Could not start subtree update: {error}"))?;
    for (path_key, root_key) in stale_links {
      transaction
        .execute(
          "DELETE FROM media_roots WHERE path_key = ?1 AND root_key = ?2",
          params![path_key, root_key],
        )
        .map_err(|error| format!("Could not clear stale subtree membership: {error}"))?;
    }
    for entry in entries {
      upsert_media(&transaction, entry)?;
      for root_key in eligible_root_keys {
        transaction
          .execute(
            "INSERT OR IGNORE INTO media_roots(path_key, root_key) VALUES (?1, ?2)",
            params![entry.path_key, root_key],
          )
          .map_err(|error| format!("Could not link refreshed subtree media: {error}"))?;
      }
    }
    delete_orphans(&transaction)?;
    transaction
      .commit()
      .map_err(|error| format!("Could not publish subtree update: {error}"))
  }

  /// Adds or updates one path and assigns it to all containing roots.
  pub fn upsert_for_roots(
    &mut self,
    entry: &IndexedMedia,
    root_keys: &[String],
  ) -> Result<(), String> {
    let transaction = self
      .connection
      .transaction()
      .map_err(|error| format!("Could not start media index update: {error}"))?;
    upsert_media(&transaction, entry)?;
    transaction
      .execute(
        "DELETE FROM media_roots WHERE path_key = ?1",
        [&entry.path_key],
      )
      .map_err(|error| format!("Could not refresh media roots: {error}"))?;
    for root_key in root_keys {
      transaction
        .execute(
          "INSERT OR IGNORE INTO media_roots(path_key, root_key) VALUES (?1, ?2)",
          params![entry.path_key, root_key],
        )
        .map_err(|error| format!("Could not link updated media: {error}"))?;
    }
    transaction
      .commit()
      .map_err(|error| format!("Could not publish media index update: {error}"))
  }

  /// Removes one configured root and media no longer referenced by another root.
  pub fn remove_root(&mut self, root_key: &str) -> Result<(), String> {
    let transaction = self
      .connection
      .transaction()
      .map_err(|error| format!("Could not start root removal: {error}"))?;
    transaction
      .execute("DELETE FROM media_roots WHERE root_key = ?1", [root_key])
      .map_err(|error| format!("Could not remove indexed root: {error}"))?;
    delete_orphans(&transaction)?;
    transaction
      .commit()
      .map_err(|error| format!("Could not publish indexed root removal: {error}"))
  }

  /// Removes one missing file from every configured root.
  pub fn remove_path(&mut self, path_key: &str) -> Result<(), String> {
    self
      .connection
      .execute("DELETE FROM media WHERE path_key = ?1", [path_key])
      .map(|_| ())
      .map_err(|error| format!("Could not remove stale indexed media: {error}"))
  }

  /// Removes every indexed file inside a missing or excluded subtree.
  pub fn remove_prefix(&mut self, prefix: &str) -> Result<(), String> {
    let keys = self
      .all_path_keys()?
      .into_iter()
      .filter(|key| key == prefix || key.starts_with(&format!("{prefix}/")))
      .collect::<Vec<_>>();
    let transaction = self
      .connection
      .transaction()
      .map_err(|error| format!("Could not start subtree removal: {error}"))?;
    for key in keys {
      transaction
        .execute("DELETE FROM media WHERE path_key = ?1", [key])
        .map_err(|error| format!("Could not remove indexed subtree: {error}"))?;
    }
    transaction
      .commit()
      .map_err(|error| format!("Could not publish indexed subtree removal: {error}"))
  }

  fn all_path_keys(&self) -> Result<Vec<String>, String> {
    let mut statement = self
      .connection
      .prepare("SELECT path_key FROM media")
      .map_err(|error| format!("Could not query indexed paths: {error}"))?;
    let rows = statement
      .query_map([], |row| row.get(0))
      .map_err(|error| format!("Could not read indexed paths: {error}"))?;
    rows
      .collect::<Result<Vec<_>, _>>()
      .map_err(|error| format!("Could not decode indexed paths: {error}"))
  }
}

/// Resolves the rebuildable SQLite index path.
pub fn index_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
  let app_data = app_handle
    .path()
    .app_data_dir()
    .map_err(|error| format!("Could not resolve library index directory: {error}"))?;
  Ok(app_data.join("library-index.sqlite3"))
}

fn upsert_media(transaction: &Transaction<'_>, entry: &IndexedMedia) -> Result<(), String> {
  transaction
    .execute(
      "INSERT INTO media(
         path_key, id, path, name, title, duration_secs, file_size_bytes,
         media_type, cover_cache_path, modified_ns
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT(path_key) DO UPDATE SET
         id = excluded.id,
         path = excluded.path,
         name = excluded.name,
         title = excluded.title,
         duration_secs = excluded.duration_secs,
         file_size_bytes = excluded.file_size_bytes,
         media_type = excluded.media_type,
         cover_cache_path = excluded.cover_cache_path,
         modified_ns = excluded.modified_ns",
      params![
        entry.path_key,
        entry.item.id,
        entry.item.path,
        entry.item.name,
        entry.item.title,
        entry.item.duration_secs,
        entry.item.file_size_bytes,
        entry.item.media_type,
        entry.item.cover_cache_path,
        entry.modified_ns,
      ],
    )
    .map(|_| ())
    .map_err(|error| format!("Could not upsert indexed media: {error}"))
}

fn delete_orphans(transaction: &Transaction<'_>) -> Result<(), String> {
  transaction
    .execute(
      "DELETE FROM media
       WHERE NOT EXISTS (
         SELECT 1 FROM media_roots WHERE media_roots.path_key = media.path_key
       )",
      [],
    )
    .map(|_| ())
    .map_err(|error| format!("Could not remove orphaned indexed media: {error}"))
}

fn media_item_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MediaItem> {
  Ok(MediaItem {
    id: row.get(0)?,
    path: row.get(1)?,
    name: row.get(2)?,
    title: row.get(3)?,
    duration_secs: row.get(4)?,
    file_size_bytes: row.get(5)?,
    media_type: row.get(6)?,
    cover_cache_path: row.get(7)?,
  })
}

fn indexed_media_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<IndexedMedia> {
  Ok(IndexedMedia {
    path_key: row.get(0)?,
    root_key: row.get(1)?,
    modified_ns: row.get(2)?,
    item: MediaItem {
      id: row.get(3)?,
      path: row.get(4)?,
      name: row.get(5)?,
      title: row.get(6)?,
      duration_secs: row.get(7)?,
      file_size_bytes: row.get(8)?,
      media_type: row.get(9)?,
      cover_cache_path: row.get(10)?,
    },
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  /// Creates a unique SQLite path for one isolated index test.
  fn test_index_path(name: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!(
      "navio-index-{name}-{}.sqlite3",
      uuid::Uuid::new_v4()
    ))
  }

  /// Creates one compact indexed video record.
  fn indexed_media(id: &str, path: &str, root_key: &str) -> IndexedMedia {
    IndexedMedia {
      path_key: crate::library::path_key(std::path::Path::new(path)),
      root_key: root_key.to_string(),
      modified_ns: 42,
      item: MediaItem {
        id: id.to_string(),
        path: path.to_string(),
        name: format!("{id}.mp4"),
        title: None,
        duration_secs: 120.0,
        file_size_bytes: 1024,
        media_type: "video".to_string(),
        cover_cache_path: None,
      },
    }
  }

  #[test]
  fn index_round_trips_media_metadata() {
    let path = test_index_path("roundtrip");
    let mut index = LibraryIndex::open(&path).expect("open index");
    let record = indexed_media("movie", r"F:\Movies\movie.mp4", "f:/movies");

    index
      .replace_root("f:/movies", std::slice::from_ref(&record))
      .expect("replace root");

    let tracks = index.load_all().expect("load tracks");
    assert_eq!(tracks.len(), 1);
    assert_eq!(tracks[0].id, "movie");
    assert_eq!(tracks[0].duration_secs, 120.0);
    drop(index);
    std::fs::remove_file(path).expect("remove index");
  }

  #[test]
  fn removing_one_overlapping_root_keeps_shared_media() {
    let path = test_index_path("roots");
    let mut index = LibraryIndex::open(&path).expect("open index");
    let parent = indexed_media("movie", r"F:\Media\Movies\movie.mp4", "f:/media");
    let child = indexed_media("movie", r"F:\Media\Movies\movie.mp4", "f:/media/movies");

    index
      .replace_root("f:/media", std::slice::from_ref(&parent))
      .expect("index parent root");
    index
      .replace_root("f:/media/movies", std::slice::from_ref(&child))
      .expect("index child root");
    index.remove_root("f:/media").expect("remove parent root");

    assert_eq!(index.load_all().expect("load shared media").len(), 1);
    index
      .remove_root("f:/media/movies")
      .expect("remove child root");
    assert!(index.load_all().expect("load empty index").is_empty());
    drop(index);
    std::fs::remove_file(path).expect("remove index");
  }

  #[test]
  fn lookup_returns_file_fingerprint_for_metadata_reuse() {
    let path = test_index_path("lookup");
    let mut index = LibraryIndex::open(&path).expect("open index");
    let record = indexed_media("movie", r"F:\Movies\movie.mp4", "f:/movies");
    index
      .replace_root("f:/movies", std::slice::from_ref(&record))
      .expect("replace root");

    let cached = index
      .lookup(&record.path_key)
      .expect("lookup index")
      .expect("cached media");
    assert_eq!(cached.modified_ns, 42);
    assert_eq!(cached.item.file_size_bytes, 1024);
    drop(index);
    std::fs::remove_file(path).expect("remove index");
  }

  #[test]
  fn replacing_a_subtree_preserves_unrelated_root_media() {
    let path = test_index_path("subtree");
    let mut index = LibraryIndex::open(&path).expect("open index");
    let outside = indexed_media("outside", r"F:\Media\outside.mp3", "f:/media");
    let old = indexed_media("old", r"F:\Media\Album\old.mp3", "f:/media");
    let next = indexed_media("next", r"F:\Media\Album\next.mp3", "f:/media");
    index
      .replace_root("f:/media", &[outside.clone(), old])
      .expect("seed root");

    index
      .replace_subtree(
        &["f:/media".to_string()],
        &["f:/media".to_string()],
        "f:/media/album",
        &[next],
      )
      .expect("replace subtree");

    let ids = index
      .load_all()
      .expect("load subtree result")
      .into_iter()
      .map(|item| item.id)
      .collect::<std::collections::HashSet<_>>();
    assert_eq!(
      ids,
      std::collections::HashSet::from(["outside".into(), "next".into()])
    );
    drop(index);
    std::fs::remove_file(path).expect("remove index");
  }
}
