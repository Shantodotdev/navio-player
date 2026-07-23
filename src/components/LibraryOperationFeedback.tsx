import { FolderSearch, LoaderCircle } from "lucide-react";
import type { LibraryScanOperation } from "../store/libraryStore";

interface LibraryOperationFeedbackProps {
  activeScan: LibraryScanOperation | null;
}

/** Shows honest indeterminate feedback while folder selection or scanning runs. */
export function LibraryOperationFeedback({
  activeScan,
}: LibraryOperationFeedbackProps) {
  if (!activeScan) return null;

  const isScanning = activeScan.folder !== null;

  return (
    <section
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="relative overflow-hidden rounded-xl border border-brand/20 bg-brand/8 px-4 py-3 shadow-lg shadow-brand-glow/20"
    >
      <div className="flex items-center gap-3">
        {isScanning ? (
          <LoaderCircle
            size={18}
            className="shrink-0 animate-spin text-brand-light"
          />
        ) : (
          <FolderSearch size={18} className="shrink-0 text-brand-light" />
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-200">
            {isScanning ? "Scanning folder" : "Choose a folder to scan"}
          </p>
          <p className="mt-0.5 truncate text-xs text-zinc-500">
            {activeScan.folder ??
              "Navio will begin indexing after you make a selection."}
          </p>
        </div>
      </div>
      {isScanning ? (
        <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-white/5">
          <span className="library-progress block h-full w-1/3 rounded-full bg-brand-light" />
        </div>
      ) : null}
    </section>
  );
}
