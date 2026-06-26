import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { config } from "../config.js";
import { listAllPeers } from "../db/peers.repo.js";

export interface LivePeer {
  publicKey: string;
  endpoint?: string;
  allowedIPs: string[];
  lastHandshake: Date | null;
  receiveBytes: number;
  transmitBytes: number;
}

export function upsertPeer(params: {
  publicKey: string;
  presharedKey?: string;
  allowedIPs: string[];
}): void {
  const args = [
    "set", config.wgInterface,
    "peer", params.publicKey,
    "allowed-ips", params.allowedIPs.join(","),
    "persistent-keepalive", String(config.persistentKeepalive),
  ];
  if (params.presharedKey) {
    const tmp = join(tmpdir(), `wgctl-psk-${randomBytes(8).toString("hex")}`);
    try {
      writeFileSync(tmp, params.presharedKey, { mode: 0o600 });
      args.push("preshared-key", tmp);
      execFileSync("wg", args);
    } finally {
      try { unlinkSync(tmp); } catch { /* best-effort */ }
    }
  } else {
    execFileSync("wg", args);
  }
}

export function removePeer(publicKey: string): void {
  execFileSync("wg", ["set", config.wgInterface, "peer", publicKey, "remove"]);
}

export function getPublicKey(): string {
  return execFileSync("wg", ["show", config.wgInterface, "public-key"], { encoding: "utf8" }).trim();
}

export function getLiveStatus(): LivePeer[] {
  const result = spawnSync("wg", ["show", config.wgInterface, "dump"], { encoding: "utf8" });
  if (result.status !== 0) return [];
  const lines = (result.stdout ?? "").trim().split("\n").filter(Boolean);
  // First line is the interface row; skip it.
  return lines.slice(1).map((line) => {
    const [pubkey, , endpoint, allowedIPs, lastHandshakeUnix, rx, tx] = line.split("\t");
    const ts = Number(lastHandshakeUnix);
    return {
      publicKey: pubkey,
      endpoint: endpoint === "(none)" ? undefined : endpoint,
      allowedIPs: allowedIPs.split(",").filter(Boolean),
      lastHandshake: ts > 0 ? new Date(ts * 1000) : null,
      receiveBytes: Number(rx),
      transmitBytes: Number(tx),
    };
  });
}

export function reconcileFromDb(): void {
  for (const peer of listAllPeers()) {
    upsertPeer({
      publicKey: peer.public_key,
      presharedKey: peer.preshared_key ?? undefined,
      allowedIPs: [`${peer.tunnel_ip}/32`],
    });
  }
}
