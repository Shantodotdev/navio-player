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
  CheckCircle2,
} from "lucide-react";
import { useConnectStore } from "../store/connectStore";
import { ConnectPairingDialog } from "./ConnectPairingDialog";

/**
 * Main dashboard modal for Navio Connect management, peer discovery, PIN generation, and permissions.
 */
export function ConnectModal() {
  const isConnectModalOpen = useConnectStore((state) => state.isConnectModalOpen);
  const closeConnectModal = useConnectStore((state) => state.closeConnectModal);
  const localDevice = useConnectStore((state) => state.localDevice);
  const discoveredPeers = useConnectStore((state) => state.discoveredPeers);
  const pairedDevices = useConnectStore((state) => state.pairedDevices);
  const activeRemoteHost = useConnectStore((state) => state.activeRemoteHost);
  const activePin = useConnectStore((state) => state.activePin);
  const generateNewPin = useConnectStore((state) => state.generateNewPin);
  const openPairingModal = useConnectStore((state) => state.openPairingModal);
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
    setTimeout(() => setIsRefreshing(false), 600);
  };

  const getDeviceIcon = (type: string) => {
    switch (type) {
      case "mobile":
        return <Smartphone className="h-5 w-5 text-emerald-400" />;
      case "tablet":
        return <Tablet className="h-5 w-5 text-purple-400" />;
      default:
        return <Laptop className="h-5 w-5 text-cyan-400" />;
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-200">
        <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-3xl bg-neutral-900 border border-neutral-800 shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-neutral-800 px-6 py-5 bg-neutral-900/80 backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-inner">
                <Wifi className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-neutral-100 flex items-center gap-2">
                  Navio Connect
                  <span className="rounded-full bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 text-[10px] font-medium text-cyan-400 uppercase tracking-wider">
                    LAN P2P
                  </span>
                </h2>
                <p className="text-xs text-neutral-400">
                  Control playback and stream media across local network devices
                </p>
              </div>
            </div>
            <button
              onClick={closeConnectModal}
              className="rounded-xl p-2 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 transition"
              aria-label="Close modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
            {/* Active Remote Control Mode Banner */}
            {activeRemoteHost && (
              <div className="flex items-center justify-between rounded-2xl bg-emerald-950/40 border border-emerald-500/30 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-3 w-3 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-emerald-300">
                      Currently Controlling: {activeRemoteHost.hostName}
                    </h4>
                    <p className="text-xs text-emerald-500/80">
                      {activeRemoteHost.address}:{activeRemoteHost.port} • Connected
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => void disconnectRemote()}
                  className="rounded-xl bg-neutral-800 hover:bg-red-950/50 hover:text-red-400 border border-neutral-700 px-3.5 py-1.5 text-xs font-medium text-neutral-200 transition"
                >
                  Disconnect
                </button>
              </div>
            )}

            {/* Section 1: This Machine & Pairing PIN */}
            <div className="rounded-2xl bg-neutral-950/60 border border-neutral-800 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Laptop className="h-5 w-5 text-neutral-400" />
                  <div>
                    <h3 className="text-sm font-semibold text-neutral-200">
                      This Device: {localDevice?.name || "Navio Desktop"}
                    </h3>
                    <p className="text-xs text-neutral-400">
                      IP: {localDevice?.localIps.join(", ") || "127.0.0.1"} • Port: {localDevice?.port || 0}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => void generateNewPin()}
                  className="flex items-center gap-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 px-3.5 py-2 text-xs font-medium text-neutral-200 transition"
                >
                  <Key className="h-3.5 w-3.5 text-cyan-400" />
                  <span>{activePin ? "New PIN" : "Generate PIN"}</span>
                </button>
              </div>

              {/* Display PIN Card if active */}
              {activePin && (
                <div className="flex items-center justify-between rounded-xl bg-cyan-950/30 border border-cyan-500/30 p-4">
                  <div>
                    <div className="text-xs text-cyan-400/90 font-medium">
                      Pairing Code for incoming connections:
                    </div>
                    <div className="text-xs text-neutral-400 mt-0.5">
                      Type this 4-digit code on your other device
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 font-mono text-3xl font-bold tracking-wider text-cyan-300 bg-neutral-900/90 border border-cyan-500/40 rounded-xl px-4 py-1.5 shadow-inner">
                    {activePin}
                  </div>
                </div>
              )}
            </div>

            {/* Section 2: Discovered Peers on LAN */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
                  <Radio className="h-4 w-4 text-cyan-400" />
                  Discovered on Local Network ({discoveredPeers.length})
                </h3>
                <button
                  onClick={() => void handleRefresh()}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin text-cyan-400" : ""}`}
                  />
                  <span>Scan</span>
                </button>
              </div>

              {discoveredPeers.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-neutral-800 p-8 text-center">
                  <Wifi className="h-8 w-8 text-neutral-600 mx-auto mb-2" />
                  <p className="text-sm font-medium text-neutral-400">
                    No other Navio instances found on this Wi-Fi
                  </p>
                  <p className="text-xs text-neutral-500 mt-1 max-w-sm mx-auto">
                    Ensure Navio is running on your Mac, Windows PC, or Linux machine on the same network.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {discoveredPeers.map((peer) => {
                    const isPaired = pairedDevices.some((p) => p.id === peer.id);
                    const isCurrent = activeRemoteHost?.hostId === peer.id;

                    return (
                      <div
                        key={peer.id}
                        className="flex items-center justify-between rounded-xl bg-neutral-950/60 border border-neutral-800 p-3.5 hover:border-neutral-700 transition"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-neutral-900 border border-neutral-800">
                            {getDeviceIcon(peer.deviceType)}
                          </div>
                          <div>
                            <div className="text-sm font-medium text-neutral-100 flex items-center gap-2">
                              {peer.name}
                              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400">
                                {peer.platform}
                              </span>
                            </div>
                            <div className="text-xs text-neutral-500">
                              {peer.addresses[0] || "127.0.0.1"}:{peer.port}
                            </div>
                          </div>
                        </div>

                        <div>
                          {isCurrent ? (
                            <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400 px-3 py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-500/20">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Controlling
                            </span>
                          ) : (
                            <button
                              onClick={() => openPairingModal(peer)}
                              className="rounded-xl bg-cyan-500 hover:bg-cyan-400 px-4 py-1.5 text-xs font-semibold text-neutral-950 transition"
                            >
                              {isPaired ? "Connect" : "Pair with PIN"}
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
              <h3 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
                <Shield className="h-4 w-4 text-cyan-400" />
                Paired & Trusted Devices ({pairedDevices.length})
              </h3>

              {pairedDevices.length === 0 ? (
                <div className="rounded-xl bg-neutral-950/30 border border-neutral-800/80 p-4 text-center text-xs text-neutral-500">
                  No devices have paired with this machine yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {pairedDevices.map((device) => (
                    <div
                      key={device.id}
                      className="rounded-xl bg-neutral-950/60 border border-neutral-800 p-4 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          {getDeviceIcon(device.deviceType)}
                          <span className="text-sm font-medium text-neutral-100">
                            {device.name}
                          </span>
                        </div>
                        <button
                          onClick={() => void revokeDevice(device.id)}
                          className="flex items-center gap-1 text-xs text-red-400/80 hover:text-red-400 hover:bg-red-950/30 px-2 py-1 rounded transition"
                          title="Revoke device access"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>Revoke</span>
                        </button>
                      </div>

                      {/* Permission Toggles */}
                      <div className="grid grid-cols-2 gap-2 text-xs border-t border-neutral-800/60 pt-3">
                        <label className="flex items-center gap-2 text-neutral-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={device.permissions.allowPlaybackControl}
                            onChange={(e) =>
                              void updatePermissions(device.id, {
                                ...device.permissions,
                                allowPlaybackControl: e.target.checked,
                              })
                            }
                            className="rounded border-neutral-700 bg-neutral-900 text-cyan-500 focus:ring-0"
                          />
                          <span>Playback Control</span>
                        </label>
                        <label className="flex items-center gap-2 text-neutral-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={device.permissions.allowStreaming}
                            onChange={(e) =>
                              void updatePermissions(device.id, {
                                ...device.permissions,
                                allowStreaming: e.target.checked,
                              })
                            }
                            className="rounded border-neutral-700 bg-neutral-900 text-cyan-500 focus:ring-0"
                          />
                          <span>Media Streaming</span>
                        </label>
                        <label className="flex items-center gap-2 text-neutral-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={device.permissions.allowViewLibrary}
                            onChange={(e) =>
                              void updatePermissions(device.id, {
                                ...device.permissions,
                                allowViewLibrary: e.target.checked,
                              })
                            }
                            className="rounded border-neutral-700 bg-neutral-900 text-cyan-500 focus:ring-0"
                          />
                          <span>Browse Library</span>
                        </label>
                        <label className="flex items-center gap-2 text-neutral-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={device.permissions.allowRemoteDownload}
                            onChange={(e) =>
                              void updatePermissions(device.id, {
                                ...device.permissions,
                                allowRemoteDownload: e.target.checked,
                              })
                            }
                            className="rounded border-neutral-700 bg-neutral-900 text-cyan-500 focus:ring-0"
                          />
                          <span>Remote Downloads</span>
                        </label>
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
