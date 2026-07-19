use serde::{Deserialize, Serialize};
use std::{
  fs::{self, File, OpenOptions},
  io::Write,
  path::{Path, PathBuf},
  time::Duration,
};

const CONTROL_PROTOCOL_VERSION: u8 = 1;
const STALE_LAUNCH_LOCK_AFTER: Duration = Duration::from_secs(20);

/// Per-user locator that lets stdio MCP processes find the running Navio app.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RuntimeDescriptor {
  /// Version of the private loopback control protocol.
  pub version: u8,
  /// Process ID that owns this descriptor.
  pub pid: u32,
  /// Dynamic loopback port shared by streaming and control routes.
  pub port: u16,
  /// Per-run bearer token accepted only by control routes.
  pub token: String,
  /// Executable path used only for diagnostics and launch consistency checks.
  pub executable: String,
}

impl RuntimeDescriptor {
  /// Captures the discovery details for the current Navio desktop process.
  ///
  /// The executable path is diagnostic metadata; clients authenticate using the
  /// random token and validate liveness through the advertised loopback port.
  pub fn new(port: u16, token: String) -> Self {
    Self {
      version: CONTROL_PROTOCOL_VERSION,
      pid: std::process::id(),
      port,
      token,
      executable: std::env::current_exe()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned(),
    }
  }
}

/// RAII ownership of the short-lived per-user desktop launch lock.
pub struct LaunchLock {
  path: PathBuf,
  _file: File,
}

impl Drop for LaunchLock {
  /// Releases cross-client launch ownership when the guard leaves scope.
  ///
  /// Best-effort cleanup is sufficient because stale locks are independently
  /// detected and removed after the configured age threshold.
  fn drop(&mut self) {
    let _ = fs::remove_file(&self.path);
  }
}

/// Returns the deterministic per-user path used to discover the desktop process.
///
/// All MCP server processes for the current OS user consult this same location.
pub fn runtime_descriptor_path() -> PathBuf {
  runtime_directory().join("control.json")
}

/// Selects a per-user runtime directory with local-data and temp fallbacks.
///
/// The final `navio-player` segment isolates the descriptor and launch lock from
/// unrelated applications that share the platform directory.
fn runtime_directory() -> PathBuf {
  dirs::runtime_dir()
    .or_else(dirs::data_local_dir)
    .unwrap_or_else(std::env::temp_dir)
    .join("navio-player")
}

/// Publishes the current desktop descriptor using an atomic-style replacement.
///
/// Callers provide only a validated descriptor; filesystem creation, flushing,
/// and replacement semantics are centralized in the path-specific helper.
pub fn write_runtime_descriptor(descriptor: &RuntimeDescriptor) -> Result<(), String> {
  write_runtime_descriptor_at(&runtime_descriptor_path(), descriptor)
}

/// Writes and synchronizes a descriptor at an explicit path before publishing it.
///
/// A process-specific temporary file prevents readers from observing partial
/// JSON. Unix permissions are owner-only; Windows replacement is handled by
/// removing a stale destination before the final rename.
fn write_runtime_descriptor_at(path: &Path, descriptor: &RuntimeDescriptor) -> Result<(), String> {
  let parent = path
    .parent()
    .ok_or_else(|| "Navio control descriptor has no parent directory.".to_string())?;
  fs::create_dir_all(parent)
    .map_err(|error| format!("Could not create Navio runtime directory: {error}"))?;
  let temp_path = parent.join(format!("control.{}.tmp", std::process::id()));
  let mut options = OpenOptions::new();
  options.create(true).truncate(true).write(true);
  #[cfg(unix)]
  {
    use std::os::unix::fs::OpenOptionsExt;
    options.mode(0o600);
  }
  let mut file = options
    .open(&temp_path)
    .map_err(|error| format!("Could not create Navio control descriptor: {error}"))?;
  serde_json::to_writer(&mut file, descriptor)
    .map_err(|error| format!("Could not encode Navio control descriptor: {error}"))?;
  file
    .flush()
    .map_err(|error| format!("Could not flush Navio control descriptor: {error}"))?;
  file
    .sync_all()
    .map_err(|error| format!("Could not sync Navio control descriptor: {error}"))?;
  drop(file);

  // Windows cannot atomically replace an existing destination with `rename`.
  if path.exists() {
    fs::remove_file(path)
      .map_err(|error| format!("Could not replace stale Navio descriptor: {error}"))?;
  }
  fs::rename(&temp_path, path)
    .map_err(|error| format!("Could not publish Navio control descriptor: {error}"))
}

/// Reads and validates the current per-user Navio control descriptor.
///
/// Parsing alone is insufficient: the protocol version, port, and token shape
/// must also be valid before an MCP process attempts authenticated loopback I/O.
pub fn read_runtime_descriptor() -> Result<RuntimeDescriptor, String> {
  read_runtime_descriptor_at(&runtime_descriptor_path())
}

/// Decodes and validates a descriptor from an explicit path.
///
/// Keeping this logic path-parameterized allows tests to exercise malformed and
/// incompatible descriptors without touching the real per-user runtime file.
fn read_runtime_descriptor_at(path: &Path) -> Result<RuntimeDescriptor, String> {
  let bytes =
    fs::read(path).map_err(|error| format!("Could not read Navio control descriptor: {error}"))?;
  let descriptor: RuntimeDescriptor = serde_json::from_slice(&bytes)
    .map_err(|_| "Navio control descriptor is malformed.".to_string())?;
  if descriptor.version != CONTROL_PROTOCOL_VERSION {
    return Err("Navio control descriptor uses an unsupported version.".to_string());
  }
  if descriptor.port == 0 || descriptor.token.len() < 16 {
    return Err("Navio control descriptor is incomplete.".to_string());
  }
  Ok(descriptor)
}

/// Removes the descriptor only when it still belongs to the exiting process.
///
/// The PID ownership check prevents an older shutdown callback from deleting a
/// descriptor already replaced by a newer Navio desktop instance.
pub fn remove_runtime_descriptor(owner_pid: u32) {
  let path = runtime_descriptor_path();
  if read_runtime_descriptor_at(&path)
    .map(|descriptor| descriptor.pid == owner_pid)
    .unwrap_or(false)
  {
    let _ = fs::remove_file(path);
  }
}

/// Tries to acquire the cross-client lock used while launching the desktop app.
///
/// `Ok(None)` means another MCP process currently owns launch coordination;
/// callers should poll for a healthy descriptor rather than open another window.
pub fn acquire_launch_lock() -> Result<Option<LaunchLock>, String> {
  acquire_launch_lock_at(
    &runtime_directory().join("launch.lock"),
    STALE_LAUNCH_LOCK_AFTER,
  )
}

/// Acquires a create-new lock file and recovers it when its age proves it stale.
///
/// The returned RAII guard owns both the open file and its path, ensuring normal
/// success and error paths release the lock consistently.
fn acquire_launch_lock_at(
  path: &Path,
  stale_after: Duration,
) -> Result<Option<LaunchLock>, String> {
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent)
      .map_err(|error| format!("Could not create Navio runtime directory: {error}"))?;
  }
  let open = || {
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
      use std::os::unix::fs::OpenOptionsExt;
      options.mode(0o600);
    }
    options.open(path)
  };

  match open() {
    Ok(mut file) => {
      let _ = writeln!(file, "{}", std::process::id());
      Ok(Some(LaunchLock {
        path: path.to_path_buf(),
        _file: file,
      }))
    }
    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
      let is_stale = fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .and_then(|modified| modified.elapsed().map_err(std::io::Error::other))
        .map(|age| age >= stale_after)
        .unwrap_or(false);
      if !is_stale {
        return Ok(None);
      }
      fs::remove_file(path).map_err(|remove_error| {
        format!("Could not clear stale Navio launch lock: {remove_error}")
      })?;
      open()
        .map(|file| {
          Some(LaunchLock {
            path: path.to_path_buf(),
            _file: file,
          })
        })
        .map_err(|open_error| format!("Could not acquire Navio launch lock: {open_error}"))
    }
    Err(error) => Err(format!("Could not acquire Navio launch lock: {error}")),
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::{fs, time::Duration};
  use uuid::Uuid;

  /// Creates a collision-resistant temporary directory for runtime-file tests.
  fn isolated_runtime_dir(name: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("navio-{name}-{}", Uuid::new_v4()))
  }

  #[test]
  /// Verifies readers never observe partial descriptor JSON during publication.
  fn writes_and_reads_a_versioned_descriptor_atomically() {
    let runtime_dir = isolated_runtime_dir("descriptor");
    let path = runtime_dir.join("control.json");
    let descriptor = RuntimeDescriptor::new(41234, "secret-token-long-enough".to_string());

    write_runtime_descriptor_at(&path, &descriptor).expect("write descriptor");
    assert_eq!(
      read_runtime_descriptor_at(&path).expect("read descriptor"),
      descriptor
    );
    assert!(runtime_dir
      .read_dir()
      .expect("runtime entries")
      .all(|entry| !entry
        .expect("entry")
        .file_name()
        .to_string_lossy()
        .contains("tmp")));

    fs::remove_dir_all(runtime_dir).expect("cleanup runtime dir");
  }

  #[test]
  /// Verifies malformed JSON and incompatible protocol versions fail validation.
  fn rejects_malformed_or_unsupported_descriptors() {
    let runtime_dir = isolated_runtime_dir("malformed");
    fs::create_dir_all(&runtime_dir).expect("create runtime dir");
    let path = runtime_dir.join("control.json");
    fs::write(&path, b"not-json").expect("write malformed descriptor");
    assert!(read_runtime_descriptor_at(&path).is_err());

    fs::write(
      &path,
      br#"{"version":99,"pid":1,"port":1,"token":"secret-token-long-enough","executable":"x"}"#,
    )
    .expect("write unsupported descriptor");
    assert_eq!(
      read_runtime_descriptor_at(&path).expect_err("unsupported version"),
      "Navio control descriptor uses an unsupported version."
    );

    fs::remove_dir_all(runtime_dir).expect("cleanup runtime dir");
  }

  #[test]
  /// Verifies launch ownership is exclusive and automatically released by the guard.
  fn launch_lock_is_exclusive_and_released_on_drop() {
    let runtime_dir = isolated_runtime_dir("lock");
    let path = runtime_dir.join("launch.lock");
    let first = acquire_launch_lock_at(&path, Duration::from_secs(30))
      .expect("acquire first lock")
      .expect("first owns lock");
    assert!(acquire_launch_lock_at(&path, Duration::from_secs(30))
      .expect("check second lock")
      .is_none());

    drop(first);
    assert!(acquire_launch_lock_at(&path, Duration::from_secs(30))
      .expect("reacquire lock")
      .is_some());
    fs::remove_dir_all(runtime_dir).expect("cleanup runtime dir");
  }
}
