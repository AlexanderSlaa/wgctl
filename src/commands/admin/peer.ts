import { listAllPeers, findPeerById, deletePeer } from "../../server/db/peers.repo.js";
import { getNetworksByIds } from "../../server/db/networks.repo.js";
import { getWgManager } from "../../server/wg/WgManager.js";

function usage(): void {
  console.log(`Usage:
  wgctl peer ls
  wgctl peer rm <id> [--force]`);
}

export async function peerCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args;

  switch (sub) {
    case "ls": {
      const peers = listAllPeers();
      if (peers.length === 0) {
        console.log("No peers.");
        return;
      }
      const live = await getWgManager().getLiveStatus().catch(() => []);
      for (const p of peers) {
        const networkIds: number[] = JSON.parse(p.network_ids);
        const networks = getNetworksByIds(networkIds).map((n) => n.name);
        const advertised: string[] = JSON.parse(p.advertised_subnets);
        const liveEntry = live.find((l) => l.publicKey === p.public_key);
        const handshake = liveEntry?.lastHandshakeTime ? liveEntry.lastHandshakeTime.toISOString() : "never";
        const tag = p.is_static ? " [static]" : "";
        console.log(
          `  [${p.id}]${tag} ${p.username} — ${p.public_key} — ${p.tunnel_ip}` +
            `${networks.length ? ` — networks: ${networks.join(",")}` : ""}` +
            `${advertised.length ? ` — advertises: ${advertised.join(",")}` : ""}` +
            ` — last handshake: ${handshake}`,
        );
      }
      return;
    }
    case "rm": {
      const force = rest.includes("--force");
      const [idStr] = rest.filter((a) => a !== "--force");
      const id = Number(idStr);
      if (!idStr || !Number.isInteger(id)) {
        usage();
        process.exitCode = 1;
        return;
      }
      const peer = findPeerById(id);
      if (!peer) {
        console.error(`Peer ${id} not found.`);
        process.exitCode = 1;
        return;
      }
      if (peer.is_static && !force) {
        console.error(
          `Peer ${id} is a static peer (migrated from the original wg0.conf) and can't be removed this way. ` +
            `Use --force to remove it anyway.`,
        );
        process.exitCode = 1;
        return;
      }
      await getWgManager().removePeer(peer.public_key);
      deletePeer(peer.id);
      console.log(`Removed peer ${id} (${peer.username}, ${peer.public_key}).`);
      if (peer.is_static) {
        console.log(
          `Note: this peer was originally read from /etc/wireguard/wg0.conf. ` +
            `\`wgctl serve\` re-parses that file on every restart and will re-add this peer unless you also remove ` +
            `its [Peer] block from /etc/wireguard/wg0.conf.`,
        );
      }
      return;
    }
    default:
      usage();
      process.exitCode = sub ? 1 : 0;
  }
}
