import { WireGuardClient } from "@sourceregistry/node-wireguard";
import { ensureForwarding, type RegisterPeerResponse } from "../shared/index.js";
import type { KeyPair } from "./config-store.js";

const WG_INTERFACE = "wg0";

/**
 * Applies a server's RegisterPeerResponse to the local wg0 interface —
 * shared by `connect` (first-time setup, after interactively choosing
 * networks/subnets) and `up` (re-applying a previous selection without
 * prompting). Throws on unexpected errors; the caller decides how to report
 * the EPERM/EACCES "needs sudo" case since the hint text differs per command.
 */
export async function applyLocalTunnel(params: {
  keyPair: KeyPair;
  result: RegisterPeerResponse;
  advertisedSubnets: string[];
}): Promise<void> {
  const { keyPair, result, advertisedSubnets } = params;

  const wg = new WireGuardClient();
  try {
    try {
      await wg.createDevice(WG_INTERFACE);
    } catch (err: any) {
      if (err?.code !== "EEXIST") throw err;
    }
    await wg.setAddress(WG_INTERFACE, result.clientAddress);
    await wg.configureDevice(WG_INTERFACE, {
      privateKey: keyPair.privateKey,
      peers: [
        {
          publicKey: result.serverPublicKey,
          endpoint: result.endpoint,
          allowedIPs: result.allowedIPs,
          replaceAllowedIPs: true,
          persistentKeepaliveInterval: result.persistentKeepalive,
        },
      ],
    });
    await wg.setUp(WG_INTERFACE);

    if (advertisedSubnets.length > 0) {
      ensureForwarding(WG_INTERFACE);
    }
  } finally {
    wg.close();
  }
}
