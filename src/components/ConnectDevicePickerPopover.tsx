import { useEffect, useRef } from "react";
import {
  Laptop,
  Smartphone,
  Tablet,
  Check,
  Plus,
  Settings,
  Radio,
  Wifi,
} from "lucide-react";
import { useConnectStore } from "../store/connectStore";

interface ConnectDevicePickerPopoverProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Floating device switcher popover inspired by Spotify Connect and Apple AirPlay.
 * Allows quick output switching between local playback and discovered LAN peers.
 */
export function ConnectDevicePickerPopover({
  isOpen,
  onClose,
}: ConnectDevicePickerPopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const localDevice = useConnectStore((state) => state.localDevice);
  const discoveredPeers = useConnectStore((state) => state.discoveredPeers);
  const savedHostTokens = useConnectStore((state) => state.savedHostTokens);
  const activeRemoteHost = useConnectStore((state) => state.activeRemoteHost);
  const disconnectRemote = useConnectStore((state) => state.disconnectRemote);
  const connectWithSavedToken = useConnectStore(
    (state) => state.connectWithSavedToken
  );
  const openPairingModal = useConnectStore((state) => state.openPairingModal);
  const openConnectModal = useConnectStore((state) => state.openConnectModal);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const getDeviceIcon = (type: string) => {
    switch (type) {
      case "mobile":
        return <Smartphone size={16} className="text-zinc-400" />;
      case "tablet":
        return <Tablet size={16} className="text-zinc-400" />;
      default:
        return <Laptop size={16} className="text-zinc-400" />;
    }
  };

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full right-4 mb-3 w-80 bg-[#0e0e12]/95 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-50 select-none animate-in fade-in zoom-in-95 duration-150"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/5 bg-black/20">
        <div className="flex items-center gap-2">
          <Wifi size={15} className="text-brand-light" />
          <span className="text-sm font-medium text-zinc-200">
            Connect to a device
          </span>
        </div>
        <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-white/5 text-zinc-400 border border-white/5">
          Local Wi-Fi
        </span>
      </div>

      {/* Device List */}
      <div className="p-2 space-y-1 max-h-64 overflow-y-auto custom-scrollbar">
        {/* Local Machine Option */}
        <button
          type="button"
          onClick={() => {
            if (activeRemoteHost) {
              void disconnectRemote();
            }
            onClose();
          }}
          className={`w-full flex items-center justify-between p-3 rounded-xl transition-all cursor-pointer ${
            !activeRemoteHost
              ? "bg-brand/15 text-brand-light border border-brand/30 shadow-inner shadow-brand-glow"
              : "text-zinc-300 hover:bg-white/5 hover:text-zinc-100"
          }`}
        >
          <div className="flex items-center gap-3 truncate">
            <div
              className={`p-2 rounded-lg ${
                !activeRemoteHost
                  ? "bg-brand/20 text-brand-light"
                  : "bg-white/5 text-zinc-400"
              }`}
            >
              <Laptop size={16} />
            </div>
            <div className="truncate text-left">
              <div className="text-sm font-medium truncate">
                {localDevice?.name || "This Computer"}
              </div>
              <div className="text-xs text-zinc-500 font-medium">
                Local playback output
              </div>
            </div>
          </div>
          {!activeRemoteHost && (
            <div className="flex items-center gap-1.5 shrink-0 text-brand-light">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-light animate-pulse"></span>
              <Check size={14} strokeWidth={2.5} />
            </div>
          )}
        </button>

        {/* Remote Discovered / Paired Peers */}
        {discoveredPeers.map((peer) => {
          const isCurrent = activeRemoteHost?.hostId === peer.id;
          const isSaved = Boolean(savedHostTokens[peer.id]);

          return (
            <button
              key={peer.id}
              type="button"
              onClick={() => {
                if (isCurrent) {
                  // already controlling
                  onClose();
                } else if (isSaved) {
                  void connectWithSavedToken(peer);
                  onClose();
                } else {
                  openPairingModal(peer);
                  onClose();
                }
              }}
              className={`w-full flex items-center justify-between p-3 rounded-xl transition-all cursor-pointer ${
                isCurrent
                  ? "bg-brand/15 text-brand-light border border-brand/30 shadow-inner shadow-brand-glow"
                  : "text-zinc-300 hover:bg-white/5 hover:text-zinc-100"
              }`}
            >
              <div className="flex items-center gap-3 truncate">
                <div
                  className={`p-2 rounded-lg ${
                    isCurrent
                      ? "bg-brand/20 text-brand-light"
                      : "bg-white/5 text-zinc-400"
                  }`}
                >
                  {getDeviceIcon(peer.deviceType)}
                </div>
                <div className="truncate text-left">
                  <div className="text-sm font-medium truncate flex items-center gap-2">
                    {peer.name}
                    <span className="text-[10px] uppercase font-mono px-1 py-0.2 rounded bg-black/40 text-zinc-400">
                      {peer.platform}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-500 font-medium">
                    {isCurrent
                      ? "Controlling playback"
                      : isSaved
                        ? "Paired • Tap to control"
                        : "Discovered • Tap to pair"}
                  </div>
                </div>
              </div>

              {isCurrent ? (
                <div className="flex items-center gap-1.5 shrink-0 text-brand-light">
                  <span className="h-1.5 w-1.5 rounded-full bg-brand-light animate-pulse"></span>
                  <Check size={14} strokeWidth={2.5} />
                </div>
              ) : (
                <span className="text-xs font-medium text-zinc-400 bg-white/5 px-2 py-1 rounded-lg border border-white/5">
                  {isSaved ? "Connect" : "Pair"}
                </span>
              )}
            </button>
          );
        })}

        {discoveredPeers.length === 0 && (
          <div className="py-4 text-center text-xs text-zinc-500 font-medium space-y-1">
            <Radio size={18} className="mx-auto text-zinc-600 mb-1.5 animate-pulse" />
            <p>Scanning for nearby Navio players...</p>
          </div>
        )}
      </div>

      {/* Footer / Quick Navigation */}
      <div className="flex items-center justify-between p-2 border-t border-white/5 bg-black/30">
        <button
          type="button"
          onClick={() => {
            onClose();
            openConnectModal();
          }}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition cursor-pointer"
        >
          <Settings size={13} />
          <span>Devices & Security</span>
        </button>
        <button
          type="button"
          onClick={() => {
            onClose();
            openConnectModal();
          }}
          className="flex items-center gap-1 py-2 px-3 rounded-lg text-xs font-medium text-brand-light hover:bg-brand/10 transition cursor-pointer"
        >
          <Plus size={13} />
          <span>Pair PIN</span>
        </button>
      </div>
    </div>
  );
}
