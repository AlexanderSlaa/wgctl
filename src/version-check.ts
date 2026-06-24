// Lightweight "is a newer version available" notice, in the same spirit as
// npm/yarn's own update notifier: never blocks the current command's actual
// output, and only re-checks the registry once per day (cached), via `npm
// view` rather than hitting the registry API directly so it automatically
// respects whatever registry/proxy/auth config npm itself is set up with.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(homedir(), ".config", "wgctl", "update-check.json");
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PACKAGE_NAME = "wgctl";

interface Cache {
  checkedAt: string;
  latestVersion: string;
}

export function getInstalledVersion(): string {
  const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
  return pkg.version;
}

function readCache(): Cache | undefined {
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf8"));
  } catch {
    return undefined;
  }
}

function writeCache(cache: Cache): void {
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(cache));
}

/** Queries npm (not the registry API directly) for the latest published version. Returns undefined on any failure (offline, not yet published, registry down, etc). */
export function fetchLatestVersion(timeoutMs = 3000): string | undefined {
  try {
    return execFileSync("npm", ["view", PACKAGE_NAME, "version"], { timeout: timeoutMs, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

function isNewer(latest: string, current: string): boolean {
  const lp = latest.split(".").map(Number);
  const cp = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((lp[i] ?? 0) !== (cp[i] ?? 0)) return (lp[i] ?? 0) > (cp[i] ?? 0);
  }
  return false;
}

/**
 * Prints a one-line notice if a previous check found a newer version, then
 * (at most once per CHECK_INTERVAL_MS) refreshes the cache for next time.
 * The refresh itself runs synchronously but with a short timeout — the
 * notice shown on THIS run always comes from the cache, never from a
 * just-made network call, so a slow/offline registry never delays output.
 */
export function checkForUpdate(): void {
  const current = getInstalledVersion();
  const cache = readCache();

  if (cache && isNewer(cache.latestVersion, current)) {
    console.log(`\nUpdate available: ${current} -> ${cache.latestVersion}. Run \`wgctl update\` to install it.`);
  }

  const stale = !cache || Date.now() - new Date(cache.checkedAt).getTime() > CHECK_INTERVAL_MS;
  if (stale) {
    const latestVersion = fetchLatestVersion(1500);
    if (latestVersion) {
      writeCache({ checkedAt: new Date().toISOString(), latestVersion });
    }
  }
}
