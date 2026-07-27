use super::*;
use std::sync::atomic::AtomicBool;
use tauri::Manager;

/// Applies changed filesystem paths to the persistent index before notifying React.
pub(super) fn process_changed_paths(
  app_handle: &tauri::AppHandle,
  paths: &HashSet<PathBuf>,
) -> Result<(), String> {
  println!(
    "[Navio Watcher] Incrementally updating library index | count={}",
    paths.len()
  );

  if paths.is_empty() {
    return Ok(());
  }

  let db = library::load_db(app_handle)?;
  let exclusions = crate::settings::load_db(app_handle)?
    .library
    .excluded_folder_names;
  let cache_dir = app_handle
    .path()
    .app_cache_dir()
    .map_err(|error| error.to_string())?;
  let mut index = library::LibraryIndex::open_for_app(app_handle)?;
  let mut ordered_paths = paths.iter().cloned().collect::<Vec<_>>();
  ordered_paths.sort_by_key(|path| library::path_key(path).len());
  let mut retained = Vec::<PathBuf>::new();
  for path in ordered_paths {
    let key = library::path_key(&path);
    if retained.iter().any(|ancestor| {
      let ancestor_key = library::path_key(ancestor);
      key == ancestor_key || key.starts_with(&format!("{ancestor_key}/"))
    }) {
      continue;
    }
    retained.push(path);
  }

  for path in retained {
    let containing = containing_root_keys(&db, &path);
    if containing.is_empty() {
      continue;
    }
    let key = library::path_key(&path);
    if !path.exists() {
      index.remove_prefix(&key)?;
      continue;
    }
    let eligible = eligible_root_keys(&db, &path, &exclusions);
    if eligible.is_empty() {
      index.replace_subtree(&containing, &[], &key, &[])?;
      continue;
    }
    if path.is_file() {
      sync_file(&mut index, &path, &eligible, &cache_dir)?;
      continue;
    }
    if path.is_dir() {
      let files =
        library::discover_supported_files(&path, &exclusions, &AtomicBool::new(false), |_| {})?;
      let entries = files
        .iter()
        .map(|file| indexed_file(&index, file, &eligible[0], &cache_dir))
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
      index.replace_subtree(&containing, &eligible, &key, &entries)?;
    }
  }

  app_handle
    .emit("library-updated", ())
    .map_err(|e| e.to_string())?;
  println!("[Navio Watcher] Incremental library update broadcasted.");

  Ok(())
}

/// Returns every configured root containing one changed path.
fn containing_root_keys(db: &library::LibraryDb, path: &std::path::Path) -> Vec<String> {
  let path_key = library::path_key(path);
  let mut roots = db
    .scanned_directories
    .iter()
    .map(PathBuf::from)
    .filter_map(|root| {
      let root_key = library::path_key(&root);
      (path_key == root_key || path_key.starts_with(&format!("{root_key}/"))).then_some(root_key)
    })
    .collect::<Vec<_>>();
  roots.sort();
  roots.dedup();
  roots
}

/// Filters containing roots whose relative path does not cross an exclusion.
fn eligible_root_keys(
  db: &library::LibraryDb,
  path: &std::path::Path,
  exclusions: &[String],
) -> Vec<String> {
  let containing = containing_root_keys(db, path);
  let mut eligible = db
    .scanned_directories
    .iter()
    .map(PathBuf::from)
    .filter(|root| containing.contains(&library::path_key(root)))
    .filter(|root| !library::is_excluded_descendant(root, path, exclusions))
    .map(|root| library::path_key(&root))
    .collect::<Vec<_>>();
  eligible.sort();
  eligible.dedup();
  eligible
}

/// Updates or removes one changed file according to Navio's media allowlist.
fn sync_file(
  index: &mut library::LibraryIndex,
  path: &std::path::Path,
  eligible_roots: &[String],
  cache_dir: &std::path::Path,
) -> Result<(), String> {
  let key = library::path_key(path);
  if !library::is_supported_media_path(path) {
    return index.remove_path(&key);
  }
  if let Some(entry) = indexed_file(index, path, &eligible_roots[0], cache_dir)? {
    index.upsert_for_roots(&entry, eligible_roots)?;
  }
  Ok(())
}

/// Reuses a matching fingerprint or probes one changed supported file.
fn indexed_file(
  index: &library::LibraryIndex,
  path: &std::path::Path,
  root_key: &str,
  cache_dir: &std::path::Path,
) -> Result<Option<library::IndexedMedia>, String> {
  let metadata = match std::fs::metadata(path) {
    Ok(metadata) => metadata,
    Err(_) => return Ok(None),
  };
  let key = library::path_key(path);
  let fingerprint = library::modified_ns(&metadata);
  if let Some(mut cached) = index.lookup(&key)? {
    if library::should_reuse_cached(
      cached.modified_ns,
      cached.item.file_size_bytes,
      fingerprint,
      metadata.len(),
    ) {
      cached.root_key = root_key.to_string();
      return Ok(Some(cached));
    }
  }
  Ok(
    library::process_media_file(path, cache_dir).map(|mut item| {
      item.path = library::display_path(path);
      library::IndexedMedia {
        path_key: key,
        root_key: root_key.to_string(),
        modified_ns: fingerprint,
        item,
      }
    }),
  )
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn explicit_nested_root_remains_eligible_inside_parent_exclusion() {
    let db = library::LibraryDb {
      scanned_directories: vec![
        "F:/Workspace".to_string(),
        "F:/Workspace/node_modules/media".to_string(),
      ],
    };
    let path = PathBuf::from("F:/Workspace/node_modules/media/movie.mp4");

    let eligible = eligible_root_keys(&db, &path, &["node_modules".to_string()]);

    assert_eq!(eligible, vec!["f:/workspace/node_modules/media"]);
  }
}
