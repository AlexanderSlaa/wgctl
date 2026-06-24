import { WireGuardClient } from "@sourceregistry/node-wireguard";
import type { Peer } from "@sourceregistry/node-wireguard";
import { config } from "../config.js";
import { listNonStaticPeers, type PeerRow } from "../db/peers.repo.js";

/**
 * Singleton wrapper around the one process-wide WireGuardClient. Calls on a
 * single instance are already serialized internally by the native addon, so
 * one shared instance for the whole process is correct and sufficient — no
 * connection pool needed.
 *
 * IMPORTANT distinction (the most likely source of bugs if conflated):
 * - The AllowedIPs pushed to the KERNEL for a peer describe what traffic the
 *   kernel should accept as legitimately coming from that peer: the peer's
 *   own tunnel /32 plus whatever subnets it advertises behind itself.
 * - The AllowedIPs returned to the CLIENT in the HTTP API response describe
 *   what traffic the *client* should route into the tunnel: the selected
 *   networks' CIDRs plus the server's tunnel subnet.
 * These are two different lists for the same logical connection.
 */
export class WgManager {
  private readonly client = new WireGuardClient();
  private readonly iface = config.wgInterface;

  async upsertPeer(params: {
    publicKey: string;
    presharedKey?: string;
    allowedIPs: string[];
    persistentKeepaliveInterval?: number;
  }): Promise<void> {
    await this.client.configureDevice(this.iface, {
      peers: [
        {
          publicKey: params.publicKey,
          presharedKey: params.presharedKey,
          allowedIPs: params.allowedIPs,
          replaceAllowedIPs: true,
          persistentKeepaliveInterval: params.persistentKeepaliveInterval ?? config.persistentKeepalive,
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

  /** Re-pushes every persisted non-static peer into the kernel. Used at startup (kernel state is wiped on reboot) and can be re-run later without a process restart. */
  async reconcileFromDb(): Promise<void> {
    const peers = listNonStaticPeers();
    for (const peer of peers) {
      await this.reconcilePeerRow(peer);
    }
  }

  private async reconcilePeerRow(peer: PeerRow): Promise<void> {
    const advertisedSubnets: string[] = JSON.parse(peer.advertised_subnets);
    const allowedIPs = [`${peer.tunnel_ip}/32`, ...advertisedSubnets];
    await this.upsertPeer({
      publicKey: peer.public_key,
      presharedKey: peer.preshared_key ?? undefined,
      allowedIPs,
    });
  }

  /** Exposed so other modules (bootstrap) can call low-level client methods not wrapped above. */
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
