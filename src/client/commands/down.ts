import { WireGuardClient } from "@sourceregistry/node-wireguard";
import { deletePeer, getMyPeer } from "../api-client.js";
import { loadSession } from "../config-store.js";
import { parseServerFlag, resolveSession } from "../session-resolver.js";
import { askText } from "../prompts.js";

const WG_INTERFACE = "wg0";

export async function downCommand(args: string[]): Promise<void> {
  const wg = new WireGuardClient();
  try {
    await wg.setDown(WG_INTERFACE);
    await wg.deleteDevice(WG_INTERFACE);
    console.log(`Local interface ${WG_INTERFACE} brought down and removed.`);
  } catch (err: any) {
    if (err?.code === "ENODEV") {
      console.log(`Interface ${WG_INTERFACE} was not up.`);
    } else if (err?.code === "EPERM" || err?.code === "EACCES") {
      console.error("Permission denied — re-run with sudo: `sudo wgctl down`.");
      process.exitCode = 1;
      return;
    } else {
      throw err;
    }
  } finally {
    wg.close();
  }

  // Only error loudly if --server was explicitly given (clear intent to
  // deregister a specific server) — otherwise silently skip the optional
  // server-side deregistration step when there's no session to use.
  const serverUrl = parseServerFlag(args);
  const session = serverUrl ? resolveSession(args) : loadSession();
  if (!session) {
    if (serverUrl) process.exitCode = 1;
    return;
  }

  const answer = await askText("Also remove this device's registration from the server? [y/N]: ");
  if (answer.trim().toLowerCase() !== "y") return;

  const peer = await getMyPeer(session.serverUrl, session.token, session.certFingerprint).catch(() => undefined);
  if (!peer) {
    console.log("No server-side registration found.");
    return;
  }
  await deletePeer(session.serverUrl, session.token, session.certFingerprint, peer.id);
  console.log("Server-side registration removed.");
}
