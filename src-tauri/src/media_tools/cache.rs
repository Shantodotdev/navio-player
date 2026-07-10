use super::*;

impl MediaCache {
  /// Loads a cloned media record while serializing access to the JSON file.
  pub(super) async fn load_media_entry(
    &self,
    app_handle: &AppHandle,
    fingerprint: &str,
  ) -> Result<Option<MediaDatabaseEntry>, String> {
    let _guard = self.inner.database_lock.lock().await;
    let database = load_json_or_default::<MediaDatabase>(&media_database_path(app_handle)?).await;
    Ok(
      database
        .entries
        .get(fingerprint)
        .map(|entry| MediaDatabaseEntry {
          path: entry.path.clone(),
          tracks: entry.tracks.clone(),
          resume_position_secs: entry.resume_position_secs,
          preferred_audio_stream_index: entry.preferred_audio_stream_index,
          subtitle_preference_set: entry.subtitle_preference_set,
          preferred_subtitle_stream_index: entry.preferred_subtitle_stream_index,
          last_accessed_ms: entry.last_accessed_ms,
        }),
    )
  }

  /// Applies one mutation to a media record and writes the bounded database.
  ///
  /// The callback keeps command-specific update logic close to its caller while
  /// this method owns locking, access timestamps, pruning, and persistence.
  pub(super) async fn update_media_entry<F>(
    &self,
    app_handle: &AppHandle,
    fingerprint: &str,
    path: &Path,
    update: F,
  ) -> Result<(), String>
  where
    F: FnOnce(&mut MediaDatabaseEntry),
  {
    let _guard = self.inner.database_lock.lock().await;
    let database_path = media_database_path(app_handle)?;
    let mut database = load_json_or_default::<MediaDatabase>(&database_path).await;
    let entry = database.entries.entry(fingerprint.to_string()).or_default();
    entry.path = path.to_string_lossy().to_string();
    entry.last_accessed_ms = now_ms();
    update(entry);
    prune_media_database(&mut database);
    save_json(&database_path, &database).await
  }

  /// Joins an existing keyed operation or starts it once for all requesters.
  ///
  /// The returned watch receiver contains a cloneable result, allowing multiple
  /// Tauri invocations to await the same FFmpeg process without duplicate work.
  pub(super) async fn join_or_start<F, Fut>(
    &self,
    key: String,
    request_id: String,
    operation: F,
  ) -> Result<String, String>
  where
    F: FnOnce(oneshot::Receiver<()>) -> Fut + Send + 'static,
    Fut: Future<Output = Result<String, String>> + Send + 'static,
  {
    let mut jobs = self.inner.jobs.lock().await;
    let receiver = if jobs.by_key.contains_key(&key) {
      // This asset is already being prepared. Register this request as another
      // consumer and subscribe to the same eventual result.
      let receiver = {
        let job = jobs.by_key.get_mut(&key).unwrap();
        job.request_ids.insert(request_id.clone());
        job.result.clone()
      };
      jobs.request_keys.insert(request_id, key);
      receiver
    } else {
      // The first request owns the operation. Later requests only subscribe to
      // `result_rx`, while the one-shot channel controls process cancellation.
      let (result_tx, result_rx) = watch::channel(None);
      let (cancel_tx, cancel_rx) = oneshot::channel();
      let mut request_ids = HashSet::new();
      request_ids.insert(request_id.clone());
      jobs.request_keys.insert(request_id, key.clone());
      jobs.by_key.insert(
        key.clone(),
        InFlightJob {
          result: result_rx.clone(),
          cancel: Some(cancel_tx),
          request_ids,
        },
      );

      let cache = self.clone();
      tokio::spawn(async move {
        let result = operation(cancel_rx).await;
        // Publish before removing registry entries so existing receivers always
        // observe a result even as the job disappears from the deduplication map.
        let _ = result_tx.send(Some(result));
        let mut jobs = cache.inner.jobs.lock().await;
        if let Some(job) = jobs.by_key.remove(&key) {
          for request_id in job.request_ids {
            jobs.request_keys.remove(&request_id);
          }
        }
      });
      result_rx
    };
    // Never hold the registry lock while waiting for FFmpeg; cancellation and
    // unrelated preparations must remain responsive.
    drop(jobs);

    let mut receiver = receiver;
    loop {
      if let Some(result) = receiver.borrow().clone() {
        return result;
      }
      receiver
        .changed()
        .await
        .map_err(|_| "Media preparation ended unexpectedly.".to_string())?;
    }
  }

  /// Removes a UI request from its active job and cancels the operation when no
  /// other request still depends on it.
  pub async fn cancel_request(&self, request_id: &str) {
    let mut jobs = self.inner.jobs.lock().await;
    let Some(key) = jobs.request_keys.remove(request_id) else {
      return;
    };
    let Some(job) = jobs.by_key.get_mut(&key) else {
      return;
    };
    job.request_ids.remove(request_id);
    // A shared extraction stays alive until its final consumer leaves.
    if job.request_ids.is_empty() {
      if let Some(cancel) = job.cancel.take() {
        let _ = cancel.send(());
      }
    }
  }

  /// Marks a generated file as recently used and enforces its cache budget.
  pub(super) async fn record_asset(
    &self,
    app_handle: &AppHandle,
    path: &Path,
    kind: AssetKind,
  ) -> Result<(), String> {
    let _guard = self.inner.asset_index_lock.lock().await;
    let root = theater_cache_root(app_handle)?;
    let index_path = root.join("asset-index.json");
    let mut index = load_json_or_default::<AssetIndex>(&index_path).await;
    reconcile_asset_index(&root, &mut index).await?;
    let size_bytes = tokio::fs::metadata(path)
      .await
      .map_err(|error| format!("Could not inspect cached media: {}", error))?
      .len();
    index.entries.insert(
      path.to_string_lossy().to_string(),
      AssetIndexEntry {
        kind,
        size_bytes,
        last_accessed_ms: now_ms(),
      },
    );
    cleanup_assets(&mut index, kind, path).await;
    save_json(&index_path, &index).await
  }
}
