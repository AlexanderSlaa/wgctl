import { Router, json, error, enhance } from "@sourceregistry/node-webserver";
import { isValidCidr, cidrsOverlap } from "../../shared/index.js";
import type { RegisterPeerRequest, RegisterPeerResponse, PeerStatusResponse } from "../../shared/index.js";
import { withAuth } from "../auth/index.js";
import { findUserByUsername } from "../db/users.repo.js";
import { listAllNetworks, getNetworksByIds, listNetworksForUser } from "../db/networks.repo.js";
import {
  upsertUserPeer,
  findPeerByUsername,
  findPeerById,
  deletePeer,
  listAdvertisedSubnetsExcluding,
} from "../db/peers.repo.js";
import { getWgManager } from "../wg/WgManager.js";
import { config } from "../config.js";

export const peersRoutes = new Router();

const MAX_NETWORK_IDS = 16;
const MAX_ADVERTISED_SUBNETS = 8;
// WireGuard keys are Curve25519 public keys: 32 bytes encoded as standard base64 (44 chars, 1 padding '=').
const WG_KEY_RE = /^[A-Za-z0-9+/]{43}=$/;

function subnetOverlapsExisting(candidate: string, excludeUsername: string): boolean {
  for (const n of listAllNetworks()) {
    if (cidrsOverlap(candidate, n.cidr)) return true;
  }
  for (const other of listAdvertisedSubnetsExcluding(excludeUsername)) {
    if (cidrsOverlap(candidate, other)) return true;
  }
  return false;
}

peersRoutes.POST(
  "/peers",
  enhance(async (event) => {
    const body = (await event.request.json()) as RegisterPeerRequest;
    if (!body?.publicKey || !Array.isArray(body.networkIds) || !Array.isArray(body.advertisedSubnets)) {
      error(400, { message: "publicKey, networkIds[], advertisedSubnets[] are required" });
    }

    // Validate public key format: 32-byte Curve25519 key, standard base64
    if (typeof body.publicKey !== "string" || !WG_KEY_RE.test(body.publicKey)) {
      error(400, { message: "publicKey must be a valid 32-byte base64-encoded WireGuard key" });
    }

    // Array size limits
    if (body.networkIds.length > MAX_NETWORK_IDS) {
      error(400, { message: `At most ${MAX_NETWORK_IDS} networks may be selected at once` });
    }
    if (body.advertisedSubnets.length > MAX_ADVERTISED_SUBNETS) {
      error(400, { message: `At most ${MAX_ADVERTISED_SUBNETS} subnets may be advertised at once` });
    }

    // Network IDs must be positive integers with no duplicates
    if (!body.networkIds.every((id) => Number.isInteger(id) && id > 0)) {
      error(400, { message: "networkIds must be positive integers" });
    }
    if (new Set(body.networkIds).size !== body.networkIds.length) {
      error(400, { message: "networkIds must not contain duplicates" });
    }

    const user = findUserByUsername(event.context.user.username)!;
    const authorized = new Set(listNetworksForUser(user.id).map((n) => n.id));
    for (const id of body.networkIds) {
      if (!authorized.has(id)) {
        error(403, { message: `Not authorized for network ${id}` });
      }
    }

    for (const subnet of body.advertisedSubnets) {
      if (typeof subnet !== "string" || !isValidCidr(subnet)) {
        error(400, { message: `Invalid CIDR in advertisedSubnets: ${subnet}` });
      }
      // Reject overly broad prefixes (/0–/7) to prevent accidental default-route advertisements
      const prefixLen = parseInt(subnet.split("/")[1] ?? "", 10);
      if (Number.isNaN(prefixLen) || prefixLen < 8) {
        error(400, { message: `Advertised subnet ${subnet} must have a prefix length of /8 or longer` });
      }
    }
    for (const subnet of body.advertisedSubnets) {
      if (subnetOverlapsExisting(subnet, user.username)) {
        error(409, { message: `Advertised subnet ${subnet} overlaps an existing network or peer subnet` });
      }
    }

    const selectedNetworks = getNetworksByIds(body.networkIds);

    const peer = upsertUserPeer({
      username: user.username,
      publicKey: body.publicKey,
      advertisedSubnets: body.advertisedSubnets,
      networkIds: body.networkIds,
    });

    const wg = getWgManager();
    await wg.upsertPeer({
      publicKey: peer.public_key,
      allowedIPs: [`${peer.tunnel_ip}/32`, ...body.advertisedSubnets],
    });

    const subnetPrefixLength = config.wgSubnet.split("/")[1];
    const response: RegisterPeerResponse = {
      serverPublicKey: (await wg.raw.device(config.wgInterface)).publicKey,
      endpoint: `${config.publicHost}:${config.wgListenPort}`,
      clientAddress: `${peer.tunnel_ip}/${subnetPrefixLength}`,
      allowedIPs: [config.wgSubnet, ...selectedNetworks.map((n) => n.cidr)],
      persistentKeepalive: config.persistentKeepalive,
    };
    return json(response, { status: 201 });
  }, withAuth),
);

peersRoutes.DELETE(
  "/peers/[id]",
  enhance(async (event) => {
    const id = Number(event.params.id);
    const peer = findPeerById(id);
    if (!peer) {
      error(404, { message: "Peer not found" });
    }
    if (peer.is_static) {
      error(403, { message: "Cannot delete a static peer" });
    }
    if (peer.username !== event.context.user.username && event.context.user.role !== "admin") {
      error(403, { message: "Not authorized to delete this peer" });
    }
    await getWgManager().removePeer(peer.public_key);
    deletePeer(peer.id);
    return new Response(null, { status: 204 });
  }, withAuth),
);

peersRoutes.GET(
  "/peers/me",
  enhance(async (event) => {
    const peer = findPeerByUsername(event.context.user.username);
    if (!peer) {
      error(404, { message: "No peer registered" });
    }
    const live = await getWgManager().getLiveStatus();
    const liveEntry = live.find((p) => p.publicKey === peer.public_key);

    const response: PeerStatusResponse = {
      id: peer.id,
      publicKey: peer.public_key,
      tunnelIp: peer.tunnel_ip,
      networkIds: JSON.parse(peer.network_ids),
      advertisedSubnets: JSON.parse(peer.advertised_subnets),
      lastHandshake: liveEntry?.lastHandshakeTime ? liveEntry.lastHandshakeTime.toISOString() : null,
      rxBytes: String(liveEntry?.receiveBytes ?? 0n),
      txBytes: String(liveEntry?.transmitBytes ?? 0n),
    };
    return json(response, { status: 200 });
  }, withAuth),
);
