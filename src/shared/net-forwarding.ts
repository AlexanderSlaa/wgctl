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

export function ensureForwardRule(iface: string): void {
  const check = spawnSync("iptables", ["-C", "FORWARD", "-i", iface, "-o", iface, "-j", "ACCEPT"]);
  if (check.status !== 0) {
    execFileSync("iptables", ["-A", "FORWARD", "-i", iface, "-o", iface, "-j", "ACCEPT"]);
  }
}

export function removeForwardRule(iface: string): void {
  const check = spawnSync("iptables", ["-C", "FORWARD", "-i", iface, "-o", iface, "-j", "ACCEPT"]);
  if (check.status === 0) {
    execFileSync("iptables", ["-D", "FORWARD", "-i", iface, "-o", iface, "-j", "ACCEPT"]);
  }
}

export function ensureIpForward(sysctlFile = "/etc/sysctl.d/99-wireguard-orchestrator.conf"): void {
  writeFileSync(sysctlFile, "net.ipv4.ip_forward = 1\n");
  execFileSync("sysctl", ["-p", sysctlFile]);
}

/** Convenience: apply both the FORWARD rule and ip_forward sysctl for an interface. */
export function ensureForwarding(iface: string, sysctlFile?: string): void {
  ensureForwardRule(iface);
  ensureIpForward(sysctlFile);
}
