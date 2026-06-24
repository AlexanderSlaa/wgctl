import { execFileSync, spawnSync } from "node:child_process";
import { getInstalledVersion, fetchLatestVersion } from "../version-check.js";
import { askText } from "../client/prompts.js";

function isServiceActive(): boolean {
  return spawnSync("systemctl", ["is-active", "--quiet", "wgctl"]).status === 0;
}

export async function updateCommand(args: string[] = []): Promise<void> {
  const current = getInstalledVersion();
  console.log(`Current version: ${current}`);
  console.log("Checking npm for the latest version...");

  const latest = fetchLatestVersion(10000);
  if (!latest) {
    console.error("Could not check npm for the latest version (offline, registry unreachable, or not published yet).");
    process.exitCode = 1;
    return;
  }

  if (latest === current) {
    console.log(`Already up to date (${current}).`);
    return;
  }

  const serviceActive = isServiceActive();

  if (!args.includes("-y") && !args.includes("--yes")) {
    console.log(`This will run \`npm install -g wgctl@${latest}\`, replacing the installed files (current: ${current}).`);
    if (serviceActive) {
      console.log(
        "wgctl is currently running as a systemd service. Installing the new files does NOT by itself interrupt the " +
          "running daemon or any existing WireGuard tunnels — the kernel keeps wg0 and its peers up independently of " +
          "the wgctl process. But the new version only takes effect after you restart the service, and that restart " +
          "DOES briefly drop the HTTPS control-plane API (so any login/connect/peer-registration in progress at that " +
          "exact moment would need to retry) for the few seconds it takes to come back up — existing tunnels are " +
          "unaffected throughout, since bootstrap reuses wg0 rather than recreating it when the key already matches.",
      );
    } else {
      console.log("This does not affect any other running process.");
    }
    const answer = await askText("Continue? [y/N]: ");
    if (answer.trim().toLowerCase() !== "y") {
      console.log("Aborted — nothing was changed.");
      return;
    }
  }

  console.log(`Updating wgctl: ${current} -> ${latest}...`);
  try {
    execFileSync("npm", ["install", "-g", `wgctl@${latest}`], { stdio: "inherit" });
  } catch {
    console.error(
      "Update failed. If this isn't a permissions issue (try `sudo wgctl update`), update manually with `npm install -g wgctl@latest`.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Updated to ${latest}.`);
  if (serviceActive) {
    console.log("Restart the service to apply it: `sudo systemctl restart wgctl` (existing tunnels are unaffected by this restart).");
  }
}
