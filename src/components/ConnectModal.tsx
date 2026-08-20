import { useState } from "react";
import {
  X,
  Wifi,
  Laptop,
  Smartphone,
  Tablet,
  Key,
  Shield,
  Trash2,
  RefreshCw,
  Radio,
  Check,
  RadioTower,
} from "lucide-react";
import { useConnectStore } from "../store/connectStore";
import { ConnectPairingDialog } from "./ConnectPairingDialog";
import { Switch } from "./Switch";

/**
 * Main Navio Connect dashboard modal for device management, PIN generation, and granular permissions.
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

  if (!isConnectModalOpen) {
    return null;
  }

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refreshDiscoveredPeers();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const getDeviceIcon = (type: string) => {
    switch (type) {
      case "mobile":
        return <Smartphone size={18} className="text-zinc-300" />;
      case "tablet":
        return <Tablet size={18} className="text-zinc-300" />;
      default:
        return <Laptop size={18} className="text-zinc-300" />;
    }
  };

  return (
    <>
      <div
        onClick={closeConnectModal}
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 select-none animate-in fade-in duration-200"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-[#0e0e12]/95 backdrop-blur-2xl border border-white/10 shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/5 px-6 py-5 bg-black/20">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-brand/10 border border-brand/20 rounded-xl text-brand-light shadow-md shadow-brand-glow">
                <Wifi size={20} />
              </div>
              <div>
                <h2 className="text-lg font-medium text-zinc-200 flex items-center gap-2">
                  Navio Connect
                  <span className="rounded-md bg-brand/15 border border-brand/30 px-2 py-0.5 text-[10px] font-mono text-brand-light uppercase tracking-wider">
                    LAN P2P
                  </span>
                </h2>
                <p className="text-xs text-zinc-400 font-medium">
                  Two-way remote control and media streaming across your local network
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={closeConnectModal}
              className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/5 transition-colors cursor-pointer"
              aria-label="Close modal"
            >
              <X size={17} />
            </button>
          </div>

          {/* Content Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
            {/* Active Control Mode Indicator */}
            {activeRemoteHost && (
              <div className="flex items-center justify-between rounded-xl bg-brand/10 border border-brand/30 p-4 shadow-inner shadow-brand-glow">
                <div className="flex items-center gap-3">
                  <div className="flex h-3 w-3 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-light opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-brand"></span>
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-zinc-200">
                      Currently Controlling: {activeRemoteHost.hostName}
                    </h4>
                    <p className="text-xs text-brand-light/80 font-medium">
                      {activeRemoteHost.address}:{activeRemoteHost.port} • Connected
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void disconnectRemote()}
                  className="rounded-lg bg-black/40 hover:bg-black/70 border border-white/10 px-3.5 py-1.5 text-xs font-medium text-zinc-300 hover:text-red-300 hover:border-red-500/30 transition-all cursor-pointer"
                >
                  Disconnect
                </button>
              </div>
            )}

            {/* Section 1: This Machine & Pairing PIN */}
            <div className="rounded-xl bg-black/30 border border-white/5 p-4 sm:p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-white/5 text-zinc-400">
                    <RadioTower size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-zinc-200">
                      This Device: {localDevice?.name || "Navio Desktop"}
                    </h3>
                    <p className="text-xs text-zinc-500 font-medium">
                      IP: {localDevice?.localIps.join(", ") || "127.0.0.1"} • Port: {localDevice?.port || 0}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void generateNewPin()}
                  className="flex items-center justify-center gap-2 rounded-xl bg-brand hover:bg-brand-light text-zinc-200 px-4 py-2 text-xs font-medium shadow-md shadow-brand-glow transition-all cursor-pointer shrink-0"
                >
                  <Key size={14} />
                  <span>{activePin ? "New PIN" : "Generate Pairing PIN"}</span>
                </button>
              </div>

              {/* Display PIN Card when active */}
              {activePin && (
                <div className="flex items-center justify-between rounded-xl bg-brand/10 border border-brand/30 p-4">
                  <div>
                    <div className="text-xs font-medium text-brand-light">
                      Pairing Code for incoming connections:
                    </div>
                    <div className="text-xs text-zinc-400 mt-0.5 font-medium">
                      Type this 4-digit code on your remote device
                    </div>
                  </div>
                  <div className="font-mono text-3xl font-bold tracking-widest text-zinc-100 bg-black/60 border border-brand/40 rounded-xl px-5 py-2 shadow-inner">
                    {activePin}
                  </div>
                </div>
              )}
            </div>

            {/* Section 2: Discovered Peers on LAN */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                  <Radio size={15} className="text-brand-light" />
                  Discovered on Local Network ({discoveredPeers.length})
                </h3>
                <button
                  type="button"
                  onClick={() => void handleRefresh()}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <RefreshCw
                    size={13}
                    className={`${isRefreshing ? "animate-spin text-brand-light" : ""}`}
                  />
                  <span>Scan</span>
                </button>
              </div>

              {discoveredPeers.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 p-8 text-center bg-black/20">
                  <Radio size={24} className="text-zinc-600 mx-auto mb-2" />
                  <p className="text-sm font-medium text-zinc-400">
                    No other Navio instances found on this Wi-Fi
                  </p>
                  <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto font-medium">
                    Ensure Navio is running on your Mac, Windows PC, or Linux machine on the same local network.
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
                        className="flex items-center justify-between rounded-xl bg-black/30 border border-white/5 p-3.5 hover:border-white/10 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 rounded-lg bg-white/5 border border-white/5">
                            {getDeviceIcon(peer.deviceType)}
                          </div>
                          <div>
                            <div className="text-sm font-medium text-zinc-200 flex items-center gap-2">
                              {peer.name}
                              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-black/40 text-zinc-400 border border-white/5">
                                {peer.platform}
                              </span>
                              {isSaved && (
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-500/30">
                                  Paired
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-zinc-500 font-medium">
                              {peer.addresses[0] || "127.0.0.1"}:{peer.port}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {isCurrent ? (
                            <span className="flex items-center gap-1.5 text-xs font-medium text-brand-light px-3 py-1.5 rounded-lg bg-brand/10 border border-brand/20">
                              <Check size={13} strokeWidth={2.5} />
                              Controlling
                            </span>
                          ) : isSaved ? (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => void connectWithSavedToken(peer)}
                                className="rounded-xl bg-brand hover:bg-brand-light px-4 py-1.5 text-xs font-medium text-zinc-200 shadow-md shadow-brand-glow transition-all cursor-pointer"
                              >
                                Connect
                              </button>
                              <button
                                type="button"
                                onClick={() => openPairingModal(peer)}
                                className="rounded-xl bg-black/40 hover:bg-black/70 border border-white/10 p-1.5 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                                title="Re-pair with new PIN"
                              >
                                <Key size={13} />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openPairingModal(peer)}
                              className="rounded-xl bg-brand hover:bg-brand-light px-4 py-1.5 text-xs font-medium text-zinc-200 shadow-md shadow-brand-glow transition-all cursor-pointer"
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

            {/* Section 3: Paired Devices & Permissions */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                <Shield size={15} className="text-brand-light" />
                Paired & Trusted Devices ({pairedDevices.length})
              </h3>

              {pairedDevices.length === 0 ? (
                <div className="rounded-xl bg-black/20 border border-white/5 p-4 text-center text-xs text-zinc-500 font-medium">
                  No devices have paired with this machine yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {pairedDevices.map((device) => (
                    <div
                      key={device.id}
                      className="rounded-xl bg-black/30 border border-white/5 p-4 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className="p-1.5 rounded-lg bg-white/5">
                            {getDeviceIcon(device.deviceType)}
                          </div>
                          <span className="text-sm font-medium text-zinc-200">
                            {device.name}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => void revokeDevice(device.id)}
                          className="flex items-center gap-1 text-xs text-zinc-400 hover:text-red-400 hover:bg-red-950/30 px-2 py-1 rounded-lg transition-colors cursor-pointer"
                          title="Revoke device access"
                        >
                          <Trash2 size={13} />
                          <span>Revoke</span>
                        </button>
                      </div>

                      {/* Permission Toggles with Navio Switch */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-white/5 pt-3">
                        <div className="flex items-center justify-between text-xs text-zinc-300 font-medium">
                          <span>Playback Control</span>
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
                        <div className="flex items-center justify-between text-xs text-zinc-300 font-medium">
                          <span>Media Streaming</span>
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
                        <div className="flex items-center justify-between text-xs text-zinc-300 font-medium">
                          <span>Browse Library</span>
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
                        <div className="flex items-center justify-between text-xs text-zinc-300 font-medium">
                          <span>Remote Downloads</span>
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
