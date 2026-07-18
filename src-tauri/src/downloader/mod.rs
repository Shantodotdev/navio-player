//! Remote download setup, verification, persistence, and process orchestration.
//!
//! The downloader is split by trust boundary rather than by UI screen:
//! `models` defines durable data, `manager` owns local state and process
//! controls, `command` supervises yt-dlp attempts, `tools` installs verified
//! external binaries, `verification` validates those binaries, and `events`
//! publishes committed state. This arrangement keeps filesystem deletion and
//! process control in Rust while the frontend interacts only through typed Tauri
//! commands and complete persisted-job events.

use crate::{library, AppState};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

const YTDLP_VERSION: &str = "2026.07.04";
const YTDLP_OUTPUT_ENCODING_ARGS: [&str; 2] = ["--encoding", "utf-8"];
const MIN_NODE_JS_RUNTIME_MAJOR: u32 = 22;
const MAX_YTDLP_BYTES: u64 = 128 * 1024 * 1024;
const MAX_FFMPEG_ZIP_BYTES: u64 = 128 * 1024 * 1024;

#[cfg(windows)]
const YTDLP_SHA256: &str = "52fe3c26dcf71fbdc85b528589020bb0b8e383155cfa81b64dd447bbe35e24b8";
#[cfg(not(windows))]
const YTDLP_SHA256: &str = "495be29ff4d9d4e9be7eabdfef225221e5d5282e77f2f505abc6dca80349f3fd";
#[cfg(target_os = "windows")]
const FFMPEG_ZIP_SHA256: &str = "d1124593b7453fc54dd90ca3819dc82c22ffa957937f33dd650082f1a495b10e";
#[cfg(target_os = "macos")]
const FFMPEG_ZIP_SHA256: &str = "e08c670fcbdc2e627aa4c0d0c5ee1ef20e82378af2f14e4e7ae421a148bd49af";
#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
const FFMPEG_ZIP_SHA256: &str = "4348301b0d5e18174925e2022da1823aebbdb07282bbe9adb64b2485e1ef2df7";

pub(crate) mod command;
mod events;
pub(crate) mod inspection;
mod manager;
mod models;
mod tools;
mod verification;

use events::*;
use tools::*;
use verification::*;

pub use manager::{DownloadControl, DownloadManager, StopAction};
pub use models::{
  AudioFormat, DownloadFormat, DownloadJob, DownloadQuality, DownloadRequest, DownloadStatus,
  SubtitleMode, VideoContainer,
};
pub use tools::ensure_ffmpeg_installed;
