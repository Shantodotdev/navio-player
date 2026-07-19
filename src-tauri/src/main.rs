// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Selects normal desktop mode or the packaged STDIO MCP service mode.
///
/// Only a first argument equal to `--mcp` changes startup behavior. MCP failures
/// are written to stderr because stdout must remain valid JSON-RPC transport.
fn main() {
  if std::env::args_os().nth(1).as_deref() == Some(std::ffi::OsStr::new("--mcp")) {
    if let Err(error) = app_lib::run_mcp() {
      eprintln!("{error}");
      std::process::exit(1);
    }
    return;
  }
  app_lib::run();
}
