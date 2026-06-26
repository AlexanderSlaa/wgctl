import { realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";

function globalNpmPrefix(): string {
  const binPath = realpathSync(process.argv[1]);
  const idx = binPath.lastIndexOf("/node_modules/");
  if (idx !== -1) return binPath.slice(0, idx);
  const r = spawnSync("npm", ["config", "get", "prefix"], { encoding: "utf8" });
  return r.stdout.trim();
}

/**
 * Ensures the native WireGuard addon is ready before a command runs.
 *
 * - Loads fine → returns immediately.
 * - ERR_DLOPEN_FAILED (missing runtime .so) → rethrows; main()'s catch prints
 *   the apt/dnf install hint.
 * - Any other error (no prebuild for this platform, npm install-scripts were
 *   skipped) → runs `npm rebuild`, then re-execs the current process so the
 *   freshly built addon loads without hitting the ESM import cache.
 *
 * Must be called after ensureRoot() so that the build step has the required
 * permissions.
 */
export async function ensureNativeAddon(): Promise<void> {
  try {
    await import("@sourceregistry/node-wireguard");
    return;
  } catch (err: any) {
    if (err?.code === "ERR_DLOPEN_FAILED") throw err;
    // Addon not built yet — fall through to rebuild.
  }

  console.log("Native WireGuard addon not built (npm install-scripts were likely skipped).");
  console.log("Building now — requires build-essential, libmnl-dev, libssl-dev...\n");
  const prefix = globalNpmPrefix();
  const build = spawnSync(
    "npm",
    ["rebuild", "@sourceregistry/node-wireguard", `--prefix=${prefix}`],
    { stdio: "inherit" },
  );
  if (build.status !== 0) {
    console.error(
      "\nBuild failed. Install build tools first:\n" +
        "  Debian/Ubuntu:  apt-get install -y build-essential python3 libmnl-dev libssl-dev\n" +
        "  Fedora/RHEL:    dnf install -y gcc-c++ python3 make libmnl-devel openssl-devel\n\n" +
        "Then re-run the command.\n",
    );
    process.exit(1);
  }
  console.log("\nBuild OK — restarting command...\n");
  // ESM import cache cannot be cleared in-process, so re-exec so the fresh build loads cleanly.
  const rerun = spawnSync(process.argv[0], process.argv.slice(1), { stdio: "inherit" });
  process.exit(rerun.status ?? 1);
}
