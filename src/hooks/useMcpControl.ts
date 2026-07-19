import { useEffect, useRef } from "react";
import {
  inspectDownloadUrl,
  listenToDownloads,
  loadDownloads,
  startDownload,
  type DownloadJob,
} from "../lib/downloads";
import {
  dispatchMcpCommand,
  handleDownloadAutoplay,
  type McpControlCommand,
  type McpControlReply,
  type McpDispatcherDependencies,
} from "../lib/mcpControl";
import { useLibraryStore } from "../store/libraryStore";
import { type Track, usePlayerStore } from "../store/playerStore";

interface PendingMcpRequest {
  id: string;
  command: McpControlCommand;
}

/**
 * Runs Navio's renderer-side MCP command loop and download autoplay coordinator.
 *
 * One effect long-polls Rust for correlated control requests and completes them
 * after dispatching against the shared stores. A second effect watches durable
 * downloader events and starts only downloads registered by this renderer session.
 */
export function useMcpControl(): void {
  const pendingAutoplay = useRef(new Set<string>());

  useEffect(() => {
    let stopped = false;

    /**
     * Long-polls the Rust broker and completes each request after renderer dispatch.
     * The loop stops permanently when Tauri is unavailable or the root component
     * unmounts, preventing duplicate consumers of the broker's FIFO queue.
     */
    async function runControlLoop(): Promise<void> {
      let invoke: typeof import("@tauri-apps/api/core")["invoke"];
      try {
        ({ invoke } = await import("@tauri-apps/api/core"));
      } catch {
        return;
      }

      const dependencies: McpDispatcherDependencies = {
        getPlayerState: usePlayerStore.getState,
        getLibraryState: useLibraryStore.getState,
        inspectDownloadUrl,
        startDownload,
        loadDownloads,
        createId: createRequestId,
        registerAutoplay: (jobId) => pendingAutoplay.current.add(jobId),
        unregisterAutoplay: (jobId) => pendingAutoplay.current.delete(jobId),
      };

      while (!stopped) {
        let request: PendingMcpRequest;
        try {
          request = await invoke<PendingMcpRequest>("wait_for_mcp_command");
        } catch (error) {
          if (!stopped) {
            console.warn("Navio agent control loop stopped:", error);
          }
          return;
        }

        let reply: McpControlReply;
        try {
          reply = await dispatchMcpCommand(request.command, dependencies);
        } catch (error) {
          reply = {
            success: false,
            message: normalizeControlError(error),
          };
        }

        try {
          await invoke("complete_mcp_command", {
            id: request.id,
            success: reply.success,
            message: reply.message ?? null,
            data: reply.data ?? null,
          });
        } catch (error) {
          if (!stopped) {
            console.warn("Could not complete Navio agent request:", error);
          }
        }
      }
    }

    void runControlLoop();
    return () => {
      stopped = true;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: () => void = () => undefined;

    /**
     * Asks Rust to authorize a completed downloader path and extract media metadata.
     * Keeping this operation behind a Tauri command prevents the renderer from
     * widening Navio's filesystem allowlist on behalf of an MCP caller.
     */
    async function inspectCompletedMedia(path: string): Promise<Track> {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<Track>("inspect_authorized_media_file", { path });
    }

    /**
     * Routes durable downloader events into the one-shot autoplay coordinator.
     * Errors are logged locally because the original MCP call has already returned
     * its asynchronous job ID by the time a download reaches a terminal state.
     */
    function handleDownloadUpdate(job: DownloadJob): void {
      void handleDownloadAutoplay(
        job,
        pendingAutoplay.current,
        inspectCompletedMedia,
        (track) => usePlayerStore.getState().playTrack(track, [track]),
      ).catch((error) =>
        console.warn("Downloaded media could not start playback:", error),
      );
    }

    void listenToDownloads(handleDownloadUpdate, (jobId) => {
      pendingAutoplay.current.delete(jobId);
    }).then((stopListening) => {
      if (disposed) {
        stopListening();
      } else {
        unlisten = stopListening;
      }
    });

    return () => {
      disposed = true;
      unlisten();
    };
  }, []);
}

/**
 * Creates a durable downloader ID in both browser-development and Tauri runtimes.
 * Web Crypto is preferred so the job ID can also safely name its private Rust
 * staging directory; the fallback preserves UUID shape on older WebViews.
 */
function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? createFallbackUuid();
}

/**
 * Produces an RFC 4122 version-4-shaped identifier when Web Crypto is unavailable.
 * This is a compatibility fallback rather than a source of cryptographic entropy.
 */
function createFallbackUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (value) => {
    const random = Math.floor(Math.random() * 16);
    const nibble = value === "x" ? random : (random & 0x3) | 0x8;
    return nibble.toString(16);
  });
}

/**
 * Converts an unknown renderer failure into bounded agent-safe message text.
 * Error objects never cross the Tauri or MCP serialization boundaries directly.
 */
function normalizeControlError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim().slice(0, 500) || "Navio could not complete the request.";
}
