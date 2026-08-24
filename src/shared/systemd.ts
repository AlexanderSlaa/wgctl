import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * True when systemd is actually running as PID 1 (not just installed).
 * `/run/systemd/system` only exists under real systemd — the standard
 * detection used by systemd itself (sd_booted(3)). This is what's absent
 * in containers/k8s pods, so callers fall back to driving wg-quick
 * directly instead of through a systemd unit.
 */
export function hasSystemd(): boolean {
  if (process.env.WGCTL_NO_SYSTEMD === "1") return false;
  if (!existsSync("/run/systemd/system")) return false;
  return spawnSync("systemctl", ["--version"], { stdio: "ignore" }).status === 0;
}
