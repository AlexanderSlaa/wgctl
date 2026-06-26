import { WireGuardClient } from "@sourceregistry/node-wireguard";
import { config } from "../../server/config.js";

function parseArgs(args: string[]): { iface: string } {
  let iface = config.wgInterface;
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--interface" || args[i] === "-i") && args[i + 1]) {
      iface = args[++i];
    }
  }
  return { iface };
}

export async function statusCommand(args: string[] = []): Promise<void> {
  const { iface } = parseArgs(args);
  const wg = new WireGuardClient();
  try {
    const device = await wg.device(iface);
    console.log(`Interface: ${device.name}  public-key: ${device.publicKey}  port: ${device.listenPort}`);
    if (device.peers.length === 0) {
      console.log("No peers.");
      return;
    }
    for (const peer of device.peers) {
      const handshake = peer.lastHandshakeTime ? peer.lastHandshakeTime.toISOString() : "never";
      const allowedIPs = peer.allowedIPs.join(", ");
      const endpoint = peer.endpoint ?? "(no endpoint)";
      console.log(`  ${peer.publicKey}  ${allowedIPs}  ${endpoint}  handshake: ${handshake}  rx: ${peer.receiveBytes}  tx: ${peer.transmitBytes}`);
    }
  } catch (err: any) {
    if (err?.code === "ENODEV") {
      console.log(`Interface ${iface} is not up. Run \`wgctl serve\` or \`systemctl start wgctl-${iface}\`.`);
      return;
    }
    throw err;
  } finally {
    wg.close();
  }
}
