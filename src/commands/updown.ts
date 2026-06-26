import { execFileSync, spawnSync } from "node:child_process";

function parseArgs(args: string[]): { iface: string } {
  let iface = "wg0";
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--interface" || args[i] === "-i") && args[i + 1]) {
      iface = args[++i];
    }
  }
  return { iface };
}

function unitFor(iface: string): string | undefined {
  // Joined peer: wg-quick@<iface>  |  Hub server: wgctl-<iface>
  for (const unit of [`wg-quick@${iface}`, `wgctl-${iface}`]) {
    const r = spawnSync("systemctl", ["cat", unit], { stdio: "ignore" });
    if (r.status === 0) return unit;
  }
  return undefined;
}

export function downCommand(args: string[]): void {
  const { iface } = parseArgs(args);
  const unit = unitFor(iface);
  if (!unit) {
    console.error(`No wgctl-managed unit found for interface ${iface}.`);
    process.exitCode = 1;
    return;
  }
  execFileSync("systemctl", ["stop", unit], { stdio: "inherit" });
  console.log(`Stopped ${unit}.`);
}

export function upCommand(args: string[]): void {
  const { iface } = parseArgs(args);
  const unit = unitFor(iface);
  if (!unit) {
    console.error(`No wgctl-managed unit found for interface ${iface}.`);
    console.error(`Run \`wgctl join <token>\` to join an overlay, or \`wgctl setup\` to configure a hub.`);
    process.exitCode = 1;
    return;
  }
  execFileSync("systemctl", ["start", unit], { stdio: "inherit" });
  console.log(`Started ${unit}.`);
}
