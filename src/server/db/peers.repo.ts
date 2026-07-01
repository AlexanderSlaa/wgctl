import { getDb } from "./index.js";
import { allocateNextIp } from "../wg/ip-pool.js";
import { config } from "../config.js";

export interface PeerRow {
  id: number;
  label: string;
  public_key: string;
  preshared_key: string | null;
  tunnel_ip: string;
  routes: string;
  created_at: string;
}

export function findPeerByLabel(label: string): PeerRow | undefined {
  return getDb().prepare("SELECT * FROM peers WHERE label = ?").get(label) as unknown as PeerRow | undefined;
}

export function findPeerById(id: number): PeerRow | undefined {
  return getDb().prepare("SELECT * FROM peers WHERE id = ?").get(id) as unknown as PeerRow | undefined;
}

export function findPeerByPublicKey(publicKey: string): PeerRow | undefined {
  return getDb().prepare("SELECT * FROM peers WHERE public_key = ?").get(publicKey) as unknown as PeerRow | undefined;
}

export function listAllPeers(): PeerRow[] {
  return getDb().prepare("SELECT * FROM peers ORDER BY id").all() as unknown as PeerRow[];
}

function allUsedIps(): Set<string> {
  const rows = getDb().prepare("SELECT tunnel_ip FROM peers").all() as { tunnel_ip: string }[];
  return new Set(rows.map((r) => r.tunnel_ip));
}

/**
 * Creates a new peer with an auto-allocated tunnel IP. Throws if the label
 * or public key already exists. Allocation + insert are synchronous (node:sqlite
 * is synchronous, Node is single-threaded) so there is no TOCTOU race.
 */
export function createPeer(params: {
  label: string;
  publicKey: string;
  presharedKey: string;
  routes?: string[];
}): PeerRow {
  const db = getDb();
  if (findPeerByLabel(params.label)) {
    throw new Error(`Peer label "${params.label}" is already in use.`);
  }
  if (findPeerByPublicKey(params.publicKey)) {
    throw new Error("A peer with this public key already exists.");
  }

  // Reserve offset 1 (server's own tunnel IP).
  const tunnelIp = allocateNextIp(config.wgSubnet, allUsedIps(), [1]);
  const routes = (params.routes ?? []).join(",");
  db.prepare(
    "INSERT INTO peers (label, public_key, preshared_key, tunnel_ip, routes) VALUES (?, ?, ?, ?, ?)",
  ).run(params.label, params.publicKey, params.presharedKey, tunnelIp, routes);
  return findPeerByPublicKey(params.publicKey)!;
}

export function getAllAdvertisedRoutes(): string[] {
  const rows = getDb().prepare("SELECT routes FROM peers WHERE routes != ''").all() as { routes: string }[];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const r of row.routes.split(",")) {
      if (r) seen.add(r);
    }
  }
  return [...seen];
}

export function deletePeer(id: number): void {
  getDb().prepare("DELETE FROM peers WHERE id = ?").run(id);
}
