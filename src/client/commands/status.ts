import { WireGuardClient } from "@sourceregistry/node-wireguard";

const WG_INTERFACE = "wg0";

export async function statusCommand(): Promise<void> {
  const wg = new WireGuardClient();
  try {
    const device = await wg.device(WG_INTERFACE);
    console.log(`Interface ${device.name} (${device.type}), public key: ${device.publicKey}`);
    if (device.peers.length === 0) {
      console.log("No peers configured.");
      return;
    }
    for (const peer of device.peers) {
      const handshake = peer.lastHandshakeTime ? peer.lastHandshakeTime.toISOString() : "never";
      console.log(
        `  Peer ${peer.publicKey}: handshake=${handshake} rx=${peer.receiveBytes} tx=${peer.transmitBytes} allowedIPs=${peer.allowedIPs.join(",")}`,
      );
    }
  } catch (err: any) {
    if (err?.code === "ENODEV") {
      console.log(`Interface ${WG_INTERFACE} is not up. Run \`sudo wgctl connect\` first.`);
      return;
    }
    if (err?.code === "EPERM" || err?.code === "EACCES") {
      console.error("Permission denied reading the local WireGuard interface — re-run with sudo: `sudo wgctl status`.");
      process.exitCode = 1;
      return;
    }
    throw err;
  } finally {
    wg.close();
  }
}
