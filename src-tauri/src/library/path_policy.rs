use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

pub const DEFAULT_EXCLUDED_DIRECTORY_NAMES: [&str; 14] = [
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "target",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
  "vendor",
];

/// Returns a display-safe absolute path without Windows' extended-length prefix.
pub fn display_path(path: &Path) -> String {
  let text = path.to_string_lossy();
  #[cfg(windows)]
  {
    if let Some(network_path) = text.strip_prefix(r"\\?\UNC\") {
      return format!(r"\\{network_path}");
    }
    if let Some(local_path) = text.strip_prefix(r"\\?\") {
      return local_path.to_string();
    }
  }
  text.to_string()
}

/// Produces a stable comparison key for configured roots and indexed files.
pub fn path_key(path: &Path) -> String {
  let normalized = display_path(path).replace('\\', "/");
  #[cfg(windows)]
  {
    normalized.to_lowercase()
  }
  #[cfg(not(windows))]
  {
    normalized
  }
}

/// Canonicalizes and validates one user-selected directory.
pub fn normalize_existing_directory(path: &Path) -> Result<PathBuf, String> {
  if !path.is_dir() {
    return Err("Selected folder does not exist.".to_string());
  }
  path
    .canonicalize()
    .map_err(|error| format!("Could not resolve selected folder: {error}"))
}

/// Normalizes configured paths and removes exact canonical duplicates.
pub fn normalize_configured_directories(paths: &[String]) -> Vec<String> {
  let mut seen = HashSet::new();
  let mut normalized = Vec::new();
  for configured in paths {
    let raw = PathBuf::from(configured);
    let resolved = raw.canonicalize().unwrap_or(raw);
    let key = path_key(&resolved);
    if seen.insert(key) {
      normalized.push(display_path(&resolved));
    }
  }
  normalized
}

/// Checks whether a descendant crosses a directory excluded by name.
pub fn is_excluded_descendant(root: &Path, path: &Path, excluded_names: &[String]) -> bool {
  let Ok(relative) = path.strip_prefix(root) else {
    return false;
  };
  relative.components().any(|component| {
    let Component::Normal(name) = component else {
      return false;
    };
    let name = name.to_string_lossy();
    excluded_names
      .iter()
      .any(|excluded| excluded.eq_ignore_ascii_case(&name))
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  /// Creates a unique directory tree for path-policy tests.
  fn test_directory(name: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("navio-path-{name}-{}", uuid::Uuid::new_v4()))
  }

  #[test]
  fn configured_directories_deduplicate_canonical_equivalents() {
    let root = test_directory("dedupe");
    std::fs::create_dir_all(&root).expect("create path fixture");
    let canonical = root.canonicalize().expect("canonicalize path fixture");

    let normalized = normalize_configured_directories(&[
      root.to_string_lossy().to_string(),
      canonical.to_string_lossy().to_string(),
    ]);

    assert_eq!(normalized.len(), 1);
    assert!(!normalized[0].starts_with(r"\\?\"));
    std::fs::remove_dir_all(root).expect("remove path fixture");
  }

  #[test]
  fn excluded_names_prune_descendants_but_not_the_selected_root() {
    let root = std::path::Path::new(r"C:\Workspace\node_modules");
    let nested = root.join("package").join("video.mp4");

    assert!(!is_excluded_descendant(
      root,
      root,
      &["node_modules".into()]
    ));
    assert!(is_excluded_descendant(root, &nested, &["package".into()]));
  }

  #[test]
  fn default_exclusions_cover_generated_development_trees() {
    for name in [".git", "node_modules", "target", "dist", ".venv"] {
      assert!(
        DEFAULT_EXCLUDED_DIRECTORY_NAMES
          .iter()
          .any(|excluded| excluded.eq_ignore_ascii_case(name)),
        "{name} should be excluded"
      );
    }
  }
}
