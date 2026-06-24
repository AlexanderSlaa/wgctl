// Commands that touch the local WireGuard interface, the systemd service,
// or the server's sqlite DB need CAP_NET_ADMIN/root. Rather than just
// failing with a permission error and telling the user to retype the
// command with `sudo`, re-exec the same invocation under sudo directly —
// sudo's own password prompt (inherited stdio) is the actual privilege-
// elevation confirmation here, same as if the user had typed `sudo` first.

import { spawnSync } from "node:child_process";

export function isRoot(): boolean {
  return typeof process.getuid === "function" && process.getuid() === 0;
}

/**
 * If not already root, re-execs the current process under sudo (passing
 * through every original argument) and exits with its result — never
 * returns in that case. Set WGCTL_NO_SUDO=1 to disable this and get the
 * plain permission error instead (e.g. for scripted use where an
 * unexpected interactive sudo prompt would just hang).
 */
export function ensureRoot(): void {
  if (isRoot() || process.env.WGCTL_NO_SUDO) return;

  console.error("This command needs root — re-running with sudo...");
  const result = spawnSync("sudo", process.argv.slice(1), { stdio: "inherit" });

  if (result.error) {
    console.error(
      `Could not find \`sudo\` (${result.error.message}). Re-run this command as root yourself, e.g.: ` +
        `sudo wgctl ${process.argv.slice(2).join(" ")}`,
    );
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}
