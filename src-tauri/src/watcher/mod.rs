//! Filesystem watcher startup and library synchronization.

use crate::library;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashSet;
use std::path::PathBuf;
use tauri::{Emitter, Manager};
use tokio::sync::mpsc;

mod runtime;
mod synchronization;

use synchronization::*;

pub use runtime::start_watcher;
