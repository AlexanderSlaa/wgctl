import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { askText } from "../../client/prompts.js";

const SYSTEMD_DIR = "/etc/systemd/system";
const WGCTL_DIR = "/etc/wgctl";
const WIREGUARD_DIR = "/etc/wireguard";
const LEGACY_UNIT_NAME = "wgctl";
const LEGACY_UNIT_PATH = `${SYSTEMD_DIR}/${LEGACY_UNIT_NAME}.service`;
const LEGACY_ENV_PATH = `${WGCTL_DIR}/wgctl.env`;
const DEFAULT_SYSCTL_PATH = "/etc/sysctl.d/99-wgctl.conf";
const OLD_SYSCTL_PATH = "/etc/sysctl.d/99-wireguard-orchestrator.conf";

interface Options {
  yes: boolean;
  purgeData: boolean;
  clientConfig: boolean;
  npm: boolean;
}

interface ManagedInstall {
  unitName: string;
  unitPath: string;
  envPath?: string;
  iface?: string;
}

function usage(): void {
  console.log(`Usage:
  wgctl uninstall [-y] [--purge-data] [--client-config] [--npm]

Stops and removes wgctl systemd units and service env files.

Options:
  -y, --yes        Do not prompt for confirmation
  --purge-data     Also remove wgctl databases, TLS keys, generated WireGuard configs, and sysctl files
  --client-config  Also remove this user's ~/.config/wgctl sessions and client keys
  --npm            Also run npm uninstall -g wgctl after cleanup`);
}

function parseOptions(args: string[]): Options | undefined {
  const options: Options = { yes: false, purgeData: false, clientConfig: false, npm: false };
  for (const arg of args) {
    switch (arg) {
      case "-y":
      case "--yes":
        options.yes = true;
        break;
      case "--purge-data":
        options.purgeData = true;
        break;
      case "--client-config":
        options.clientConfig = true;
        break;
      case "--npm":
        options.npm = true;
        break;
      case "-h":
      case "--help":
        usage();
        return undefined;
      default:
        console.error(`Unknown option: ${arg}`);
        usage();
        process.exitCode = 1;
        return undefined;
    }
  }
  return options;
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function readEnvValue(path: string, key: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const content = readFileSync(path, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    if (trimmed.slice(0, idx) === key) return trimmed.slice(idx + 1);
  }
  return undefined;
}

function discoverInstalls(): ManagedInstall[] {
  const installs = new Map<string, ManagedInstall>();

  if (existsSync(LEGACY_UNIT_PATH) || existsSync(LEGACY_ENV_PATH)) {
    installs.set(LEGACY_UNIT_NAME, {
      unitName: LEGACY_UNIT_NAME,
      unitPath: LEGACY_UNIT_PATH,
      envPath: LEGACY_ENV_PATH,
      iface: readEnvValue(LEGACY_ENV_PATH, "WG_INTERFACE") ?? "wg0",
    });
  }

  // Legacy: wgctl-<iface>.service unit files written by old setup versions
  for (const file of listFiles(SYSTEMD_DIR)) {
    const match = file.match(/^wgctl-(.+)\.service$/);
    if (!match) continue;
    const iface = match[1];
    const unitName = `wgctl-${iface}`;
    const envPath = `${WGCTL_DIR}/${iface}.env`;
    installs.set(unitName, {
      unitName,
      unitPath: join(SYSTEMD_DIR, file),
      envPath,
      iface,
    });
  }

  // Current: wg-quick@<iface> enabled via env files written by setup
  for (const file of listFiles(WGCTL_DIR)) {
    if (!file.endsWith(".env") || file === "wgctl.env") continue;
    const envPath = join(WGCTL_DIR, file);
    const iface = readEnvValue(envPath, "WG_INTERFACE") ?? file.slice(0, -".env".length);
    const unitName = `wg-quick@${iface}`;
    if (!installs.has(unitName) && !installs.has(`wgctl-${iface}`)) {
      installs.set(unitName, {
        unitName,
        unitPath: `${SYSTEMD_DIR}/${unitName}.service`,
        envPath,
        iface,
      });
    }
  }

  return [...installs.values()].sort((a, b) => a.unitName.localeCompare(b.unitName));
}

function pathsForPurge(installs: ManagedInstall[]): string[] {
  const paths = new Set<string>();
  if (existsSync(DEFAULT_SYSCTL_PATH)) paths.add(DEFAULT_SYSCTL_PATH);
  if (existsSync(OLD_SYSCTL_PATH)) paths.add(OLD_SYSCTL_PATH);

  for (const install of installs) {
    if (!install.iface) continue;
    const envPath = install.envPath;
    const dbPath = envPath ? readEnvValue(envPath, "DB_PATH") : undefined;
    const confPath = envPath ? readEnvValue(envPath, "WG_CONF_PATH") : undefined;
    const tlsCertPath = envPath ? readEnvValue(envPath, "TLS_CERT_PATH") : undefined;
    const tlsKeyPath = envPath ? readEnvValue(envPath, "TLS_KEY_PATH") : undefined;
    const migratedSnapshotPath = envPath ? readEnvValue(envPath, "WG_MIGRATED_SNAPSHOT_PATH") : undefined;

    paths.add(dbPath ?? `${WGCTL_DIR}/${install.iface}.sqlite`);
    paths.add(confPath ?? `${WIREGUARD_DIR}/${install.iface}.conf`);
    paths.add(migratedSnapshotPath ?? `${WIREGUARD_DIR}/${install.iface}-migrated.json`);
    if (tlsCertPath) paths.add(tlsCertPath);
    if (tlsKeyPath) paths.add(tlsKeyPath);
  }

  if (existsSync(`${WGCTL_DIR}/db.sqlite`)) paths.add(`${WGCTL_DIR}/db.sqlite`);
  if (existsSync(`${WGCTL_DIR}/tls`)) paths.add(`${WGCTL_DIR}/tls`);

  return [...paths].filter((path) => existsSync(path)).sort();
}

function maybeRemove(path: string): void {
  if (!existsSync(path)) return;
  rmSync(path, { recursive: true, force: true });
  console.log(`Removed ${path}`);
}

function runSystemctl(args: string[]): void {
  spawnSync("systemctl", args, { stdio: "ignore" });
}

function removeRuntimeState(iface: string): void {
  // wg-quick PreDown handles iptables cleanup; only remove the interface if still up
  const deleted = spawnSync("ip", ["link", "delete", iface], { stdio: "ignore" });
  if (deleted.status === 0) {
    console.log(`Removed runtime interface ${iface}.`);
  }
}

function removeIfEmpty(path: string): void {
  if (!existsSync(path)) return;
  try {
    if (readdirSync(path).length === 0) {
      rmSync(path, { recursive: true, force: true });
      console.log(`Removed empty directory ${path}`);
    }
  } catch {
    // Directory may not be readable or may not be a directory; leave it alone.
  }
}

export async function uninstallCommand(args: string[]): Promise<void> {
  const options = parseOptions(args);
  if (!options) return;

  const installs = discoverInstalls();
  const serviceFiles = installs.flatMap((install) => [install.unitPath, install.envPath].filter((path): path is string => Boolean(path)));
  const existingServiceFiles = serviceFiles.filter((path) => existsSync(path));
  const ifaces = [...new Set(installs.map((install) => install.iface).filter((iface): iface is string => Boolean(iface)))];
  const purgePaths = options.purgeData ? pathsForPurge(installs) : [];
  const clientConfigPath = join(homedir(), ".config", "wgctl");

  if (installs.length === 0 && purgePaths.length === 0 && !options.clientConfig && !options.npm) {
    console.log("No wgctl service installation was found.");
    return;
  }

  if (!options.yes) {
    console.log("This will:");
    if (installs.length > 0) {
      for (const install of installs) {
        console.log(`  - stop/disable ${install.unitName} and remove its unit/env files`);
      }
      if (ifaces.length > 0) console.log(`  - remove runtime WireGuard interfaces if present: ${ifaces.join(", ")}`);
    }
    if (purgePaths.length > 0) {
      console.log("  - purge data/config:");
      for (const path of purgePaths) console.log(`    ${path}`);
    } else {
      console.log("  - leave databases, TLS keys, and WireGuard config files in place (use --purge-data to remove them)");
    }
    if (options.clientConfig) console.log(`  - remove local client config at ${clientConfigPath}`);
    if (options.npm) console.log("  - run npm uninstall -g wgctl");

    const answer = await askText("Continue? [y/N]: ");
    if (answer.trim().toLowerCase() !== "y") {
      console.log("Aborted — nothing was changed.");
      return;
    }
  }

  for (const install of installs) {
    runSystemctl(["disable", "--now", install.unitName]);
  }

  for (const iface of ifaces) {
    removeRuntimeState(iface);
  }

  for (const path of existingServiceFiles) {
    maybeRemove(path);
  }

  if (existingServiceFiles.some((path) => path.endsWith(".service"))) {
    runSystemctl(["daemon-reload"]);
  }

  for (const path of purgePaths) {
    maybeRemove(path);
  }

  if (options.clientConfig) {
    maybeRemove(clientConfigPath);
  }

  removeIfEmpty(WGCTL_DIR);

  if (options.npm) {
    console.log("Removing global npm package...");
    const result = spawnSync("npm", ["uninstall", "-g", "wgctl"], { stdio: "inherit" });
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      return;
    }
  }

  console.log("wgctl uninstall cleanup complete.");
}
