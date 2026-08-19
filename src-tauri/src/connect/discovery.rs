//! Zero-configuration local network peer discovery via mDNS / DNS-SD.
//!
//! Automatically advertises this Navio instance on the LAN (`_navio-connect._tcp.local.`)
//! and continuously browses for other Navio desktop nodes.

use super::models::{DeviceType, DiscoveredPeer, Platform};
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

pub const SERVICE_TYPE: &str = "_navio-connect._tcp.local.";

/// Manages background mDNS service advertisement and peer discovery.
pub struct DiscoveryManager {
  mdns: ServiceDaemon,
  discovered_peers: Arc<RwLock<HashMap<String, DiscoveredPeer>>>,
  _local_device_id: String,
}

impl DiscoveryManager {
  /// Initializes the mDNS daemon, registers the local service, and starts background discovery.
  pub fn start(
    local_device_id: String,
    device_name: String,
    port: u16,
    local_ips: Vec<String>,
  ) -> Result<Self, String> {
    let mdns = ServiceDaemon::new().map_err(|e| format!("Failed to start mDNS daemon: {e}"))?;
    let discovered_peers = Arc::new(RwLock::new(HashMap::new()));

    // 1. Prepare properties dictionary for mDNS TXT record
    let mut properties = HashMap::new();
    properties.insert("id".to_string(), local_device_id.clone());
    properties.insert("name".to_string(), device_name.clone());
    properties.insert("type".to_string(), "desktop".to_string());
    properties.insert(
      "platform".to_string(),
      match Platform::current() {
        Platform::Windows => "windows",
        Platform::MacOS => "macos",
        Platform::Linux => "linux",
        _ => "unknown",
      }
      .to_string(),
    );
    properties.insert("version".to_string(), "1.0.0".to_string());

    // Sanitize instance name for mDNS (replace spaces/special chars if needed)
    let instance_name = format!("navio-{}", &local_device_id[..8]);
    let host_name = format!("{}.local.", instance_name);

    // Register our service if we have valid local IPs
    let host_ip_str = local_ips
      .first()
      .cloned()
      .unwrap_or_else(|| "127.0.0.1".to_string());

    match ServiceInfo::new(
      SERVICE_TYPE,
      &instance_name,
      &host_name,
      &host_ip_str,
      port,
      properties,
    ) {
      Ok(service_info) => {
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

    // 2. Browse for other Navio instances on the LAN
    let receiver = mdns
      .browse(SERVICE_TYPE)
      .map_err(|e| format!("Failed to browse mDNS services: {e}"))?;

    let peers_store = discovered_peers.clone();
    let self_id = local_device_id.clone();

    // Spawn a background thread to process mDNS discovery events
    std::thread::Builder::new()
      .name("navio-connect-discovery".into())
      .spawn(move || {
        while let Ok(event) = receiver.recv() {
          match event {
            ServiceEvent::ServiceResolved(info) => {
              let props = info.get_properties();
              let peer_id = props.get_property_val_str("id").unwrap_or("").to_string();

              // Skip our own advertised service
              if peer_id.is_empty() || peer_id == self_id {
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
                last_seen_ms: std::time::SystemTime::now()
                  .duration_since(std::time::UNIX_EPOCH)
                  .unwrap_or_default()
                  .as_millis() as u64,
              };

              println!(
                "[Navio Connect] Discovered peer: \"{}\" ({}) at {:?}:{}",
                peer_name,
                peer_id,
                addresses,
                info.get_port()
              );

              if let Ok(mut lock) = peers_store.write() {
                lock.insert(peer_id, peer);
              }
            }
            ServiceEvent::ServiceRemoved(_service_type, fullname) => {
              println!("[Navio Connect] Peer went offline: {}", fullname);
              if let Ok(mut lock) = peers_store.write() {
                // Find and remove matching peer
                lock
                  .retain(|_, peer| !fullname.contains(&peer.name) && !fullname.contains(&peer.id));
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

  /// Returns the current list of discovered peers on the local network.
  pub fn get_discovered_peers(&self) -> Vec<DiscoveredPeer> {
    if let Ok(lock) = self.discovered_peers.read() {
      lock.values().cloned().collect()
    } else {
      Vec::new()
    }
  }

  /// Gracefully unregisters mDNS services on shutdown.
  pub fn shutdown(&self) {
    let _ = self.mdns.unregister(SERVICE_TYPE);
    let _ = self.mdns.shutdown();
  }
}
