import { generatePrivateKey, publicKey } from "@sourceregistry/node-wireguard";
import { isValidCidr } from "../../shared/index.js";
import { getNetworks, registerPeer } from "../api-client.js";
import { loadKeyPair, saveKeyPair } from "../config-store.js";
import { resolveSession } from "../session-resolver.js";
import { askMultiChoice, askText } from "../prompts.js";
import { applyLocalTunnel } from "../wg-apply.js";

function parseAdvertisedSubnets(input: string): string[] {
  const subnets = input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const subnet of subnets) {
    if (!isValidCidr(subnet)) {
      throw new Error(`Invalid CIDR: ${subnet}`);
    }
  }
  return subnets;
}

export async function connectCommand(args: string[]): Promise<void> {
  const session = resolveSession(args);
  if (!session) {
    process.exitCode = 1;
    return;
  }

  const serverHost = new URL(session.serverUrl).host;

  const { networks } = await getNetworks(session.serverUrl, session.token, session.certFingerprint);
  if (networks.length === 0) {
    console.error("No networks available for your account. Contact an administrator.");
    process.exitCode = 1;
    return;
  }

  const selected = await askMultiChoice(
    "Select networks to connect to:",
    networks.map((n) => `${n.name} — ${n.cidr}`),
  );
  const networkIds = selected.map((i) => networks[i].id);

  const subnetsInput = await askText("Local subnets to share behind this machine (comma-separated CIDRs, or blank for none): ");
  let advertisedSubnets: string[];
  try {
    advertisedSubnets = parseAdvertisedSubnets(subnetsInput);
  } catch (err: any) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }

  let keyPair = loadKeyPair(serverHost);
  if (!keyPair) {
    const privateKey = generatePrivateKey();
    keyPair = { privateKey, publicKey: publicKey(privateKey) };
    saveKeyPair(serverHost, keyPair);
  }

  const result = await registerPeer(session.serverUrl, session.token, session.certFingerprint, {
    publicKey: keyPair.publicKey,
    networkIds,
    advertisedSubnets,
  });

  try {
    await applyLocalTunnel({ keyPair, result, advertisedSubnets });
  } catch (err: any) {
    if (err?.code === "EPERM" || err?.code === "EACCES") {
      console.error("Permission denied configuring the local WireGuard interface — re-run with sudo: `sudo wgctl connect`.");
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  console.log(`Connected. Assigned address: ${result.clientAddress}`);
  console.log(`Routing through tunnel: ${result.allowedIPs.join(", ")}`);
  if (advertisedSubnets.length > 0) {
    console.log(`Advertising local subnets behind this machine: ${advertisedSubnets.join(", ")}`);
  }
}
