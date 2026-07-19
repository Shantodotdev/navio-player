use crate::control::{
  acquire_launch_lock, read_runtime_descriptor, ControlCommand, ControlReply, RuntimeDescriptor,
};
use std::{
  process::{Command, Stdio},
  time::{Duration, Instant},
};

const DESKTOP_LAUNCH_TIMEOUT: Duration = Duration::from_secs(15);
const DESCRIPTOR_POLL_INTERVAL: Duration = Duration::from_millis(150);

/// Authenticated loopback client used by the standalone STDIO MCP process.
#[derive(Clone, Debug)]
pub struct NavioControlClient {
  http: reqwest::Client,
}

impl NavioControlClient {
  /// Creates the bounded HTTP client used for private desktop control requests.
  ///
  /// Short connection and overall request timeouts ensure an unreachable or
  /// unresponsive desktop cannot indefinitely block an MCP tool call.
  pub fn new() -> Result<Self, String> {
    let http = reqwest::Client::builder()
      .connect_timeout(Duration::from_secs(2))
      .timeout(Duration::from_secs(30))
      .build()
      .map_err(|error| format!("Could not initialize Navio control: {error}"))?;
    Ok(Self { http })
  }

  /// Ensures a healthy desktop exists and sends one authenticated typed command.
  ///
  /// The current descriptor supplies only the dynamic loopback port and bearer
  /// token. Non-success HTTP statuses and malformed replies are converted into
  /// concise transport errors without returning descriptor contents.
  pub async fn send(&self, command: ControlCommand) -> Result<ControlReply, String> {
    let descriptor = self.ensure_desktop_running().await?;
    let response = self
      .http
      .post(format!(
        "http://127.0.0.1:{}/control/command",
        descriptor.port
      ))
      .bearer_auth(&descriptor.token)
      .json(&command)
      .send()
      .await
      .map_err(|_| "Navio did not accept the control request.".to_string())?;

    if !response.status().is_success() {
      return Err(format!(
        "Navio rejected the control request with status {}.",
        response.status().as_u16()
      ));
    }
    response
      .json::<ControlReply>()
      .await
      .map_err(|_| "Navio returned an invalid control response.".to_string())
  }

  /// Reuses a healthy desktop or coordinates launching this executable in app mode.
  ///
  /// A per-user lock elects one MCP process as launcher. Other simultaneous
  /// clients poll for the descriptor it publishes, preventing duplicate windows.
  async fn ensure_desktop_running(&self) -> Result<RuntimeDescriptor, String> {
    if let Some(descriptor) = self.healthy_descriptor().await {
      return Ok(descriptor);
    }

    let deadline = Instant::now() + DESKTOP_LAUNCH_TIMEOUT;
    loop {
      if let Some(launch_lock) = acquire_launch_lock()? {
        if let Some(descriptor) = self.healthy_descriptor().await {
          return Ok(descriptor);
        }
        Self::launch_desktop()?;

        while Instant::now() < deadline {
          if let Some(descriptor) = self.healthy_descriptor().await {
            drop(launch_lock);
            return Ok(descriptor);
          }
          tokio::time::sleep(DESCRIPTOR_POLL_INTERVAL).await;
        }
        drop(launch_lock);
        break;
      }

      if Instant::now() >= deadline {
        break;
      }
      tokio::time::sleep(DESCRIPTOR_POLL_INTERVAL).await;
      if let Some(descriptor) = self.healthy_descriptor().await {
        return Ok(descriptor);
      }
    }

    Err("Navio could not be launched in time.".to_string())
  }

  /// Returns the current descriptor only after its authenticated health probe succeeds.
  ///
  /// Merely finding `control.json` is not sufficient because it can outlive a
  /// crash; liveness and token validity are verified together over loopback HTTP.
  async fn healthy_descriptor(&self) -> Option<RuntimeDescriptor> {
    let descriptor = read_runtime_descriptor().ok()?;
    let response = self
      .http
      .get(format!(
        "http://127.0.0.1:{}/control/health",
        descriptor.port
      ))
      .bearer_auth(&descriptor.token)
      .send()
      .await
      .ok()?;
    response.status().is_success().then_some(descriptor)
  }

  /// Starts normal desktop mode without inheriting the MCP protocol streams.
  ///
  /// Standard handles are detached so desktop logs cannot corrupt the parent
  /// MCP process's STDIO JSON-RPC transport. Windows also suppresses a console
  /// window for the spawned GUI process.
  fn launch_desktop() -> Result<(), String> {
    let executable = std::env::current_exe()
      .map_err(|error| format!("Could not locate the Navio executable: {error}"))?;
    let mut command = Command::new(executable);
    command
      .stdin(Stdio::null())
      .stdout(Stdio::null())
      .stderr(Stdio::null());
    #[cfg(windows)]
    {
      use std::os::windows::process::CommandExt;
      const CREATE_NO_WINDOW: u32 = 0x08000000;
      command.creation_flags(CREATE_NO_WINDOW);
    }
    command
      .spawn()
      .map(|_| ())
      .map_err(|error| format!("Could not launch Navio: {error}"))
  }
}
