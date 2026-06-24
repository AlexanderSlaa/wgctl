import { WireGuardClient } from "@sourceregistry/node-wireguard";
import { deletePeer, getMyPeer } from "../api-client.js";
import { loadSession } from "../config-store.js";
import { askText } from "../prompts.js";

const WG_INTERFACE = "wg0";

export async function downCommand(): Promise<void> {
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

  const session = loadSession();
  if (!session) return;

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
