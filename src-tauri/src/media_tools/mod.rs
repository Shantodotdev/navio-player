//! Theater media inspection, preparation, and persistent caching.

use crate::downloader;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::{oneshot, watch};

const MAX_AUDIO_CACHE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_SUBTITLE_CACHE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_MEDIA_DATABASE_ENTRIES: usize = 2_000;
const MIN_RESUMABLE_VIDEO_DURATION_SECS: f64 = 10.0 * 60.0;
const STALE_PARTIAL_AGE_MS: u64 = 60 * 60 * 1_000;

mod assets;
mod cache;
mod models;
mod operations;
mod persistence;

use assets::*;
use models::*;
use persistence::*;

pub use models::{EmbeddedTrack, MediaCache, MediaTools, TheaterMediaInfo, VideoTrackInfo};
pub use operations::{
  extract_audio_track, extract_subtitle_track, inspect_video_tracks, save_theater_state,
  TheaterStateUpdate,
};
pub use persistence::ensure_media_tools;
