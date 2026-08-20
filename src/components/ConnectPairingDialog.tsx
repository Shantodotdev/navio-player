import { useState } from "react";
import { X, Lock, Loader2 } from "lucide-react";
import { useConnectStore } from "../store/connectStore";

/**
 * Clean Navio-themed pairing dialog to enter 4-digit PIN authentication codes.
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
    <div
      onClick={closePairingModal}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 select-none animate-in fade-in duration-200"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md bg-[#0e0e12]/95 backdrop-blur-2xl border border-white/10 rounded-2xl p-6 shadow-2xl space-y-5"
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={closePairingModal}
          className="absolute right-4 top-4 p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-white/5 rounded-lg transition-colors cursor-pointer"
          aria-label="Close dialog"
        >
          <X size={16} />
        </button>

        {/* Title */}
        <div className="flex items-center gap-3">
          <div className="p-3 bg-brand/10 border border-brand/20 rounded-xl text-brand-light shadow-md shadow-brand-glow">
            <Lock size={18} />
          </div>
          <div>
            <h3 className="text-lg font-medium text-zinc-200">
              Pair with Device
            </h3>
            <p className="text-xs text-zinc-400 font-medium">
              Connecting to <span className="text-zinc-200">{selectedPeer.name}</span>
            </p>
          </div>
        </div>

        <p className="text-sm text-zinc-400 font-medium leading-relaxed">
          Enter the 4-digit PIN code currently displayed on{" "}
          <span className="text-zinc-200 font-semibold">{selectedPeer.name}</span> to authenticate this session.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="text"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="••••"
              autoFocus
              className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-center text-3xl font-mono tracking-widest text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/40 shadow-inner"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3.5 py-2 text-xs text-red-400 font-medium">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={closePairingModal}
              disabled={isLoading}
              className="px-4 py-2.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pin.length !== 4 || isLoading}
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-brand hover:bg-brand-light text-zinc-200 font-medium rounded-xl text-sm shadow-md shadow-brand-glow transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
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
