//! Persistent media-library models, storage, and filesystem scanning.

use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::Accessor;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

mod models;
mod scanner;
mod storage;

pub use models::{LibraryDb, LibraryView, MediaItem};
pub use scanner::{build_library_view, process_media_file};
pub use storage::{load_db, save_db};
