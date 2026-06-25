import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { generatePrivateKey } from "@sourceregistry/node-wireguard";
import { config } from "../../server/config.js";

export interface InitParams {
  iface: string;
  confPath: string;
  serverAddress: string;
  listenPort: number;
  force: boolean;
}

function checkWgBinary(): boolean {
  return spawnSync("which", ["wg"], { stdio: "ignore" }).status === 0;
}

/** Low-level: create /etc/wireguard/{iface}.conf with a fresh keypair. Returns false if skipped (already exists, no --force). */
export async function initWireGuard(params: InitParams): Promise<boolean> {
  if (!checkWgBinary()) {
    console.error(
      "WireGuard tools not found. Install them first:\n\n" +
        "  Debian/Ubuntu:  apt-get install wireguard-tools\n" +
        "  Fedora/RHEL:    dnf install wireguard-tools\n" +
        "  Arch:           pacman -S wireguard-tools\n",
    );
    process.exitCode = 1;
    return false;
  }

  if (existsSync(params.confPath) && !params.force) {
    console.log(`${params.confPath} already exists. Use --force to overwrite.`);
    return false;
  }

  mkdirSync("/etc/wireguard", { recursive: true, mode: 0o700 });

  const privateKey = generatePrivateKey();
  writeFileSync(
    params.confPath,
    `[Interface]\nPrivateKey = ${privateKey}\nAddress = ${params.serverAddress}\nListenPort = ${params.listenPort}\n`,
    { mode: 0o600 },
  );

  console.log(`Initialized ${params.confPath}`);
  console.log(`  Address:    ${params.serverAddress}`);
  console.log(`  ListenPort: ${params.listenPort}`);
  return true;
}

export async function initCommand(args: string[]): Promise<void> {
  const ok = await initWireGuard({
    iface: config.wgInterface,
    confPath: config.wgConfPath,
    serverAddress: config.wgServerAddress,
    listenPort: config.wgListenPort,
    force: args.includes("--force") || args.includes("-f"),
  });
  if (ok) {
    console.log();
    console.log("Next steps:");
    console.log("  wgctl setup        (recommended — interactive wizard)");
    console.log("  wgctl service install && wgctl service enable");
  }
}
