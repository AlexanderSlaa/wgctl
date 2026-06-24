import { getMyPeer, registerPeer, ApiError } from "../api-client.js";
import { loadKeyPair } from "../config-store.js";
import { resolveSession } from "../session-resolver.js";
import { applyLocalTunnel } from "../wg-apply.js";

/**
 * Brings the local tunnel back up after `wgctl down` (or a reboot), reusing
 * the same network selection and advertised subnets from the existing
 * server-side registration — no prompts. Re-registers (rather than just
 * replaying cached config) so a changed IP allocation or network grant on
 * the server side is picked up too.
 */
export async function upCommand(args: string[]): Promise<void> {
  const session = resolveSession(args);
  if (!session) {
    process.exitCode = 1;
    return;
  }

  const serverHost = new URL(session.serverUrl).host;
  const keyPair = loadKeyPair(serverHost);
  if (!keyPair) {
    console.error("No local key found for this server yet. Run `sudo wgctl connect` first.");
    process.exitCode = 1;
    return;
  }

  let peer;
  try {
    peer = await getMyPeer(session.serverUrl, session.token, session.certFingerprint);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      console.error("No existing registration found on the server. Run `sudo wgctl connect` first.");
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const result = await registerPeer(session.serverUrl, session.token, session.certFingerprint, {
    publicKey: keyPair.publicKey,
    networkIds: peer.networkIds,
    advertisedSubnets: peer.advertisedSubnets,
  });

  try {
    await applyLocalTunnel({ keyPair, result, advertisedSubnets: peer.advertisedSubnets });
  } catch (err: any) {
    if (err?.code === "EPERM" || err?.code === "EACCES") {
      console.error("Permission denied configuring the local WireGuard interface — re-run with sudo: `sudo wgctl up`.");
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  console.log(`Tunnel is up. Assigned address: ${result.clientAddress}`);
  console.log(`Routing through tunnel: ${result.allowedIPs.join(", ")}`);
  if (peer.advertisedSubnets.length > 0) {
    console.log(`Advertising local subnets behind this machine: ${peer.advertisedSubnets.join(", ")}`);
  }
}
