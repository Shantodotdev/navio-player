import { useState } from "react";
import { Lock, LoaderCircle, X } from "lucide-react";
import { useConnectStore } from "../store/connectStore";

/**
 * Modal dialog for entering a 4-digit PIN authentication code when pairing with a device.
 * Matches CreatePlaylistModal's persistent DOM structure and smooth enter/exit CSS transitions.
 */
export function ConnectPairingDialog() {
  const isPairingModalOpen = useConnectStore(
    (state) => state.isPairingModalOpen
  );
  const selectedPeer = useConnectStore((state) => state.selectedPeerForPairing);
  const closePairingModal = useConnectStore((state) => state.closePairingModal);
  const pairWithPeer = useConnectStore((state) => state.pairWithPeer);
  const isLoading = useConnectStore((state) => state.isLoading);
  const error = useConnectStore((state) => state.error);

  const [pin, setPin] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPeer || pin.trim().length !== 4) return;
    const success = await pairWithPeer(selectedPeer, pin.trim());
    if (success) {
      setPin("");
    }
  };

  return (
    <div
      onClick={closePairingModal}
      className={`fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 select-none transition-opacity duration-200 ${
        isPairingModalOpen
          ? "opacity-100 pointer-events-auto"
          : "opacity-0 pointer-events-none"
      }`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-md bg-[#0e0e12]/85 backdrop-blur-sm border border-white/10 rounded-2xl p-6 shadow-2xl space-y-4 transition-all duration-200 transform ${
          isPairingModalOpen ? "scale-100 opacity-100" : "scale-95 opacity-0"
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-brand/25 bg-brand/10 text-brand-light">
              <Lock size={24} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                Pairing Request
              </p>
              <h2 className="mt-0.5 truncate text-xl font-medium text-zinc-100">
                Pair with {selectedPeer?.name || "Device"}
              </h2>
              <p className="mt-1 text-xs text-zinc-400">
                Enter the 4-digit PIN code displayed on {selectedPeer?.name || "the remote device"}.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={closePairingModal}
            className="rounded-full p-2 text-zinc-500 hover:bg-white/5 hover:text-zinc-200 transition-colors cursor-pointer shrink-0"
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label
              htmlFor="pairing-pin-input"
              className="block text-sm text-zinc-400 font-medium"
            >
              4-digit PIN code
            </label>
            <input
              id="pairing-pin-input"
              type="text"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="••••"
              autoFocus
              className="w-full bg-black/40 border border-white/5 rounded-lg p-3 text-center text-3xl font-mono tracking-widest text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-brand/40 font-medium"
            />
          </div>

          {error && <p className="text-sm text-red-300">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={closePairingModal}
              disabled={isLoading}
              className="px-4 py-2 text-base text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pin.length !== 4 || isLoading}
              className="flex items-center gap-2 px-4 py-2 bg-brand hover:bg-brand-light text-zinc-200 font-medium rounded-lg text-base shadow shadow-brand-glow transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <LoaderCircle size={16} className="animate-spin" />
                  <span>Connecting...</span>
                </>
              ) : (
                <span>Confirm & Pair</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
