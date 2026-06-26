import { execFileSync, spawnSync } from "node:child_process";
import { config } from "../config.js";
import { ensureNetworkForwarding } from "./iptables.js";
import { reconcileFromDb } from "./WgManager.js";

function isInterfaceUp(): boolean {
  return spawnSync("ip", ["link", "show", config.wgInterface], { stdio: "ignore" }).status === 0;
}

function checkWgQuick(): void {
  if (spawnSync("which", ["wg-quick"], { stdio: "ignore" }).status !== 0) {
    throw new Error(
      "wg-quick not found. Install wireguard-tools:\n\n" +
        "  Debian/Ubuntu:  apt-get install wireguard-tools\n" +
        "  Fedora/RHEL:    dnf install wireguard-tools\n",
    );
  }
}

export function bootstrapWireGuard(): void {
  checkWgQuick();

  // Stop wg-quick@<iface> if active so we don't fight over the interface.
  const wgQuickUnit = `wg-quick@${config.wgInterface}`;
  if (spawnSync("systemctl", ["is-active", "--quiet", wgQuickUnit], { stdio: "ignore" }).status === 0) {
    execFileSync("systemctl", ["stop", wgQuickUnit], { stdio: "ignore" });
  }

  if (!isInterfaceUp()) {
    try {
      execFileSync("wg-quick", ["up", config.wgInterface], { stdio: "inherit" });
    } catch (err: any) {
      if (err?.code === "ENOENT" || (err?.message ?? "").includes("No such file")) {
        const e = new Error(`No WireGuard config found at ${config.wgConfPath}.\n\nRun: wgctl setup\n`) as any;
        e.code = "ENOENT";
        e.path = config.wgConfPath;
        throw e;
      }
      throw err;
    }
  }

  ensureNetworkForwarding();
  reconcileFromDb();
}
