import { isValidCidr } from "../../shared/index.js";
import {
  createNetwork,
  listAllNetworks,
  findNetworkByName,
  deleteNetwork,
  grantUserAccess,
  revokeUserAccess,
} from "../../server/db/networks.repo.js";
import { findUserByUsername } from "../../server/db/users.repo.js";

function usage(): void {
  console.log(`Usage:
  wgctl network add <name> <cidr> [description...]
  wgctl network ls
  wgctl network rm <name>
  wgctl network grant <username> <network-name>
  wgctl network revoke <username> <network-name>`);
}

export async function networkCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args;

  switch (sub) {
    case "add": {
      const [name, cidr, ...descParts] = rest;
      if (!name || !cidr) {
        usage();
        process.exitCode = 1;
        return;
      }
      if (!isValidCidr(cidr)) {
        console.error(`Invalid CIDR: ${cidr}`);
        process.exitCode = 1;
        return;
      }
      if (findNetworkByName(name)) {
        console.error(`Network "${name}" already exists.`);
        process.exitCode = 1;
        return;
      }
      const network = createNetwork(name, cidr, descParts.join(" ") || undefined);
      console.log(`Created network "${network.name}" (${network.cidr}).`);
      return;
    }
    case "ls": {
      const networks = listAllNetworks();
      if (networks.length === 0) {
        console.log("No networks.");
        return;
      }
      for (const n of networks) {
        console.log(`  [${n.id}] ${n.name} — ${n.cidr}${n.description ? ` (${n.description})` : ""}`);
      }
      return;
    }
    case "rm": {
      const [name] = rest;
      const network = name ? findNetworkByName(name) : undefined;
      if (!network) {
        console.error(`Network "${name ?? ""}" not found.`);
        process.exitCode = 1;
        return;
      }
      deleteNetwork(network.id);
      console.log(`Removed network "${name}".`);
      return;
    }
    case "grant":
    case "revoke": {
      const [username, networkName] = rest;
      const user = username ? findUserByUsername(username) : undefined;
      const network = networkName ? findNetworkByName(networkName) : undefined;
      if (!user || !network) {
        console.error(`Usage: wgctl network ${sub} <username> <network-name>`);
        process.exitCode = 1;
        return;
      }
      if (sub === "grant") {
        grantUserAccess(user.id, network.id);
        console.log(`Granted "${username}" access to "${networkName}".`);
      } else {
        revokeUserAccess(user.id, network.id);
        console.log(`Revoked "${username}"'s access to "${networkName}".`);
      }
      return;
    }
    default:
      usage();
      process.exitCode = sub ? 1 : 0;
  }
}
