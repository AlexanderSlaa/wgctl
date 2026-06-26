import { spawnSync } from "node:child_process";
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

export function statusCommand(args: string[] = []): void {
  const { iface } = parseArgs(args);
  const result = spawnSync("wg", ["show", iface, "dump"], { encoding: "utf8" });

  if (result.status !== 0) {
    console.log(`Interface ${iface} is not up. Run \`systemctl start wgctl-${iface}\`.`);
    return;
  }

  const lines = (result.stdout ?? "").trim().split("\n").filter(Boolean);
  if (lines.length === 0) return;

  // First line is the interface: private-key, public-key, listen-port, fwmark
  const [, ifacePubKey, listenPort] = lines[0].split("\t");
  console.log(`Interface: ${iface}  public-key: ${ifacePubKey}  port: ${listenPort}`);

  if (lines.length === 1) {
    console.log("No peers.");
    return;
  }

  for (const line of lines.slice(1)) {
    const [pubkey, , endpoint, allowedIPs, lastHandshakeUnix, rx, tx] = line.split("\t");
    const ts = Number(lastHandshakeUnix);
    const handshake = ts > 0 ? new Date(ts * 1000).toISOString() : "never";
    const ep = endpoint === "(none)" ? "no endpoint" : endpoint;
    console.log(`  ${pubkey}  ${allowedIPs}  ${ep}  handshake: ${handshake}  rx: ${rx}  tx: ${tx}`);
  }
}
