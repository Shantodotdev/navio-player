//! Local authenticated HTTP media-streaming server.

use axum::{
  body::Body,
  extract::{Path, Query, State},
  http::{header, HeaderMap, StatusCode},
  response::Response,
  routing::get,
  Router,
};
use std::{
  collections::HashSet,
  path::{Path as StdPath, PathBuf},
  sync::{Arc, Mutex},
};
use tokio::fs::File;
use tokio::io::AsyncReadExt;
use tokio::sync::oneshot;
use tokio_util::io::ReaderStream;

mod ranges;
mod startup;
mod state;
mod streaming;

use ranges::*;
use state::*;
use streaming::*;

pub use startup::start_server;
pub use state::ServerState;
