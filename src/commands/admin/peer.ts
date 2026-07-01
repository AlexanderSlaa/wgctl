import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { listAllPeers, findPeerById, findPeerByLabel, deletePeer, createPeer, getAllAdvertisedRoutes } from "../../server/db/peers.repo.js";
import { isValidCidr } from "../../shared/cidr.js";
import { getDb } from "../../server/db/index.js";
import { upsertPeer, removePeer, getLiveStatus, getPublicKey, addPeerToConf, removePeerFromConf } from "../../server/wg/WgManager.js";
import { config } from "../../server/config.js";

function wgGenKey(): string {
  return execFileSync("wg", ["genkey"], { encoding: "utf8" }).trim();
}

function wgPubKey(privateKey: string): string {
  return execFileSync("wg", ["pubkey"], { input: privateKey, encoding: "utf8" }).trim();
}

function wgGenPsk(): string {
  return execFileSync("wg", ["genpsk"], { encoding: "utf8" }).trim();
}

const TOKEN_PREFIX = "wgctl-join-v1.";
const META_PREFIX = "join_token_hash:";

function usage(): void {
  console.log(`Usage:
  wgctl peer add <label> [--endpoint <host:port>] [--routes <cidr,...>] [--output <file>] [--join-token]
  wgctl peer token <label>
  wgctl peer ls
  wgctl peer rm <id|label>`);
}

function encodeJoinToken(params: {
  label: string;
  privateKey: string;
  presharedKey: string;
  clientAddress: string;
  serverPublicKey: string;
  endpoint: string;
  allowedIPs: string[];
  persistentKeepalive: number;
}): string {
  const body = Buffer.from(JSON.stringify({ version: 1, ...params }), "utf8").toString("base64url");
  return `${TOKEN_PREFIX}${body}`;
}

function renderConf(params: {
  privateKey: string;
  presharedKey: string;
  clientAddress: string;
  serverPublicKey: string;
  endpoint: string;
  allowedIPs: string[];
  persistentKeepalive: number;
}): string {
  return [
    "[Interface]",
    `PrivateKey = ${params.privateKey}`,
    `Address = ${params.clientAddress}`,
    "",
    "[Peer]",
    `PublicKey = ${params.serverPublicKey}`,
    `PresharedKey = ${params.presharedKey}`,
    `Endpoint = ${params.endpoint}`,
    `AllowedIPs = ${params.allowedIPs.join(", ")}`,
    `PersistentKeepalive = ${params.persistentKeepalive}`,
    "",
  ].join("\n");
}

function storeTokenHash(token: string): void {
  const hash = createHash("sha256").update(token).digest("hex");
  getDb()
    .prepare("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)")
    .run(`${META_PREFIX}${hash}`, new Date().toISOString());
}

function buildPeerOutput(params: {
  label: string;
  endpoint?: string;
  routes?: string[];
  output?: string;
  joinToken: boolean;
  forLabel?: string;
}): void {
  const serverPublicKey = getPublicKey();
  const endpoint = params.endpoint ?? `${config.publicHost}:${config.wgListenPort}`;

  let peer = findPeerByLabel(params.label);
  let privKey: string;
  let psk: string;

  if (peer) {
    // Regenerating token for existing peer — generate new client keypair and PSK,
    // then update the peer in WireGuard with the new public key.
    privKey = wgGenKey();
    const newPubKey = wgPubKey(privKey);
    psk = wgGenPsk();
    getDb()
      .prepare("UPDATE peers SET public_key = ?, preshared_key = ? WHERE id = ?")
      .run(newPubKey, psk, peer.id);
    peer = findPeerByLabel(params.label)!;
    const existingRoutes = peer.routes ? peer.routes.split(",").filter(Boolean) : [];
    const serverAllowedIPs = [`${peer.tunnel_ip}/32`, ...existingRoutes];
    upsertPeer({ publicKey: peer.public_key, presharedKey: psk, allowedIPs: serverAllowedIPs });
  } else {
    privKey = wgGenKey();
    const peerPublicKey = wgPubKey(privKey);
    psk = wgGenPsk();
    const routes = params.routes ?? [];
    peer = createPeer({ label: params.label, publicKey: peerPublicKey, presharedKey: psk, routes });
    try {
      const serverAllowedIPs = [`${peer.tunnel_ip}/32`, ...routes];
      upsertPeer({ publicKey: peer.public_key, presharedKey: psk, allowedIPs: serverAllowedIPs });
      addPeerToConf({ label: params.label, publicKey: peer.public_key, presharedKey: psk, allowedIPs: serverAllowedIPs, keepalive: config.persistentKeepalive });
    } catch (err) {
      deletePeer(peer.id);
      throw err;
    }
    const routeSuffix = routes.length ? ` — advertising: ${routes.join(", ")}` : "";
    console.log(`Created peer ${peer.id} (${params.label}) — tunnel IP: ${peer.tunnel_ip}${routeSuffix}`);
  }

  const subnetPrefixLength = config.wgSubnet.split("/")[1];
  const clientAddress = `${peer.tunnel_ip}/${subnetPrefixLength}`;
  // Clients route the tunnel subnet + all subnets advertised by any peer.
  const allAdvertisedRoutes = getAllAdvertisedRoutes();
  const allowedIPs = [config.wgSubnet, ...allAdvertisedRoutes];
  const peerRoutes = peer.routes ? peer.routes.split(",").filter(Boolean) : [];

  const tokenPayload = {
    label: params.label,
    privateKey: privKey,
    presharedKey: psk,
    clientAddress,
    serverPublicKey,
    endpoint,
    allowedIPs,
    persistentKeepalive: config.persistentKeepalive,
    advertisedRoutes: peerRoutes,
  };

  if (params.joinToken) {
    const token = encodeJoinToken(tokenPayload);
    storeTokenHash(token);
    console.log("\nRun this on the peer machine:\n");
    console.log(`  sudo wgctl join '${token}'\n`);
  } else if (params.output) {
    writeFileSync(params.output, renderConf(tokenPayload), { mode: 0o600 });
    console.log(`Wrote WireGuard config to ${params.output}`);
  } else {
    console.log("\nWireGuard config (import into any WireGuard app or save as .conf):\n");
    console.log(renderConf(tokenPayload));
  }
}

function parseAddOptions(rest: string[]): { label: string; endpoint?: string; routes?: string[]; output?: string; joinToken: boolean } {
  const [label, ...flagArgs] = rest;
  if (!label || label.startsWith("--")) throw new Error("Usage: wgctl peer add <label> [options]");

  let endpoint: string | undefined;
  let routes: string[] | undefined;
  let output: string | undefined;
  let joinToken = false;

  for (let i = 0; i < flagArgs.length; i++) {
    const arg = flagArgs[i];
    if (arg === "--endpoint") {
      endpoint = flagArgs[++i];
      if (!endpoint) throw new Error("--endpoint requires a value.");
    } else if (arg === "--routes") {
      const raw = flagArgs[++i];
      if (!raw) throw new Error("--routes requires a value.");
      routes = raw.split(",").map((r) => r.trim()).filter(Boolean);
      for (const cidr of routes) {
        if (!isValidCidr(cidr)) throw new Error(`Invalid CIDR in --routes: ${cidr}`);
      }
    } else if (arg === "--output") {
      output = flagArgs[++i];
      if (!output) throw new Error("--output requires a value.");
    } else if (arg === "--join-token") {
      joinToken = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return { label, endpoint, routes, output, joinToken };
}

export function peerCommand(args: string[]): void {
  const [sub, ...rest] = args;

  switch (sub) {
    case "add": {
      let opts: ReturnType<typeof parseAddOptions>;
      try {
        opts = parseAddOptions(rest);
      } catch (err: any) {
        console.error(err.message);
        usage();
        process.exitCode = 1;
        return;
      }
      try {
        buildPeerOutput({ ...opts });
      } catch (err: any) {
        console.error(err.message);
        process.exitCode = 1;
      }
      return;
    }

    case "token": {
      const [label] = rest;
      if (!label) {
        usage();
        process.exitCode = 1;
        return;
      }
      if (!findPeerByLabel(label)) {
        console.error(`Peer "${label}" not found. Use \`wgctl peer ls\` to list peers.`);
        process.exitCode = 1;
        return;
      }
      try {
        buildPeerOutput({ label, joinToken: true, forLabel: label });
      } catch (err: any) {
        console.error(err.message);
        process.exitCode = 1;
      }
      return;
    }

    case "ls": {
      const peers = listAllPeers();
      if (peers.length === 0) {
        console.log("No peers.");
        return;
      }
      const live = getLiveStatus();
      for (const p of peers) {
        const liveEntry = live.find((l) => l.publicKey === p.public_key);
        const handshake = liveEntry?.lastHandshake ? liveEntry.lastHandshake.toISOString() : "never";
        const routeSuffix = p.routes ? ` — routes: ${p.routes}` : "";
        console.log(`  [${p.id}] ${p.label} — ${p.tunnel_ip}${routeSuffix} — last handshake: ${handshake}`);
      }
      return;
    }

    case "rm": {
      const [idOrLabel] = rest;
      if (!idOrLabel) {
        usage();
        process.exitCode = 1;
        return;
      }
      const id = Number(idOrLabel);
      const peer = Number.isInteger(id) && id > 0 ? findPeerById(id) : findPeerByLabel(idOrLabel);
      if (!peer) {
        console.error(`Peer "${idOrLabel}" not found.`);
        process.exitCode = 1;
        return;
      }
      removePeer(peer.public_key);
      removePeerFromConf(peer.public_key);
      deletePeer(peer.id);
      console.log(`Removed peer ${peer.id} (${peer.label}, ${peer.tunnel_ip}).`);
      return;
    }

    default:
      usage();
      process.exitCode = sub ? 1 : 0;
  }
}
