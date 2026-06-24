import { getDb } from "./index.js";

export interface NetworkRow {
  id: number;
  name: string;
  cidr: string;
  description: string | null;
}

export function listNetworksForUser(userId: number): NetworkRow[] {
  return getDb()
    .prepare(
      `SELECT n.* FROM networks n
       JOIN user_network_access a ON a.network_id = n.id
       WHERE a.user_id = ?
       ORDER BY n.id`,
    )
    .all(userId) as unknown as NetworkRow[];
}

export function listAllNetworks(): NetworkRow[] {
  return getDb().prepare("SELECT * FROM networks ORDER BY id").all() as unknown as NetworkRow[];
}

export function getNetworksByIds(ids: number[]): NetworkRow[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  return getDb()
    .prepare(`SELECT * FROM networks WHERE id IN (${placeholders})`)
    .all(...ids) as unknown as NetworkRow[];
}

export function createNetwork(name: string, cidr: string, description?: string): NetworkRow {
  getDb()
    .prepare("INSERT INTO networks (name, cidr, description) VALUES (?, ?, ?)")
    .run(name, cidr, description ?? null);
  return getDb().prepare("SELECT * FROM networks WHERE name = ?").get(name) as unknown as NetworkRow;
}

export function grantUserAccess(userId: number, networkId: number): void {
  getDb()
    .prepare("INSERT OR IGNORE INTO user_network_access (user_id, network_id) VALUES (?, ?)")
    .run(userId, networkId);
}

export function revokeUserAccess(userId: number, networkId: number): void {
  getDb().prepare("DELETE FROM user_network_access WHERE user_id = ? AND network_id = ?").run(userId, networkId);
}

export function findNetworkByName(name: string): NetworkRow | undefined {
  return getDb().prepare("SELECT * FROM networks WHERE name = ?").get(name) as unknown as NetworkRow | undefined;
}

export function deleteNetwork(id: number): void {
  getDb().prepare("DELETE FROM networks WHERE id = ?").run(id);
}
