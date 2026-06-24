import { getDb } from "./index.js";
import { allocateNextIp } from "../wg/ip-pool.js";
import { config } from "../config.js";

export interface PeerRow {
  id: number;
  username: string;
  public_key: string;
  preshared_key: string | null;
  tunnel_ip: string;
  advertised_subnets: string; // JSON string
  network_ids: string; // JSON string
  is_static: 0 | 1;
  created_at: string;
  last_seen_at: string | null;
}

export function findPeerByUsername(username: string): PeerRow | undefined {
  return getDb().prepare("SELECT * FROM peers WHERE username = ?").get(username) as unknown as PeerRow | undefined;
}

export function findPeerById(id: number): PeerRow | undefined {
  return getDb().prepare("SELECT * FROM peers WHERE id = ?").get(id) as unknown as PeerRow | undefined;
}

export function findPeerByPublicKey(publicKey: string): PeerRow | undefined {
  return getDb().prepare("SELECT * FROM peers WHERE public_key = ?").get(publicKey) as unknown as PeerRow | undefined;
}

export function listNonStaticPeers(): PeerRow[] {
  return getDb().prepare("SELECT * FROM peers WHERE is_static = 0").all() as unknown as PeerRow[];
}

export function listAllPeers(): PeerRow[] {
  return getDb().prepare("SELECT * FROM peers ORDER BY id").all() as unknown as PeerRow[];
}

/** All advertised subnets currently in use by other peers (for overlap checks). */
export function listAdvertisedSubnetsExcluding(username: string): string[] {
  const rows = getDb()
    .prepare("SELECT advertised_subnets FROM peers WHERE username != ?")
    .all(username) as { advertised_subnets: string }[];
  return rows.flatMap((r) => JSON.parse(r.advertised_subnets) as string[]);
}

function allUsedIps(): Set<string> {
  const rows = getDb().prepare("SELECT tunnel_ip FROM peers").all() as { tunnel_ip: string }[];
  return new Set(rows.map((r) => r.tunnel_ip));
}

/**
 * Registers or re-registers a peer for a user. One peer slot per username:
 * if the user already has a row, it's updated in place (same tunnel_ip,
 * possibly a new public key / selection). Allocation + insert happen inside
 * a single synchronous function (node:sqlite is synchronous, Node is
 * single-threaded) so there is no TOCTOU race between two concurrent
 * registrations without needing application-level locking.
 */
export function upsertUserPeer(params: {
  username: string;
  publicKey: string;
  advertisedSubnets: string[];
  networkIds: number[];
}): PeerRow {
  const db = getDb();
  const existing = findPeerByUsername(params.username);

  if (existing) {
    db.prepare(
      "UPDATE peers SET public_key = ?, advertised_subnets = ?, network_ids = ?, last_seen_at = datetime('now') WHERE id = ?",
    ).run(params.publicKey, JSON.stringify(params.advertisedSubnets), JSON.stringify(params.networkIds), existing.id);
    return findPeerById(existing.id)!;
  }

  // Reserved offsets: .1 (server) and .2 (static iphone peer) within the /24 pool.
  const tunnelIp = allocateNextIp(config.wgSubnet, allUsedIps(), [1, 2]);
  db.prepare(
    "INSERT INTO peers (username, public_key, tunnel_ip, advertised_subnets, network_ids, is_static, last_seen_at) VALUES (?, ?, ?, ?, ?, 0, datetime('now'))",
  ).run(params.username, params.publicKey, tunnelIp, JSON.stringify(params.advertisedSubnets), JSON.stringify(params.networkIds));
  return findPeerByPublicKey(params.publicKey)!;
}

export function upsertStaticPeer(params: { publicKey: string; presharedKey: string; tunnelIp: string }): PeerRow {
  const db = getDb();
  const existing = findPeerByPublicKey(params.publicKey);
  if (existing) return existing;
  db.prepare(
    "INSERT INTO peers (username, public_key, preshared_key, tunnel_ip, advertised_subnets, network_ids, is_static) VALUES ('__static__', ?, ?, ?, '[]', '[]', 1)",
  ).run(params.publicKey, params.presharedKey, params.tunnelIp);
  return findPeerByPublicKey(params.publicKey)!;
}

export function deletePeer(id: number): void {
  getDb().prepare("DELETE FROM peers WHERE id = ?").run(id);
}
