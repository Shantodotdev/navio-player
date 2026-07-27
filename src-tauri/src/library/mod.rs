//! Persistent media-library models, storage, and filesystem scanning.

use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::Accessor;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

mod index;
mod models;
mod path_policy;
mod scan;
mod scanner;
mod storage;

pub use index::{IndexedMedia, LibraryIndex};
pub use models::{LibraryDb, LibraryView, MediaItem};
pub use path_policy::{
  display_path, is_excluded_descendant, normalize_existing_directory, path_key,
  DEFAULT_EXCLUDED_DIRECTORY_NAMES,
};
pub use scan::{
  discover_supported_files, finish_scan, modified_ns, run_scan_roots, should_reuse_cached,
  LibraryScanPhase, LibraryScanProgress, ScanCoordinator,
};
pub use scanner::{is_supported_media_path, process_media_file, stable_media_id};
pub use storage::{load_db, save_db};
