import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { publicKey } from "@sourceregistry/node-wireguard";
import { config } from "../config.js";
import { parseWgQuickConf } from "./conf-parser.js";
import { ensureNetworkForwarding } from "./iptables.js";
import { getWgManager, WgManager } from "./WgManager.js";
import { upsertStaticPeer } from "../db/peers.repo.js";

function systemctlStatus(args: string[]): { code: number } {
  const result = spawnSync("systemctl", args, { stdio: "ignore" });
  return { code: result.status ?? 1 };
}

/**
 * Defensively stops/disables a wg-quick@wg0 systemd unit if one is found
 * active/enabled. On this box today the unit is already disabled/inactive
 * (wg0 was brought up by hand), so this is a no-op in practice — but it must
 * be correct for a fresh box where wg-quick genuinely owns the interface.
 */
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
        `Stopped ${unitName} but interface ${config.wgInterface} is still present — aborting startup rather than risk double-managing it.`,
      );
    }
  }
}

async function takeOverInterface(wg: WgManager, parsed: ReturnType<typeof parseWgQuickConf>): Promise<void> {
  const devices = await wg.raw.devices();
  const existing = devices.find((d) => d.name === config.wgInterface);
  const expectedPublicKey = publicKey(parsed.privateKey);

  if (existing) {
    if (existing.publicKey && existing.publicKey !== expectedPublicKey) {
      throw new Error(
        `${config.wgInterface} is already up with an unexpected public key (${existing.publicKey}, expected ${expectedPublicKey}) — aborting startup rather than silently overwriting a live interface.`,
      );
    }
    // Already exists with the right key (the actual path exercised on this box today) — reuse it, just ensure desired config.
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

/**
 * Ordered, idempotent takeover of the existing wg-quick-managed wg0
 * interface. Must run once at server startup, before app.listen(). Safe to
 * run repeatedly (every boot) since every step either no-ops when the
 * desired state already holds or recreates exactly what was there before.
 */
export async function bootstrapWireGuard(): Promise<void> {
  const wg = getWgManager();

  stopWgQuickUnitIfManaged(`wg-quick@${config.wgInterface}`);

  const parsed = parseWgQuickConf(config.wgConfPath);

  // Snapshot before mutating any kernel state, for audit/rollback.
  writeFileSync(
    config.migratedSnapshotPath,
    JSON.stringify({ migratedAt: new Date().toISOString(), source: config.wgConfPath, parsed }, null, 2),
    { mode: 0o600 },
  );

  await takeOverInterface(wg, parsed);

  // Re-assert every static peer found in the original conf (today: just the iPhone).
  for (const peer of parsed.peers) {
    await wg.upsertPeer({
      publicKey: peer.publicKey,
      presharedKey: peer.presharedKey,
      allowedIPs: peer.allowedIPs,
    });
    const tunnelIp = peer.allowedIPs[0]?.split("/")[0] ?? "";
    upsertStaticPeer({ publicKey: peer.publicKey, presharedKey: peer.presharedKey ?? "", tunnelIp });
  }

  ensureNetworkForwarding();

  await wg.reconcileFromDb();
}
