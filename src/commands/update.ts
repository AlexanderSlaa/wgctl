import { execFileSync } from "node:child_process";
import { getInstalledVersion, fetchLatestVersion } from "../version-check.js";

export async function updateCommand(): Promise<void> {
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
  console.log("If wgctl is running as a systemd service, restart it to apply the update: `sudo systemctl restart wgctl`.");
}
