import { WireGuardClient } from "@sourceregistry/node-wireguard";
import type { Peer } from "@sourceregistry/node-wireguard";
import { config } from "../config.js";
import { listAllPeers } from "../db/peers.repo.js";

export class WgManager {
  private readonly client = new WireGuardClient();
  private readonly iface = config.wgInterface;

  async upsertPeer(params: {
    publicKey: string;
    presharedKey?: string;
    allowedIPs: string[];
  }): Promise<void> {
    await this.client.configureDevice(this.iface, {
      peers: [
        {
          publicKey: params.publicKey,
          presharedKey: params.presharedKey,
          allowedIPs: params.allowedIPs,
          replaceAllowedIPs: true,
          persistentKeepaliveInterval: config.persistentKeepalive,
        },
      ],
    });
  }

  async removePeer(publicKey: string): Promise<void> {
    await this.client.configureDevice(this.iface, {
      peers: [{ publicKey, remove: true }],
    });
  }

  async getLiveStatus(): Promise<Peer[]> {
    const device = await this.client.device(this.iface);
    return device.peers;
  }

  /** Re-pushes every peer from DB into the kernel. Safe to call on restart — kernel state is wiped on reboot. */
  async reconcileFromDb(): Promise<void> {
    const peers = listAllPeers();
    for (const peer of peers) {
      await this.upsertPeer({
        publicKey: peer.public_key,
        presharedKey: peer.preshared_key ?? undefined,
        allowedIPs: [`${peer.tunnel_ip}/32`],
      });
    }
  }

  get raw(): WireGuardClient {
    return this.client;
  }
}

let manager: WgManager | undefined;

export function getWgManager(): WgManager {
  if (!manager) {
    manager = new WgManager();
  }
  return manager;
}
