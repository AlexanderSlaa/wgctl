// Idempotent "ensure this box forwards traffic for a WireGuard interface"
// helper, shared by the server (for wg0) and the CLI (for a client that
// advertised local subnets and must forward/NAT for them too).
//
// Deliberately minimal: mirrors exactly what the original /etc/wireguard/wg0.conf
// PostUp/PostDown pair did — a single FORWARD ACCEPT rule between the
// interface and itself, plus net.ipv4.ip_forward=1. No NAT/MASQUERADE rule is
// added because the existing live config never had one (pure hub-and-spoke
// relay, not internet-egress NAT) — do not add one here without that being a
// deliberate, separate decision.

import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

function missingCommandError(command: string): Error {
  return new Error(
    `Required command \`${command}\` was not found.\n\n` +
      "Install wgctl's runtime system dependencies, then restart the service:\n\n" +
      "  Debian/Ubuntu:  apt-get update && apt-get install -y --no-install-recommends iptables procps\n" +
      "  Fedora/RHEL:    dnf install -y iptables procps-ng\n" +
      "  Alpine:         apk add iptables procps\n",
  );
}

export function ensureForwardRule(iface: string): void {
  const check = spawnSync("iptables", ["-C", "FORWARD", "-i", iface, "-o", iface, "-j", "ACCEPT"]);
  if (check.error && (check.error as NodeJS.ErrnoException).code === "ENOENT") {
    throw missingCommandError("iptables");
  }
  if (check.status !== 0) {
    try {
      execFileSync("iptables", ["-A", "FORWARD", "-i", iface, "-o", iface, "-j", "ACCEPT"]);
    } catch (err: any) {
      if (err?.code === "ENOENT") throw missingCommandError("iptables");
      throw err;
    }
  }
}

export function removeForwardRule(iface: string): void {
  const check = spawnSync("iptables", ["-C", "FORWARD", "-i", iface, "-o", iface, "-j", "ACCEPT"]);
  if (check.error && (check.error as NodeJS.ErrnoException).code === "ENOENT") {
    return;
  }
  if (check.status === 0) {
    execFileSync("iptables", ["-D", "FORWARD", "-i", iface, "-o", iface, "-j", "ACCEPT"]);
  }
}

export function ensureIpForward(sysctlFile = "/etc/sysctl.d/99-wireguard-orchestrator.conf"): void {
  writeFileSync(sysctlFile, "net.ipv4.ip_forward = 1\n");
  try {
    execFileSync("sysctl", ["-p", sysctlFile]);
  } catch (err: any) {
    if (err?.code === "ENOENT") throw missingCommandError("sysctl");
    throw err;
  }
}

/** Convenience: apply both the FORWARD rule and ip_forward sysctl for an interface. */
export function ensureForwarding(iface: string, sysctlFile?: string): void {
  ensureForwardRule(iface);
  ensureIpForward(sysctlFile);
}
