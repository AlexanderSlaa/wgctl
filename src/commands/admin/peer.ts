import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { generatePresharedKey, generatePrivateKey, publicKey } from "@sourceregistry/node-wireguard";
import { listAllPeers, findPeerById, findPeerByLabel, deletePeer, createPeer } from "../../server/db/peers.repo.js";
import { getDb } from "../../server/db/index.js";
import { getWgManager } from "../../server/wg/WgManager.js";
import { config } from "../../server/config.js";

const TOKEN_PREFIX = "wgctl-join-v1.";
const META_PREFIX = "join_token_hash:";

function usage(): void {
  console.log(`Usage:
  wgctl peer add <label> [--endpoint <host:port>] [--output <file>] [--join-token]
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

async function buildPeerOutput(params: {
  label: string;
  endpoint?: string;
  output?: string;
  joinToken: boolean;
  forLabel?: string;
}): Promise<void> {
  const wg = getWgManager();
  const serverPublicKey = (await wg.raw.device(config.wgInterface)).publicKey;
  const endpoint = params.endpoint ?? `${config.publicHost}:${config.wgListenPort}`;

  let peer = findPeerByLabel(params.label);
  let privKey: string;
  let psk: string;

  if (peer) {
    // Regenerating token for existing peer — generate new client keypair and preshared key,
    // then update the peer in WireGuard with the new public key.
    privKey = generatePrivateKey();
    const newPubKey = publicKey(privKey);
    psk = generatePresharedKey();
    getDb()
      .prepare("UPDATE peers SET public_key = ?, preshared_key = ? WHERE id = ?")
      .run(newPubKey, psk, peer.id);
    peer = findPeerByLabel(params.label)!;
    await wg.upsertPeer({
      publicKey: peer.public_key,
      presharedKey: psk,
      allowedIPs: [`${peer.tunnel_ip}/32`],
    });
  } else {
    privKey = generatePrivateKey();
    const peerPublicKey = publicKey(privKey);
    psk = generatePresharedKey();
    peer = createPeer({ label: params.label, publicKey: peerPublicKey, presharedKey: psk });
    try {
      await wg.upsertPeer({
        publicKey: peer.public_key,
        presharedKey: psk,
        allowedIPs: [`${peer.tunnel_ip}/32`],
      });
    } catch (err) {
      deletePeer(peer.id);
      throw err;
    }
    console.log(`Created peer ${peer.id} (${params.label}) — tunnel IP: ${peer.tunnel_ip}`);
  }

  const subnetPrefixLength = config.wgSubnet.split("/")[1];
  const clientAddress = `${peer.tunnel_ip}/${subnetPrefixLength}`;
  // Clients route the entire tunnel subnet so all peers can reach each other.
  const allowedIPs = [config.wgSubnet];

  const tokenPayload = {
    label: params.label,
    privateKey: privKey,
    presharedKey: psk,
    clientAddress,
    serverPublicKey,
    endpoint,
    allowedIPs,
    persistentKeepalive: config.persistentKeepalive,
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

function parseAddOptions(rest: string[]): { label: string; endpoint?: string; output?: string; joinToken: boolean } {
  const [label, ...flagArgs] = rest;
  if (!label || label.startsWith("--")) throw new Error("Usage: wgctl peer add <label> [options]");

  let endpoint: string | undefined;
  let output: string | undefined;
  let joinToken = false;

  for (let i = 0; i < flagArgs.length; i++) {
    const arg = flagArgs[i];
    if (arg === "--endpoint") {
      endpoint = flagArgs[++i];
      if (!endpoint) throw new Error("--endpoint requires a value.");
    } else if (arg === "--output") {
      output = flagArgs[++i];
      if (!output) throw new Error("--output requires a value.");
    } else if (arg === "--join-token") {
      joinToken = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return { label, endpoint, output, joinToken };
}

export async function peerCommand(args: string[]): Promise<void> {
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
        await buildPeerOutput({ ...opts });
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
        await buildPeerOutput({ label, joinToken: true, forLabel: label });
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
      const live = await getWgManager().getLiveStatus().catch(() => []);
      for (const p of peers) {
        const liveEntry = live.find((l) => l.publicKey === p.public_key);
        const handshake = liveEntry?.lastHandshakeTime ? liveEntry.lastHandshakeTime.toISOString() : "never";
        console.log(`  [${p.id}] ${p.label} — ${p.tunnel_ip} — last handshake: ${handshake}`);
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
      await getWgManager().removePeer(peer.public_key);
      deletePeer(peer.id);
      console.log(`Removed peer ${peer.id} (${peer.label}, ${peer.tunnel_ip}).`);
      return;
    }

    default:
      usage();
      process.exitCode = sub ? 1 : 0;
  }
}
