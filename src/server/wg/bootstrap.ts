import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { publicKey } from "@sourceregistry/node-wireguard";
import { config } from "../config.js";
import { ensureNetworkForwarding } from "./iptables.js";
import { getWgManager, WgManager } from "./WgManager.js";

interface ParsedConf {
  privateKey: string;
  listenPort: number;
  address: string;
}

function parseConf(path: string): ParsedConf {
  const lines = readFileSync(path, "utf8").split("\n");
  let privateKey = "";
  let listenPort = 0;
  let address = "";
  for (const line of lines) {
    const [k, ...rest] = line.split("=").map((s) => s.trim());
    const v = rest.join("=").trim();
    if (k === "PrivateKey") privateKey = v;
    else if (k === "ListenPort") listenPort = Number(v);
    else if (k === "Address") address = v;
  }
  if (!privateKey || !listenPort || !address) {
    throw new Error(`Incomplete WireGuard config at ${path} — missing PrivateKey, ListenPort, or Address.`);
  }
  return { privateKey, listenPort, address };
}

function systemctlStatus(args: string[]): { code: number } {
  const result = spawnSync("systemctl", args, { stdio: "ignore" });
  return { code: result.status ?? 1 };
}

function stopWgQuickUnitIfManaged(unitName: string): void {
  const isEnabled = systemctlStatus(["is-enabled", unitName]);
  if (isEnabled.code === 0) {
    execFileSync("systemctl", ["disable", unitName], { stdio: "ignore" });
  }
  const isActive = systemctlStatus(["is-active", unitName]);
  if (isActive.code === 0) {
    execFileSync("systemctl", ["stop", unitName], { stdio: "ignore" });
    const stillUp = spawnSync("ip", ["link", "show", config.wgInterface]);
    if (stillUp.status === 0) {
      throw new Error(
        `Stopped ${unitName} but interface ${config.wgInterface} is still present — aborting to avoid double-managing it.`,
      );
    }
  }
}

async function takeOverInterface(wg: WgManager, parsed: ParsedConf): Promise<void> {
  const devices = await wg.raw.devices();
  const existing = devices.find((d) => d.name === config.wgInterface);
  const expectedPublicKey = publicKey(parsed.privateKey);

  if (existing) {
    if (existing.publicKey && existing.publicKey !== expectedPublicKey) {
      throw new Error(
        `${config.wgInterface} is already up with an unexpected public key (${existing.publicKey}, expected ${expectedPublicKey}) — aborting to avoid overwriting a live interface.`,
      );
    }
    await wg.raw.configureDevice(config.wgInterface, {
      privateKey: parsed.privateKey,
      listenPort: parsed.listenPort,
    });
  } else {
    try {
      await wg.raw.createDevice(config.wgInterface);
    } catch (err: any) {
      if (err?.code !== "EEXIST") throw err;
    }
    await wg.raw.setAddress(config.wgInterface, parsed.address);
    await wg.raw.configureDevice(config.wgInterface, {
      privateKey: parsed.privateKey,
      listenPort: parsed.listenPort,
    });
  }

  await wg.raw.setUp(config.wgInterface);
}

export async function bootstrapWireGuard(): Promise<void> {
  const wg = getWgManager();

  stopWgQuickUnitIfManaged(`wg-quick@${config.wgInterface}`);

  const parsed = parseConf(config.wgConfPath);

  await takeOverInterface(wg, parsed);

  ensureNetworkForwarding();

  await wg.reconcileFromDb();
}
