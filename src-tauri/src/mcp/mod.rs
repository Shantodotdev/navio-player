//! Navio's local Model Context Protocol server and public agent tool surface.
//!
//! The packaged desktop executable enters this module when invoked with
//! `--mcp`. `rmcp` owns the newline-delimited JSON-RPC STDIO transport, while
//! this module exposes a deliberately narrow set of typed tools for inspecting
//! and controlling the single running Navio desktop instance.
//!
//! Tool handlers do not access Tauri state or media files directly. Parameters
//! are validated in [`params`], converted to internal control commands, and
//! forwarded by [`client::NavioControlClient`] over Navio's authenticated
//! loopback bridge. This separation keeps the renderer authoritative for player
//! state and keeps Rust authoritative for process, token, URL, and path safety.

mod client;
mod params;

use crate::control::{ControlCommand, ControlReply};
use client::NavioControlClient;
use params::{
  DownloadAndPlayParams, GetDownloadsParams, PlayMediaParams, PlaybackControlParams,
  QueueEditParams, SearchLibraryParams, SetPlayerViewParams, SetVolumeParams,
};
use rmcp::{
  handler::server::{router::tool::ToolRouter, wrapper::Parameters},
  tool, tool_handler, tool_router, ServerHandler, ServiceExt,
};

/// Local STDIO MCP server exposing Navio's focused playback control surface.
#[derive(Clone, Debug)]
struct NavioMcp {
  tool_router: ToolRouter<Self>,
  client: NavioControlClient,
}

impl NavioMcp {
  /// Builds one STDIO service instance with the complete Navio tool router.
  ///
  /// Each MCP host receives its own lightweight server process, but the client
  /// inside that process discovers and controls the same desktop application.
  fn new() -> Result<Self, String> {
    Ok(Self {
      tool_router: Self::tool_router(),
      client: NavioControlClient::new()?,
    })
  }

  /// Executes a validated internal command and encodes its stable response envelope.
  ///
  /// Parameter errors, desktop transport failures, and renderer failures all
  /// become the same JSON-shaped [`ControlReply`]. This prevents protocol-facing
  /// tools from leaking internal Rust errors or returning incompatible shapes.
  async fn call(&self, command: Result<ControlCommand, String>) -> String {
    let reply = match command {
      Ok(command) => self
        .client
        .send(command)
        .await
        .unwrap_or_else(ControlReply::error),
      Err(message) => ControlReply::error(message),
    };
    serde_json::to_string(&reply).unwrap_or_else(|_| {
      r#"{"success":false,"message":"Navio could not encode the response.","data":null}"#
        .to_string()
    })
  }
}

#[tool_router]
impl NavioMcp {
  /// Returns a sanitized snapshot of the renderer-owned playback and view state.
  ///
  /// Filesystem paths, stream URLs, and private control credentials are removed
  /// by the renderer dispatcher before the snapshot reaches the MCP client.
  #[tool(
    description = "Get Navio's current playback state.",
    annotations(
      read_only_hint = true,
      destructive_hint = false,
      idempotent_hint = true,
      open_world_hint = false
    )
  )]
  async fn get_playback_state(&self) -> String {
    self.call(Ok(ControlCommand::GetPlaybackState)).await
  }

  /// Searches only media already present in the user's indexed Navio library.
  ///
  /// The bounded query is forwarded to the renderer; this handler never invokes
  /// a web search or converts a missing result into a downloader request.
  #[tool(
    description = "Search Navio's local library only. Never performs an internet search.",
    annotations(
      read_only_hint = true,
      destructive_hint = false,
      idempotent_hint = true,
      open_world_hint = false
    )
  )]
  async fn search_library(&self, Parameters(params): Parameters<SearchLibraryParams>) -> String {
    self.call(params.into_command()).await
  }

  /// Starts one local library item selected by stable ID or exact local name.
  ///
  /// Loose user wording should first go through `search_library`. A selection
  /// miss remains the product-level `No music found.` response.
  #[tool(
    description = "Play a local Navio library item by track ID or exact name.",
    annotations(
      read_only_hint = false,
      destructive_hint = false,
      idempotent_hint = false,
      open_world_hint = false
    )
  )]
  async fn play_media(&self, Parameters(params): Parameters<PlayMediaParams>) -> String {
    self.call(params.into_command()).await
  }

  /// Applies a validated transport or seek action to Navio's active media element.
  ///
  /// Seek actions require a finite seconds value; other actions deliberately
  /// discard an irrelevant `seconds` field during parameter conversion.
  #[tool(
    description = "Play, pause, stop, skip, or seek Navio's active media.",
    annotations(
      read_only_hint = false,
      destructive_hint = false,
      idempotent_hint = false,
      open_world_hint = false
    )
  )]
  async fn control_playback(
    &self,
    Parameters(params): Parameters<PlaybackControlParams>,
  ) -> String {
    self.call(params.into_command()).await
  }

  /// Sets the desktop player's shared volume using an integer percentage.
  ///
  /// The generated MCP schema constrains values to 0 through 100, and the
  /// renderer repeats the validation before mutating the Zustand player store.
  #[tool(
    description = "Set Navio's volume from 0 through 100 percent.",
    annotations(
      read_only_hint = false,
      destructive_hint = false,
      idempotent_hint = true,
      open_world_hint = false
    )
  )]
  async fn set_volume(&self, Parameters(params): Parameters<SetVolumeParams>) -> String {
    self
      .call(Ok(ControlCommand::SetVolume {
        volume: params.volume,
      }))
      .await
  }

  /// Returns the ordered active queue and current index without local paths.
  ///
  /// Queue entries contain only agent-safe media metadata such as stable IDs,
  /// titles, durations, sizes, and media categories.
  #[tool(
    description = "Get Navio's current playback queue.",
    annotations(
      read_only_hint = true,
      destructive_hint = false,
      idempotent_hint = true,
      open_world_hint = false
    )
  )]
  async fn get_queue(&self) -> String {
    self.call(Ok(ControlCommand::GetQueue)).await
  }

  /// Adds, removes, clears, or starts an item in the shared playback queue.
  ///
  /// Add operations accept only a local track ID; remove and play operations
  /// use a validated zero-based index into the renderer's current queue.
  #[tool(
    description = "Edit Navio's playback queue using local track IDs and zero-based indexes.",
    annotations(
      read_only_hint = false,
      destructive_hint = false,
      idempotent_hint = false,
      open_world_hint = false
    )
  )]
  async fn edit_queue(&self, Parameters(params): Parameters<QueueEditParams>) -> String {
    self.call(params.into_command()).await
  }

  /// Selects the hidden, Now Playing drawer, or video-theater presentation.
  ///
  /// The renderer rejects theater mode unless the current local or downloaded
  /// media item is a video, keeping view state consistent with the UI.
  #[tool(
    description = "Set Navio's player view to hidden, drawer, or theater.",
    annotations(
      read_only_hint = false,
      destructive_hint = false,
      idempotent_hint = true,
      open_world_hint = false
    )
  )]
  async fn set_player_view(&self, Parameters(params): Parameters<SetPlayerViewParams>) -> String {
    self
      .call(Ok(ControlCommand::SetPlayerView { view: params.view }))
      .await
  }

  /// Queues one explicit public URL and registers it for playback after completion.
  ///
  /// This is the only open-world tool. It accepts a URL supplied by the user,
  /// reuses Navio's durable downloader, and returns a job ID instead of waiting
  /// for the potentially long-running transfer to finish.
  #[tool(
    description = "Download and then play an explicit public media URL supplied by the user.",
    annotations(
      read_only_hint = false,
      destructive_hint = false,
      idempotent_hint = false,
      open_world_hint = true
    )
  )]
  async fn download_and_play_url(
    &self,
    Parameters(params): Parameters<DownloadAndPlayParams>,
  ) -> String {
    self.call(params.into_command()).await
  }

  /// Returns sanitized durable download records, optionally for one job ID.
  ///
  /// Completed output paths and detailed internal errors are intentionally
  /// reduced to safe counts and flags before records cross the MCP boundary.
  #[tool(
    description = "Get Navio download jobs, optionally filtered by job ID.",
    annotations(
      read_only_hint = true,
      destructive_hint = false,
      idempotent_hint = true,
      open_world_hint = false
    )
  )]
  async fn get_downloads(&self, Parameters(params): Parameters<GetDownloadsParams>) -> String {
    let job_id = params.job_id.and_then(|job_id| {
      let trimmed = job_id.trim().to_string();
      (!trimmed.is_empty()).then_some(trimmed)
    });
    self.call(Ok(ControlCommand::GetDownloads { job_id })).await
  }
}

#[tool_handler(
  router = self.tool_router,
  name = "navio-player",
  version = "0.1.0",
  instructions = "Navio controls the user's local media player. For a loose title, call search_library, then play_media with a returned track ID. If nothing matches, report exactly: No music found. Never search the internet or invent a URL. download_and_play_url may be called only with an explicit URL supplied by the user; it downloads before playback."
)]
impl ServerHandler for NavioMcp {}

/// Runs Navio's MCP service over process stdin/stdout until the host disconnects.
///
/// Stdout is reserved for JSON-RPC frames so Codex, Cursor, and other MCP hosts
/// can parse every line. Startup and transport failures are returned to the
/// executable entry point, which reports them through stderr.
pub async fn serve_stdio() -> Result<(), String> {
  let service = NavioMcp::new()?
    .serve(rmcp::transport::stdio())
    .await
    .map_err(|error| format!("Could not start Navio MCP: {error}"))?;
  service
    .waiting()
    .await
    .map_err(|error| format!("Navio MCP transport stopped unexpectedly: {error}"))?;
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  use rmcp::ServerHandler;
  use serde_json::Value;
  use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

  #[test]
  /// Verifies the server exposes exactly Navio's documented focused tool surface.
  fn exposes_the_complete_focused_navio_tool_set() {
    let server = NavioMcp::new().expect("create MCP server");
    let mut names = server
      .tool_router
      .list_all()
      .into_iter()
      .map(|tool| tool.name.to_string())
      .collect::<Vec<_>>();
    names.sort();

    assert_eq!(
      names,
      vec![
        "control_playback",
        "download_and_play_url",
        "edit_queue",
        "get_downloads",
        "get_playback_state",
        "get_queue",
        "play_media",
        "search_library",
        "set_player_view",
        "set_volume",
      ]
    );
  }

  #[test]
  /// Verifies server guidance preserves local-only lookup and explicit URL rules.
  fn server_instructions_forbid_implicit_online_search() {
    let instructions = NavioMcp::new()
      .expect("create MCP server")
      .get_info()
      .instructions
      .expect("server instructions");

    assert!(instructions.contains("Never search the internet"));
    assert!(instructions.contains("explicit URL"));
    assert!(instructions.contains("No music found."));
  }

  #[tokio::test]
  /// Verifies a real JSON-RPC STDIO handshake initializes and lists every tool.
  async fn json_rpc_transport_initializes_and_lists_all_tools() {
    let (server_transport, client_transport) = tokio::io::duplex(64 * 1024);
    let server_task = tokio::spawn(async move {
      let service = NavioMcp::new()
        .expect("create MCP server")
        .serve(server_transport)
        .await
        .expect("initialize MCP transport");
      service.waiting().await.expect("wait for client close");
    });
    let (reader, mut writer) = tokio::io::split(client_transport);
    let mut reader = BufReader::new(reader);

    writer
      .write_all(
        br#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"navio-test","version":"1.0"}}}
"#,
      )
      .await
      .expect("send initialize request");
    let mut line = String::new();
    reader
      .read_line(&mut line)
      .await
      .expect("read initialize response");
    let initialize: Value = serde_json::from_str(line.trim()).expect("valid initialize JSON");
    assert_eq!(initialize["id"], 1);
    assert_eq!(initialize["result"]["serverInfo"]["name"], "navio-player");

    writer
      .write_all(
        b"{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\"}\n",
      )
      .await
      .expect("send initialized notification and tool request");
    line.clear();
    reader
      .read_line(&mut line)
      .await
      .expect("read tools response");
    let tools: Value = serde_json::from_str(line.trim()).expect("valid tools JSON");
    assert_eq!(tools["id"], 2);
    assert_eq!(
      tools["result"]["tools"]
        .as_array()
        .expect("tools array")
        .len(),
      10
    );

    drop(writer);
    drop(reader);
    tokio::time::timeout(std::time::Duration::from_secs(1), server_task)
      .await
      .expect("server exits after transport closes")
      .expect("server task joins");
  }
}
