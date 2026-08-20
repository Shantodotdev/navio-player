/**
 * Zustand store for Navio Connect state, peer discovery, and remote control sessions.
 */

import { create } from "zustand";
import * as connectApi from "../lib/connect/api";
import type {
  ConnectedHostInfo,
  ConnectPermissions,
  ConnectPlaybackAction,
  ConnectPlayerState,
  DiscoveredPeer,
  LocalDeviceInfo,
  PairedDevice,
} from "../lib/connect/types";

interface ConnectStoreState {
  localDevice: LocalDeviceInfo | null;
  discoveredPeers: DiscoveredPeer[];
  pairedDevices: PairedDevice[];
  activeRemoteHost: ConnectedHostInfo | null;
  remotePlayerState: ConnectPlayerState | null;
  activePin: string | null;
  isConnectModalOpen: boolean;
  isPairingModalOpen: boolean;
  selectedPeerForPairing: DiscoveredPeer | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  initialize: () => Promise<void>;
  refreshDiscoveredPeers: () => Promise<void>;
  refreshPairedDevices: () => Promise<void>;
  generateNewPin: () => Promise<string | null>;
  openConnectModal: () => void;
  closeConnectModal: () => void;
  openPairingModal: (peer: DiscoveredPeer) => void;
  closePairingModal: () => void;
  pairWithPeer: (peer: DiscoveredPeer, pin: string) => Promise<boolean>;
  updatePermissions: (
    deviceId: string,
    permissions: ConnectPermissions
  ) => Promise<boolean>;
  revokeDevice: (deviceId: string) => Promise<boolean>;
  sendRemoteAction: (action: ConnectPlaybackAction) => Promise<boolean>;
  disconnectRemote: () => Promise<void>;
  setRemotePlayerState: (state: ConnectPlayerState | null) => void;
}

export const useConnectStore = create<ConnectStoreState>((set, get) => ({
  localDevice: null,
  discoveredPeers: [],
  pairedDevices: [],
  activeRemoteHost: null,
  remotePlayerState: null,
  activePin: null,
  isConnectModalOpen: false,
  isPairingModalOpen: false,
  selectedPeerForPairing: null,
  isLoading: false,
  error: null,

  initialize: async () => {
    try {
      const localDevice = await connectApi.getLocalDeviceInfo();
      const discoveredPeers = await connectApi.getDiscoveredPeers();
      const pairedDevices = await connectApi.getPairedDevices();
      const activeRemoteHost = await connectApi.getActiveRemoteHost();
      const activePin = await connectApi.getActivePin();

      set({
        localDevice,
        discoveredPeers,
        pairedDevices,
        activeRemoteHost,
        activePin,
      });
    } catch (err) {
      console.error("[Navio Connect Store] Initialization failed:", err);
    }
  },

  refreshDiscoveredPeers: async () => {
    const peers = await connectApi.getDiscoveredPeers();
    set({ discoveredPeers: peers });
  },

  refreshPairedDevices: async () => {
    const paired = await connectApi.getPairedDevices();
    set({ pairedDevices: paired });
  },

  generateNewPin: async () => {
    const pin = await connectApi.generatePairingPin();
    set({ activePin: pin });
    return pin;
  },

  openConnectModal: () => {
    set({ isConnectModalOpen: true });
    void get().refreshDiscoveredPeers();
    void get().refreshPairedDevices();
  },

  closeConnectModal: () => {
    set({ isConnectModalOpen: false });
  },

  openPairingModal: (peer: DiscoveredPeer) => {
    set({
      isPairingModalOpen: true,
      selectedPeerForPairing: peer,
      error: null,
    });
  },

  closePairingModal: () => {
    set({
      isPairingModalOpen: false,
      selectedPeerForPairing: null,
      error: null,
    });
  },

  pairWithPeer: async (peer: DiscoveredPeer, pin: string) => {
    set({ isLoading: true, error: null });
    try {
      const address = peer.addresses[0] || "127.0.0.1";
      const hostInfo = await connectApi.pairWithPeer(
        peer.id,
        address,
        peer.port,
        pin
      );
      if (hostInfo) {
        set({
          activeRemoteHost: hostInfo,
          isPairingModalOpen: false,
          selectedPeerForPairing: null,
          isLoading: false,
        });
        await get().refreshPairedDevices();
        return true;
      }
      set({ isLoading: false, error: "Pairing failed. Please verify the PIN." });
      return false;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ isLoading: false, error: message });
      return false;
    }
  },

  updatePermissions: async (
    deviceId: string,
    permissions: ConnectPermissions
  ) => {
    const success = await connectApi.updateDevicePermissions(
      deviceId,
      permissions
    );
    if (success) {
      await get().refreshPairedDevices();
    }
    return success;
  },

  revokeDevice: async (deviceId: string) => {
    const success = await connectApi.revokeDevice(deviceId);
    if (success) {
      await get().refreshPairedDevices();
    }
    return success;
  },

  sendRemoteAction: async (action: ConnectPlaybackAction) => {
    return await connectApi.sendRemoteCommand(action);
  },

  disconnectRemote: async () => {
    await connectApi.disconnectRemote();
    set({ activeRemoteHost: null, remotePlayerState: null });
  },

  setRemotePlayerState: (state: ConnectPlayerState | null) => {
    set({ remotePlayerState: state });
  },
}));
