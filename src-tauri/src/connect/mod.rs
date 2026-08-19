//! Navio Connect: Local P2P discovery, WebSocket control hub, and multi-device streaming.

pub mod client;
pub mod commands;
pub mod discovery;
pub mod http;
pub mod hub;
pub mod models;
pub mod storage;

pub use client::ConnectClientManager;
pub use hub::ConnectHub;
pub use models::*;
