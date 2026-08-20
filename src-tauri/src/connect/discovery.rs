//! Zero-configuration local network peer discovery via Multicast DNS (mDNS) and DNS-SD.
//!
//! # How Discovery Works (RFC 6762 / RFC 6763)
//!
//! 1. **Multicast Broadcasting (Announce)**:
//!    - When Navio launches on a desktop, it advertises the service type `_navio-connect._tcp.local.`
//!      over UDP port `5353` to the standard multicast address (`224.0.0.251` for IPv4 / `ff02::fb` for IPv6).
//!    - It builds and publishes standard DNS Resource Records:
//!      - **PTR Record**: Points `_navio-connect._tcp.local.` to the unique instance name (e.g., `navio-a1b2c3d4._navio-connect._tcp.local.`).
//!      - **SRV Record**: Specifies the TCP port on which this machine's Axum Connect server is listening.
//!      - **TXT Record**: Transmits key-value application metadata (`id`, `name`, `platform`, `version`).
//!      - **A / AAAA Records**: Resolves the hostname to the local network IP addresses (e.g., `192.168.1.10`).
//!
//! 2. **Continuous Peer Browsing (Discover)**:
//!    - A background thread continuously listens for incoming mDNS packets on the LAN.
//!    - When another Navio peer resolves, its IP, port, and identity are stored in a thread-safe
//!      in-memory registry (`Arc<RwLock<HashMap<String, DiscoveredPeer>>>`).
//!    - Handles sleep/wake cycles and avoids duplicate or unneeded offline log spam.

use super::models::{DeviceType, DiscoveredPeer, Platform};
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

/// The DNS-SD service registration string used by all Navio desktop nodes.
pub const SERVICE_TYPE: &str = "_navio-connect._tcp.local.";

/// Manages background mDNS service advertisement and peer discovery on the local network.
pub struct DiscoveryManager {
  /// The running background mDNS daemon handling raw UDP multicast sockets.
  mdns: ServiceDaemon,
  /// Thread-safe in-memory cache of currently discovered remote peers on the LAN.
  discovered_peers: Arc<RwLock<HashMap<String, DiscoveredPeer>>>,
  /// The local node's device ID, used to ignore self-broadcasts.
  _local_device_id: String,
}

impl DiscoveryManager {
  /// Initializes the mDNS daemon, registers the local service, and spawns the background discovery loop.
  ///
  /// # Arguments
  /// * `local_device_id` - The unique UUID identifying this Navio instance.
  /// * `device_name` - The human-readable name of this machine (e.g. "Khalid's PC").
  /// * `port` - The local TCP port where Navio's Axum server is listening.
  /// * `local_ips` - The resolved local IPv4 addresses (e.g. `["192.168.1.10"]`).
  pub fn start(
    local_device_id: String,
    device_name: String,
    port: u16,
    local_ips: Vec<String>,
  ) -> Result<Self, String> {
    // 1. Initialize the mdns-sd daemon which binds to UDP port 5353
    let mdns = ServiceDaemon::new().map_err(|e| format!("Failed to start mDNS daemon: {e}"))?;
    let discovered_peers = Arc::new(RwLock::new(HashMap::new()));

    // 2. Prepare the TXT record key-value properties.
    // In DNS-SD, TXT records hold arbitrary application metadata as byte strings.
    let mut properties = HashMap::new();
    properties.insert("id".to_string(), local_device_id.clone());
    properties.insert("name".to_string(), device_name.clone());
    properties.insert("type".to_string(), "desktop".to_string());
    properties.insert(
      "platform".to_string(),
      Platform::current().as_str().to_string(),
    );
    properties.insert("version".to_string(), "1.0.0".to_string());

    // Sanitize the instance name for DNS compliance (navio-<short_id>)
    let short_id = if local_device_id.len() >= 8 {
      &local_device_id[..8]
    } else {
      &local_device_id
    };
    let instance_name = format!("navio-{}", short_id);
    let host_name = format!("{}.local.", instance_name);

    // Pick the primary LAN IP for the address record
    let host_ip_str = local_ips
      .first()
      .cloned()
      .unwrap_or_else(|| "127.0.0.1".to_string());

    // Build the ServiceInfo struct containing PTR, SRV, TXT, and A records
    match ServiceInfo::new(
      SERVICE_TYPE,
      &instance_name,
      &host_name,
      &host_ip_str,
      port,
      properties,
    ) {
      Ok(service_info) => {
        // Register and multicast our presence packet across the subnet
        if let Err(err) = mdns.register(service_info) {
          eprintln!("[Navio Connect] Warning: Failed to register mDNS service: {err}");
        } else {
          println!(
            "[Navio Connect] Registered mDNS service: \"{}\" ({}) on port {} | IPs={:?}",
            device_name, instance_name, port, local_ips
          );
        }
      }
      Err(err) => {
        eprintln!("[Navio Connect] Warning: Failed to build mDNS ServiceInfo: {err}");
      }
    }

    // 3. Start browsing for other Navio peers on the local subnet.
    let receiver = mdns
      .browse(SERVICE_TYPE)
      .map_err(|e| format!("Failed to browse mDNS services: {e}"))?;

    let peers_store = discovered_peers.clone();
    let self_id = local_device_id.clone();
    let self_instance_prefix = format!("navio-{}", short_id);

    // 4. Spawn a dedicated background OS thread to continuously process incoming discovery events.
    std::thread::Builder::new()
      .name("navio-connect-discovery".into())
      .spawn(move || {
        while let Ok(event) = receiver.recv() {
          match event {
            // A remote peer was discovered or its DNS records refreshed
            ServiceEvent::ServiceResolved(info) => {
              let props = info.get_properties();
              let peer_id = props.get_property_val_str("id").unwrap_or("").to_string();

              // Ignore self-broadcasts so this node does not list itself
              if peer_id.is_empty()
                || peer_id == self_id
                || info.get_fullname().contains(&self_instance_prefix)
              {
                continue;
              }

              let peer_name = props
                .get_property_val_str("name")
                .unwrap_or_else(|| info.get_fullname())
                .to_string();

              let platform_str = props.get_property_val_str("platform").unwrap_or("unknown");
              let platform = match platform_str {
                "windows" => Platform::Windows,
                "macos" => Platform::MacOS,
                "linux" => Platform::Linux,
                "ios" => Platform::Ios,
                "android" => Platform::Android,
                "web" => Platform::Web,
                _ => Platform::Unknown,
              };

              let addresses: Vec<String> = info
                .get_addresses()
                .iter()
                .map(|ip| ip.to_string())
                .collect();

              let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;

              let peer = DiscoveredPeer {
                id: peer_id.clone(),
                name: peer_name.clone(),
                addresses: addresses.clone(),
                port: info.get_port(),
                device_type: DeviceType::Desktop,
                platform,
                version: props
                  .get_property_val_str("version")
                  .unwrap_or("1.0.0")
                  .to_string(),
                last_seen_ms: now_ms,
              };

              // Insert or update in the peers store
              if let Ok(mut lock) = peers_store.write() {
                let is_new = !lock.contains_key(&peer_id);
                lock.insert(peer_id.clone(), peer);
                if is_new {
                  println!(
                    "[Navio Connect] Discovered peer: \"{}\" ({}) at {:?}:{}",
                    peer_name,
                    peer_id,
                    addresses,
                    info.get_port()
                  );
                }
              }
            }

            // An mDNS record timed out or goodbye packet received
            ServiceEvent::ServiceRemoved(_service_type, fullname) => {
              // Ignore removals of our own local service instance
              if fullname.contains(&self_instance_prefix) || fullname.contains(&self_id) {
                continue;
              }

              let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;

              if let Ok(mut lock) = peers_store.write() {
                let prev_count = lock.len();
                let mut removed_name: Option<String> = None;

                // Match against known peer ID, name, or short ID prefix
                // Only prune if the peer has not been seen for > 15 seconds to avoid transient mDNS cache drops
                lock.retain(|peer_id, peer| {
                  let short_id_match = if peer_id.len() >= 8 {
                    fullname.contains(&format!("navio-{}", &peer_id[..8]))
                  } else {
                    false
                  };

                  let is_match =
                    fullname.contains(peer_id) || fullname.contains(&peer.name) || short_id_match;

                  if is_match && now_ms.saturating_sub(peer.last_seen_ms) > 15_000 {
                    removed_name = Some(peer.name.clone());
                    false
                  } else {
                    true
                  }
                });

                // Only log if an active peer was actually in our store and removed
                if lock.len() < prev_count {
                  if let Some(name) = removed_name {
                    println!("[Navio Connect] Peer went offline: \"{}\"", name);
                  }
                }
              }
            }
            _ => {}
          }
        }
      })
      .map_err(|e| format!("Failed to spawn discovery thread: {e}"))?;

    Ok(Self {
      mdns,
      discovered_peers,
      _local_device_id: local_device_id,
    })
  }

  /// Returns a snapshot list of all currently active discovered peers on the local network.
  ///
  /// Prunes stale peers that haven't been seen for more than 60 seconds.
  pub fn get_discovered_peers(&self) -> Vec<DiscoveredPeer> {
    let now = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .unwrap_or_default()
      .as_millis() as u64;

    if let Ok(mut lock) = self.discovered_peers.write() {
      // Retain peers seen within the last 60 seconds
      lock.retain(|_, peer| now.saturating_sub(peer.last_seen_ms) < 60_000);
      lock.values().cloned().collect()
    } else {
      Vec::new()
    }
  }

  /// Gracefully unregisters mDNS services and shuts down daemon threads on application exit.
  pub fn shutdown(&self) {
    let _ = self.mdns.unregister(SERVICE_TYPE);
    let _ = self.mdns.shutdown();
  }
}
