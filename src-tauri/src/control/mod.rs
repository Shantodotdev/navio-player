//! Private bridge between standalone MCP processes and the running Navio renderer.
//!
//! MCP clients communicate with Navio over STDIO, but playback state lives in
//! the desktop WebView. This module provides the typed commands, authenticated
//! loopback routes, runtime discovery descriptor, and bounded request broker
//! that carry a tool call into that renderer and correlate its response.
//!
//! The control token is generated independently from the media-stream token.
//! Callers receive neither token, and downloaded paths must still pass Navio's
//! existing media-directory authorization before the renderer can play them.

mod broker;
pub(crate) mod http;
mod models;
mod runtime;

pub use broker::ControlBroker;
pub use models::{
  ControlCommand, ControlReply, MediaType, PendingControlRequest, PlaybackAction, PlayerView,
  QueueAction,
};
pub use runtime::{
  acquire_launch_lock, read_runtime_descriptor, remove_runtime_descriptor,
  write_runtime_descriptor, RuntimeDescriptor,
};
