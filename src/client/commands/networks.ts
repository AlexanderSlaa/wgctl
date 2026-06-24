import { getNetworks } from "../api-client.js";
import { resolveSession } from "../session-resolver.js";

export async function networksCommand(args: string[]): Promise<void> {
  const session = resolveSession(args);
  if (!session) {
    process.exitCode = 1;
    return;
  }

  const { networks } = await getNetworks(session.serverUrl, session.token, session.certFingerprint);
  if (networks.length === 0) {
    console.log("No networks available for your account.");
    return;
  }
  console.log("Available networks:");
  for (const n of networks) {
    console.log(`  [${n.id}] ${n.name} — ${n.cidr}${n.description ? ` (${n.description})` : ""}`);
  }
}
