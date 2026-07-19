use crate::control::{ControlCommand, MediaType, PlaybackAction, PlayerView, QueueAction};
use rmcp::schemars::JsonSchema;
use serde::Deserialize;

/// Parameters for a bounded local-only library search.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct SearchLibraryParams {
  pub query: String,
  pub media_type: Option<MediaType>,
  pub limit: Option<u8>,
}

impl SearchLibraryParams {
  /// Trims and bounds a local-library query before producing a renderer command.
  ///
  /// Empty or oversized text and out-of-range result limits are rejected at the
  /// MCP edge, before they occupy space in the desktop control queue.
  pub fn into_command(self) -> Result<ControlCommand, String> {
    let query = self.query.trim().to_string();
    if query.is_empty() || query.chars().count() > 200 {
      return Err("Library search query must contain 1 to 200 characters.".to_string());
    }
    if self.limit.is_some_and(|limit| !(1..=50).contains(&limit)) {
      return Err("Search result limit must be from 1 through 50.".to_string());
    }
    Ok(ControlCommand::SearchLibrary {
      query,
      media_type: self.media_type,
      limit: self.limit,
    })
  }
}

/// Parameters for selecting a local track by ID or exact name.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct PlayMediaParams {
  pub track_id: Option<String>,
  pub name: Option<String>,
}

impl PlayMediaParams {
  /// Requires a stable track ID or exact local name and produces a play command.
  ///
  /// Optional strings are trimmed and empty values removed. This conversion has
  /// no URL branch, preserving the separation between local playback and the
  /// explicit download tool.
  pub fn into_command(self) -> Result<ControlCommand, String> {
    let track_id = non_empty(self.track_id);
    let name = non_empty(self.name);
    if track_id.is_none() && name.is_none() {
      return Err("A local track ID or exact local name is required.".to_string());
    }
    Ok(ControlCommand::PlayMedia { track_id, name })
  }
}

/// Parameters for active playback transport controls.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct PlaybackControlParams {
  pub action: PlaybackAction,
  pub seconds: Option<f64>,
}

impl PlaybackControlParams {
  /// Validates seek operands and discards seconds for non-seek transport actions.
  ///
  /// Normalizing the conditional field here keeps the renderer command unambiguous
  /// even if an MCP host sends extra schema-compatible data.
  pub fn into_command(self) -> Result<ControlCommand, String> {
    let needs_seconds = matches!(self.action, PlaybackAction::SeekTo | PlaybackAction::SeekBy);
    if needs_seconds && !self.seconds.is_some_and(f64::is_finite) {
      return Err("A finite number of seconds is required for seeking.".to_string());
    }
    Ok(ControlCommand::ControlPlayback {
      action: self.action,
      seconds: if needs_seconds { self.seconds } else { None },
    })
  }
}

/// Parameters for changing Navio's integer volume percentage.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct SetVolumeParams {
  #[schemars(range(min = 0, max = 100))]
  pub volume: u8,
}

/// Parameters for one queue mutation.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct QueueEditParams {
  pub action: QueueAction,
  pub track_id: Option<String>,
  pub index: Option<usize>,
}

impl QueueEditParams {
  /// Enforces the selector required by each queue mutation before dispatch.
  ///
  /// Adding requires a local track ID, while removing or selecting an item
  /// requires a zero-based index. Clearing intentionally needs neither.
  pub fn into_command(self) -> Result<ControlCommand, String> {
    let track_id = non_empty(self.track_id);
    match self.action {
      QueueAction::Add if track_id.is_none() => {
        return Err("A local track ID is required when adding to the queue.".to_string());
      }
      QueueAction::Remove | QueueAction::PlayIndex if self.index.is_none() => {
        return Err("A queue index is required for this action.".to_string());
      }
      _ => {}
    }
    Ok(ControlCommand::EditQueue {
      action: self.action,
      track_id,
      index: self.index,
    })
  }
}

/// Parameters for selecting Navio's player presentation.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct SetPlayerViewParams {
  pub view: PlayerView,
}

/// Parameters for downloading and then playing one explicit public URL.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct DownloadAndPlayParams {
  pub url: String,
  pub media_type: MediaType,
}

impl DownloadAndPlayParams {
  /// Converts an explicit non-credentialed network URL into a download command.
  ///
  /// Plain names, local file URLs, unsupported schemes, and embedded credentials
  /// fail before the request reaches Navio's downloader inspection boundary.
  pub fn into_command(self) -> Result<ControlCommand, String> {
    let parsed = reqwest::Url::parse(self.url.trim())
      .map_err(|_| "An explicit public media URL is required.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https" | "ftp" | "ftps")
      || !parsed.username().is_empty()
      || parsed.password().is_some()
    {
      return Err("An explicit public media URL is required.".to_string());
    }
    Ok(ControlCommand::DownloadAndPlayUrl {
      url: parsed.to_string(),
      media_type: self.media_type,
    })
  }
}

/// Optional filter for durable download inspection.
#[derive(Debug, Default, Deserialize, JsonSchema)]
pub struct GetDownloadsParams {
  pub job_id: Option<String>,
}

/// Trims an optional MCP string and converts empty content to `None`.
///
/// Centralizing this normalization prevents whitespace-only selectors from being
/// interpreted differently by individual parameter converters.
fn non_empty(value: Option<String>) -> Option<String> {
  value.and_then(|value| {
    let trimmed = value.trim().to_string();
    (!trimmed.is_empty()).then_some(trimmed)
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  /// Verifies local search parameters are trimmed, bounded, and mapped correctly.
  fn search_parameters_map_to_a_bounded_local_library_command() {
    let command = SearchLibraryParams {
      query: "Midnight Drive".to_string(),
      media_type: Some(MediaType::Audio),
      limit: Some(5),
    }
    .into_command()
    .expect("valid search command");

    assert!(matches!(
      command,
      ControlCommand::SearchLibrary {
        query,
        media_type: Some(MediaType::Audio),
        limit: Some(5),
      } if query == "Midnight Drive"
    ));
    assert!(SearchLibraryParams {
      query: " ".to_string(),
      media_type: None,
      limit: None,
    }
    .into_command()
    .is_err());
  }

  #[test]
  /// Verifies conditional seek and queue operands are required only when relevant.
  fn playback_and_queue_parameters_require_their_conditional_values() {
    assert!(PlaybackControlParams {
      action: PlaybackAction::SeekTo,
      seconds: None,
    }
    .into_command()
    .is_err());
    assert!(QueueEditParams {
      action: QueueAction::Add,
      track_id: None,
      index: None,
    }
    .into_command()
    .is_err());
    assert!(QueueEditParams {
      action: QueueAction::Clear,
      track_id: None,
      index: None,
    }
    .into_command()
    .is_ok());
  }

  #[test]
  /// Verifies download inputs accept public URLs but reject names and local files.
  fn download_parameters_reject_names_and_non_network_urls() {
    assert!(DownloadAndPlayParams {
      url: "a song name".to_string(),
      media_type: MediaType::Audio,
    }
    .into_command()
    .is_err());
    assert!(DownloadAndPlayParams {
      url: "file:///private/song.mp3".to_string(),
      media_type: MediaType::Audio,
    }
    .into_command()
    .is_err());
    assert!(DownloadAndPlayParams {
      url: "https://example.test/song".to_string(),
      media_type: MediaType::Audio,
    }
    .into_command()
    .is_ok());
  }
}
