import { useState } from "react";
import { X, Lock, Loader2 } from "lucide-react";
import { useConnectStore } from "../store/connectStore";

/**
 * Dialog prompting the user to enter the 4-digit PIN code displayed on the remote device.
 */
export function ConnectPairingDialog() {
  const isPairingModalOpen = useConnectStore((state) => state.isPairingModalOpen);
  const selectedPeer = useConnectStore((state) => state.selectedPeerForPairing);
  const closePairingModal = useConnectStore((state) => state.closePairingModal);
  const pairWithPeer = useConnectStore((state) => state.pairWithPeer);
  const isLoading = useConnectStore((state) => state.isLoading);
  const error = useConnectStore((state) => state.error);

  const [pin, setPin] = useState("");

  if (!isPairingModalOpen || !selectedPeer) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.trim().length !== 4) return;
    const success = await pairWithPeer(selectedPeer, pin.trim());
    if (success) {
      setPin("");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-md rounded-2xl bg-neutral-900 border border-neutral-800 p-6 shadow-2xl">
        {/* Close button */}
        <button
          onClick={closePairingModal}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 transition"
          aria-label="Close dialog"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-neutral-100">Pair with Device</h3>
            <p className="text-xs text-neutral-400">
              Connecting to <span className="font-medium text-neutral-200">{selectedPeer.name}</span>
            </p>
          </div>
        </div>

        <p className="text-sm text-neutral-300 mb-5 leading-relaxed">
          Enter the 4-digit PIN code displayed on <span className="font-semibold text-neutral-100">{selectedPeer.name}</span> to authenticate this connection.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="text"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="e.g. 4829"
              autoFocus
              className="w-full rounded-xl bg-neutral-950 border border-neutral-800 px-4 py-3 text-center text-2xl font-mono tracking-widest text-neutral-100 placeholder:text-neutral-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 transition"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={closePairingModal}
              disabled={isLoading}
              className="rounded-xl px-4 py-2.5 text-sm font-medium text-neutral-300 hover:bg-neutral-800 transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pin.length !== 4 || isLoading}
              className="flex items-center justify-center gap-2 rounded-xl bg-cyan-500 px-5 py-2.5 text-sm font-medium text-neutral-950 hover:bg-cyan-400 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Pairing...</span>
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
