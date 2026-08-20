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

export interface SavedHostToken {
  token: string;
  hostName: string;
  address: string;
  port: number;
}

const SAVED_HOSTS_STORAGE_KEY = "navio_connect_saved_hosts";

function loadSavedHostTokens(): Record<string, SavedHostToken> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(SAVED_HOSTS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persistSavedHostTokens(tokens: Record<string, SavedHostToken>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SAVED_HOSTS_STORAGE_KEY, JSON.stringify(tokens));
  } catch (err) {
    console.warn("Failed to persist saved host tokens:", err);
  }
}

interface ConnectStoreState {
  localDevice: LocalDeviceInfo | null;
  discoveredPeers: DiscoveredPeer[];
  pairedDevices: PairedDevice[];
  savedHostTokens: Record<string, SavedHostToken>;
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
  connectWithSavedToken: (peer: DiscoveredPeer) => Promise<boolean>;
  forgetSavedHost: (hostId: string) => void;
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
  savedHostTokens: loadSavedHostTokens(),
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
      const savedHostTokens = loadSavedHostTokens();

      set({
        localDevice,
        discoveredPeers,
        pairedDevices,
        activeRemoteHost,
        activePin,
        savedHostTokens,
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
        // Save the auth token for future instant 1-click reconnects without PIN
        if (hostInfo.token) {
          const updatedTokens = {
            ...get().savedHostTokens,
            [peer.id]: {
              token: hostInfo.token,
              hostName: hostInfo.hostName,
              address,
              port: peer.port,
            },
          };
          persistSavedHostTokens(updatedTokens);
          set({ savedHostTokens: updatedTokens });
        }

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

  connectWithSavedToken: async (peer: DiscoveredPeer) => {
    const saved = get().savedHostTokens[peer.id];
    if (!saved || !saved.token) {
      get().openPairingModal(peer);
      return false;
    }

    set({ isLoading: true, error: null });
    try {
      const address = peer.addresses[0] || saved.address || "127.0.0.1";
      const hostInfo = await connectApi.connectToPeer(
        peer.id,
        address,
        peer.port,
        saved.token
      );
      if (hostInfo) {
        set({
          activeRemoteHost: hostInfo,
          isLoading: false,
          isConnectModalOpen: false,
        });
        return true;
      }
      // If token expired or was revoked on host, remove it and open PIN dialog
      get().forgetSavedHost(peer.id);
      get().openPairingModal(peer);
      set({ isLoading: false });
      return false;
    } catch (err) {
      console.warn("Connect with saved token failed, opening PIN modal:", err);
      get().forgetSavedHost(peer.id);
      get().openPairingModal(peer);
      set({ isLoading: false });
      return false;
    }
  },

  forgetSavedHost: (hostId: string) => {
    const updated = { ...get().savedHostTokens };
    delete updated[hostId];
    persistSavedHostTokens(updated);
    set({ savedHostTokens: updated });
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
