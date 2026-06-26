import { generatePresharedKey, generatePrivateKey, publicKey } from "@sourceregistry/node-wireguard";
import { writeFileSync } from "node:fs";
import { isValidCidr, cidrsOverlap } from "../../shared/index.js";
import { listAllPeers, findPeerById, deletePeer, createManualPeer, listAdvertisedSubnetsExcluding } from "../../server/db/peers.repo.js";
import { findNetworkByName, getNetworksByIds, listAllNetworks } from "../../server/db/networks.repo.js";
import { getWgManager } from "../../server/wg/WgManager.js";
import { config } from "../../server/config.js";
import { findUserByUsername } from "../../server/db/users.repo.js";

function usage(): void {
  console.log(`Usage:
  wgctl peer add <label> [--network <name>]... [--advertise <cidr>]... [--dns <servers>] [--endpoint <host:port>] [--output <file>] [--join-token]
  wgctl peer ls
  wgctl peer rm <id> [--force]`);
}

interface AddOptions {
  label: string;
  networkNames: string[];
  advertisedSubnets: string[];
  dns?: string;
  endpoint?: string;
  output?: string;
  joinToken: boolean;
}

function readFlagValues(args: string[], longFlag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === longFlag) {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`${longFlag} requires a value.`);
      values.push(value);
      i++;
    }
  }
  return values;
}

function readOptionalFlag(args: string[], longFlag: string): string | undefined {
  const values = readFlagValues(args, longFlag);
  if (values.length > 1) throw new Error(`${longFlag} can only be provided once.`);
  return values[0];
}

function parseAddOptions(rest: string[]): AddOptions {
  const [label] = rest;
  if (!label || label.startsWith("--")) throw new Error("Usage: wgctl peer add <label> [--network <name>]...");

  const supportedFlags = new Set(["--network", "--advertise", "--dns", "--endpoint", "--output", "--join-token"]);
  for (let i = 1; i < rest.length; i++) {
    const arg = rest[i];
    if (!supportedFlags.has(arg)) throw new Error(`Unknown option: ${arg}`);
    if (arg === "--join-token") continue;
    i++;
    if (!rest[i] || rest[i].startsWith("--")) throw new Error(`${arg} requires a value.`);
  }

  const flagArgs = rest.slice(1);
  return {
    label,
    networkNames: readFlagValues(flagArgs, "--network"),
    advertisedSubnets: readFlagValues(flagArgs, "--advertise"),
    dns: readOptionalFlag(flagArgs, "--dns"),
    endpoint: readOptionalFlag(flagArgs, "--endpoint"),
    output: readOptionalFlag(flagArgs, "--output"),
    joinToken: flagArgs.includes("--join-token"),
  };
}

function validateAdvertisedSubnets(subnets: string[], label: string): void {
  for (const subnet of subnets) {
    if (!isValidCidr(subnet)) {
      throw new Error(`Invalid CIDR in --advertise: ${subnet}`);
    }
    const prefixLen = parseInt(subnet.split("/")[1] ?? "", 10);
    if (Number.isNaN(prefixLen) || prefixLen < 8) {
      throw new Error(`Advertised subnet ${subnet} must have a prefix length of /8 or longer.`);
    }
  }

  for (const subnet of subnets) {
    for (const network of listAllNetworks()) {
      if (cidrsOverlap(subnet, network.cidr)) {
        throw new Error(`Advertised subnet ${subnet} overlaps network "${network.name}" (${network.cidr}).`);
      }
    }
    for (const existing of listAdvertisedSubnetsExcluding(label)) {
      if (cidrsOverlap(subnet, existing)) {
        throw new Error(`Advertised subnet ${subnet} overlaps an existing peer subnet (${existing}).`);
      }
    }
  }
}

function resolveNetworkIds(names: string[]): number[] {
  const ids: number[] = [];
  for (const name of names) {
    const network = findNetworkByName(name);
    if (!network) throw new Error(`Network "${name}" not found.`);
    ids.push(network.id);
  }
  if (new Set(ids).size !== ids.length) throw new Error("The same network was selected more than once.");
  return ids;
}

function renderClientConfig(params: {
  privateKey: string;
  presharedKey: string;
  clientAddress: string;
  serverPublicKey: string;
  endpoint: string;
  allowedIPs: string[];
  dns?: string;
}): string {
  const lines = [
    "[Interface]",
    `PrivateKey = ${params.privateKey}`,
    `Address = ${params.clientAddress}`,
  ];
  if (params.dns) lines.push(`DNS = ${params.dns}`);
  lines.push(
    "",
    "[Peer]",
    `PublicKey = ${params.serverPublicKey}`,
    `PresharedKey = ${params.presharedKey}`,
    `Endpoint = ${params.endpoint}`,
    `AllowedIPs = ${params.allowedIPs.join(", ")}`,
    `PersistentKeepalive = ${config.persistentKeepalive}`,
  );
  return lines.join("\n") + "\n";
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
  dns?: string;
}): string {
  const body = Buffer.from(JSON.stringify({ version: 1, ...params }), "utf8").toString("base64url");
  return `wgctl-join-v1.${body}`;
}

export async function peerCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args;

  switch (sub) {
    case "add": {
      let options: AddOptions;
      try {
        options = parseAddOptions(rest);
        validateAdvertisedSubnets(options.advertisedSubnets, options.label);
      } catch (err: any) {
        console.error(err.message);
        usage();
        process.exitCode = 1;
        return;
      }

      let networkIds: number[];
      try {
        if (findUserByUsername(options.label)) {
          throw new Error(`"${options.label}" is an existing user. Pick a device label that is not a username.`);
        }
        networkIds = resolveNetworkIds(options.networkNames);
      } catch (err: any) {
        console.error(err.message);
        process.exitCode = 1;
        return;
      }

      const privateKey = generatePrivateKey();
      const peerPublicKey = publicKey(privateKey);
      const presharedKey = generatePresharedKey();
      const endpoint = options.endpoint ?? `${config.publicHost}:${config.wgListenPort}`;
      const serverPublicKey = (await getWgManager().raw.device(config.wgInterface)).publicKey;
      let peer;
      try {
        peer = createManualPeer({
          label: options.label,
          publicKey: peerPublicKey,
          presharedKey,
          advertisedSubnets: options.advertisedSubnets,
          networkIds,
        });
      } catch (err: any) {
        console.error(err.message);
        process.exitCode = 1;
        return;
      }

      try {
        await getWgManager().upsertPeer({
          publicKey: peer.public_key,
          presharedKey,
          allowedIPs: [`${peer.tunnel_ip}/32`, ...options.advertisedSubnets],
        });
      } catch (err) {
        deletePeer(peer.id);
        throw err;
      }

      const networks = getNetworksByIds(networkIds);
      const subnetPrefixLength = config.wgSubnet.split("/")[1];
      const clientAddress = `${peer.tunnel_ip}/${subnetPrefixLength}`;
      const allowedIPs = [config.wgSubnet, ...networks.map((n) => n.cidr)];
      const clientConfig = renderClientConfig({
        privateKey,
        presharedKey,
        clientAddress,
        serverPublicKey,
        endpoint,
        allowedIPs,
        dns: options.dns,
      });

      console.log(`Created peer ${peer.id} (${options.label}).`);
      if (options.joinToken) {
        console.log("Run this on the other server:\n");
        console.log(
          `sudo wgctl join '${encodeJoinToken({
            label: options.label,
            privateKey,
            presharedKey,
            clientAddress,
            serverPublicKey,
            endpoint,
            allowedIPs,
            persistentKeepalive: config.persistentKeepalive,
            dns: options.dns,
          })}'`,
        );
      } else if (options.output) {
        try {
          writeFileSync(options.output, clientConfig, { mode: 0o600 });
        } catch (err) {
          await getWgManager().removePeer(peer.public_key).catch(() => undefined);
          deletePeer(peer.id);
          throw err;
        }
        console.log(`Wrote WireGuard config to ${options.output}.`);
      } else {
        console.log("Import this config into the WireGuard app:\n");
        console.log(clientConfig);
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
        const networkIds: number[] = JSON.parse(p.network_ids);
        const networks = getNetworksByIds(networkIds).map((n) => n.name);
        const advertised: string[] = JSON.parse(p.advertised_subnets);
        const liveEntry = live.find((l) => l.publicKey === p.public_key);
        const handshake = liveEntry?.lastHandshakeTime ? liveEntry.lastHandshakeTime.toISOString() : "never";
        const tag = p.is_static ? " [static]" : "";
        console.log(
          `  [${p.id}]${tag} ${p.username} — ${p.public_key} — ${p.tunnel_ip}` +
            `${networks.length ? ` — networks: ${networks.join(",")}` : ""}` +
            `${advertised.length ? ` — advertises: ${advertised.join(",")}` : ""}` +
            ` — last handshake: ${handshake}`,
        );
      }
      return;
    }
    case "rm": {
      const force = rest.includes("--force");
      const [idStr] = rest.filter((a) => a !== "--force");
      const id = Number(idStr);
      if (!idStr || !Number.isInteger(id)) {
        usage();
        process.exitCode = 1;
        return;
      }
      const peer = findPeerById(id);
      if (!peer) {
        console.error(`Peer ${id} not found.`);
        process.exitCode = 1;
        return;
      }
      if (peer.is_static && !force) {
        console.error(
          `Peer ${id} is a static peer (migrated from the original wg0.conf) and can't be removed this way. ` +
            `Use --force to remove it anyway.`,
        );
        process.exitCode = 1;
        return;
      }
      await getWgManager().removePeer(peer.public_key);
      deletePeer(peer.id);
      console.log(`Removed peer ${id} (${peer.username}, ${peer.public_key}).`);
      if (peer.is_static) {
        console.log(
          `Note: this peer was originally read from /etc/wireguard/wg0.conf. ` +
            `\`wgctl serve\` re-parses that file on every restart and will re-add this peer unless you also remove ` +
            `its [Peer] block from /etc/wireguard/wg0.conf.`,
        );
      }
      return;
    }
    default:
      usage();
      process.exitCode = sub ? 1 : 0;
  }
}
