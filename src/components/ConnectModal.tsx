import { useState } from "react";
import {
  Check,
  Key,
  Laptop,
  Radio,
  RadioTower,
  RefreshCw,
  Shield,
  Smartphone,
  Tablet,
  Trash2,
  Wifi,
  X,
} from "lucide-react";
import { useConnectStore } from "../store/connectStore";
import { ConnectPairingDialog } from "./ConnectPairingDialog";
import { Switch } from "./Switch";

/**
 * Modal dialog for Navio Connect management, local discovery, pairing, and permissions.
 * Matches CreatePlaylistModal's persistent DOM structure and smooth enter/exit CSS transitions.
 */
export function ConnectModal() {
  const isConnectModalOpen = useConnectStore(
    (state) => state.isConnectModalOpen
  );
  const closeConnectModal = useConnectStore((state) => state.closeConnectModal);
  const localDevice = useConnectStore((state) => state.localDevice);
  const discoveredPeers = useConnectStore((state) => state.discoveredPeers);
  const pairedDevices = useConnectStore((state) => state.pairedDevices);
  const activeRemoteHost = useConnectStore((state) => state.activeRemoteHost);
  const savedHostTokens = useConnectStore((state) => state.savedHostTokens);
  const activePin = useConnectStore((state) => state.activePin);
  const generateNewPin = useConnectStore((state) => state.generateNewPin);
  const openPairingModal = useConnectStore((state) => state.openPairingModal);
  const connectWithSavedToken = useConnectStore(
    (state) => state.connectWithSavedToken
  );
  const updatePermissions = useConnectStore((state) => state.updatePermissions);
  const revokeDevice = useConnectStore((state) => state.revokeDevice);
  const disconnectRemote = useConnectStore((state) => state.disconnectRemote);
  const refreshDiscoveredPeers = useConnectStore(
    (state) => state.refreshDiscoveredPeers
  );

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshDiscoveredPeers();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const getDeviceIcon = (type: string) => {
    switch (type) {
      case "mobile":
        return <Smartphone size={18} />;
      case "tablet":
        return <Tablet size={18} />;
      default:
        return <Laptop size={18} />;
    }
  };

  return (
    <>
      {/* Persistent modal shell supporting smooth enter and exit CSS transitions */}
      <div
        onClick={closeConnectModal}
        className={`fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 select-none transition-opacity duration-200 ${
          isConnectModalOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className={`flex max-h-[min(720px,90vh)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0e0e12]/85 shadow-2xl backdrop-blur-sm transition-all duration-200 transform ${
            isConnectModalOpen ? "scale-100 opacity-100" : "scale-95 opacity-0"
          }`}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 bg-white/2.5 p-6">
            <div>
              <h2 className="mt-1 text-2xl font-medium text-zinc-200 flex items-center gap-2.5">
                <Wifi size={25} className="text-brand-light" />
                Navio Connect
              </h2>
            </div>
            <button
              type="button"
              onClick={closeConnectModal}
              className="rounded-full p-2 text-zinc-500 hover:bg-white/5 hover:text-zinc-200 transition-colors cursor-pointer shrink-0"
              aria-label="Close modal"
            >
              <X size={18} />
            </button>
          </div>

          {/* Active Controlling Bar */}
          {activeRemoteHost && (
            <div className="flex items-center justify-between bg-brand/10 border-b border-brand/20 px-6 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-2.5 w-2.5 rounded-full bg-brand-light animate-pulse" />
                <span className="text-sm font-medium text-zinc-200">
                  Currently controlling{" "}
                  <span className="text-brand-light font-semibold">
                    {activeRemoteHost.hostName}
                  </span>
                </span>
              </div>
              <button
                type="button"
                onClick={() => void disconnectRemote()}
                className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer"
              >
                Disconnect session
              </button>
            </div>
          )}

          {/* Main Scrollable Content */}
          <div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-6 bg-black/10 custom-scrollbar">
            {/* Section 1: This Machine & Pairing PIN */}
            <div className="rounded-xl border border-white/10 bg-black/40 p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white/5 text-zinc-300">
                    <RadioTower size={22} />
                  </div>
                  <div>
                    <h3 className="text-base font-medium text-zinc-200">
                      {localDevice?.name || "This Computer"}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs font-mono text-zinc-300 bg-white/5 border border-white/10 px-2 py-0.5 rounded-md">
                        {localDevice?.localIps[0] || "127.0.0.1"}:{localDevice?.port || 0}
                      </span>
                      <span className="text-xs text-zinc-500 font-normal">
                        • Local host
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => void generateNewPin()}
                  className="flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-normal text-white hover:bg-brand-light shadow shadow-brand-glow transition-all cursor-pointer shrink-0"
                >
                  <Key size={16} />
                  <span>
                    {activePin ? "Generate new PIN" : "Show pairing PIN"}
                  </span>
                </button>
              </div>

              {/* Display PIN Box */}
              {activePin && (
                <div className="flex items-center justify-between rounded-xl border border-brand/30 bg-brand/10 p-4">
                  <div>
                    <p className="text-sm font-medium text-brand-light">
                      Pairing code for incoming connections:
                    </p>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      Enter this 4-digit code on your remote device to pair.
                    </p>
                  </div>
                  <div className="font-mono text-2xl font-bold tracking-widest text-zinc-100 bg-black/60 border border-brand/40 rounded-lg px-4 py-2 shadow-inner">
                    {activePin}
                  </div>
                </div>
              )}
            </div>

            {/* Section 2: Discovered Network Devices */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                  <Radio size={16} className="text-brand-light" />
                  <span>Discovered devices on network</span>
                  <span className="text-xs text-zinc-500 font-normal">
                    ({discoveredPeers.length})
                  </span>
                </h3>

                <button
                  type="button"
                  onClick={() => void handleRefresh()}
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:bg-white/10 hover:text-zinc-200 transition-colors cursor-pointer"
                >
                  <RefreshCw
                    size={13}
                    className={
                      isRefreshing ? "animate-spin text-brand-light" : ""
                    }
                  />
                  <span>Scan</span>
                </button>
              </div>

              {discoveredPeers.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-zinc-500">
                  <p>No other Navio players found on this Wi-Fi network.</p>
                  <p className="text-xs text-zinc-600 mt-1">
                    Ensure Navio is running on your other computer or mobile
                    device.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {discoveredPeers.map((peer) => {
                    const isSaved = Boolean(savedHostTokens[peer.id]);
                    const isCurrent = activeRemoteHost?.hostId === peer.id;

                    return (
                      <div
                        key={peer.id}
                        className="group flex items-center justify-between gap-4 rounded-xl border border-white/5 bg-black/30 p-4 hover:border-white/10 hover:bg-white/5 transition-all"
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/5 text-zinc-400">
                            {getDeviceIcon(peer.deviceType)}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-medium text-zinc-200">
                                {peer.name}
                              </p>
                              <span className="text-xs uppercase font-mono px-2 py-0.5 rounded bg-white/5 text-zinc-400">
                                {peer.platform}
                              </span>
                              {isSaved && (
                                <span className="text-xs font-medium px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-500/30">
                                  Paired
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-xs font-mono text-zinc-400 bg-white/5 border border-white/5 px-2 py-0.5 rounded-md">
                                {peer.addresses[0] || "127.0.0.1"}:{peer.port}
                              </span>
                              <span className="text-xs text-zinc-500 font-normal">
                                • Local network
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {isCurrent ? (
                            <span className="flex items-center gap-1.5 rounded-lg border border-brand/30 bg-brand/10 px-3.5 py-2 text-xs font-medium text-brand-light">
                              <Check size={14} strokeWidth={2.5} />
                              Controlling
                            </span>
                          ) : isSaved ? (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => void connectWithSavedToken(peer)}
                                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-light shadow shadow-brand-glow transition-all cursor-pointer"
                              >
                                Connect
                              </button>
                              <button
                                type="button"
                                onClick={() => openPairingModal(peer)}
                                className="rounded-lg border border-white/10 bg-white/5 p-2 text-zinc-400 hover:bg-white/10 hover:text-zinc-200 transition-colors cursor-pointer"
                                title="Re-pair with new PIN"
                              >
                                <Key size={14} />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openPairingModal(peer)}
                              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-light shadow shadow-brand-glow transition-all cursor-pointer"
                            >
                              Pair with PIN
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Section 3: Paired & Trusted Devices */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                <Shield size={16} className="text-brand-light" />
                <span>Paired & trusted devices</span>
                <span className="text-xs text-zinc-500 font-normal">
                  ({pairedDevices.length})
                </span>
              </h3>

              {pairedDevices.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-zinc-500">
                  <p>No devices have paired with this computer yet.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pairedDevices.map((device) => (
                    <div
                      key={device.id}
                      className="rounded-xl border border-white/10 bg-black/30 p-4 space-y-4"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/5 text-zinc-400">
                            {getDeviceIcon(device.deviceType)}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-zinc-200">
                              {device.name}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-xs font-mono text-zinc-400 bg-white/5 border border-white/5 px-2 py-0.5 rounded-md">
                                ID: {device.id.slice(0, 8)}
                              </span>
                              <span className="text-xs text-zinc-500 font-normal">
                                • Trusted device
                              </span>
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => void revokeDevice(device.id)}
                          className="flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer"
                        >
                          <Trash2 size={13} />
                          <span>Revoke</span>
                        </button>
                      </div>

                      {/* Permission Toggles */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-white/5">
                        <div className="flex items-center justify-between text-sm text-zinc-300 font-medium">
                          <span>Playback control</span>
                          <Switch
                            checked={device.permissions.allowPlaybackControl}
                            onChange={(checked) =>
                              void updatePermissions(device.id, {
                                ...device.permissions,
                                allowPlaybackControl: checked,
                              })
                            }
                          />
                        </div>
                        <div className="flex items-center justify-between text-sm text-zinc-300 font-medium">
                          <span>Media streaming</span>
                          <Switch
                            checked={device.permissions.allowStreaming}
                            onChange={(checked) =>
                              void updatePermissions(device.id, {
                                ...device.permissions,
                                allowStreaming: checked,
                              })
                            }
                          />
                        </div>
                        <div className="flex items-center justify-between text-sm text-zinc-300 font-medium">
                          <span>Browse library</span>
                          <Switch
                            checked={device.permissions.allowViewLibrary}
                            onChange={(checked) =>
                              void updatePermissions(device.id, {
                                ...device.permissions,
                                allowViewLibrary: checked,
                              })
                            }
                          />
                        </div>
                        <div className="flex items-center justify-between text-sm text-zinc-300 font-medium">
                          <span>Remote downloads</span>
                          <Switch
                            checked={device.permissions.allowRemoteDownload}
                            onChange={(checked) =>
                              void updatePermissions(device.id, {
                                ...device.permissions,
                                allowRemoteDownload: checked,
                              })
                            }
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <ConnectPairingDialog />
    </>
  );
}
