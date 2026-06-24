import { createUser, listUsers, deleteUser, setPassword, findUserByUsername } from "../../server/db/users.repo.js";
import { findPeerByUsername, deletePeer } from "../../server/db/peers.repo.js";
import { getWgManager } from "../../server/wg/WgManager.js";
import { askPassword } from "../../client/prompts.js";

function usage(): void {
  console.log(`Usage:
  wgctl user add <username> <password> [--admin]
  wgctl user ls
  wgctl user rm <username>
  wgctl user passwd <username>`);
}

export async function userCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args;

  switch (sub) {
    case "add": {
      const [username, password] = rest;
      if (!username || !password) {
        usage();
        process.exitCode = 1;
        return;
      }
      if (findUserByUsername(username)) {
        console.error(`User "${username}" already exists.`);
        process.exitCode = 1;
        return;
      }
      const role = rest.includes("--admin") ? "admin" : "user";
      createUser(username, password, role);
      console.log(`Created user "${username}" (role: ${role}).`);
      return;
    }
    case "ls": {
      const users = listUsers();
      if (users.length === 0) {
        console.log("No users.");
        return;
      }
      for (const u of users) {
        console.log(`  [${u.id}] ${u.username} (${u.role})`);
      }
      return;
    }
    case "rm": {
      const [username] = rest;
      if (!username) {
        usage();
        process.exitCode = 1;
        return;
      }
      if (!findUserByUsername(username)) {
        console.error(`User "${username}" not found.`);
        process.exitCode = 1;
        return;
      }
      const peer = findPeerByUsername(username);
      if (peer && !peer.is_static) {
        await getWgManager().removePeer(peer.public_key);
        deletePeer(peer.id);
        console.log(`Revoked tunnel access for "${username}" (removed their peer ${peer.public_key}).`);
      }
      deleteUser(username);
      console.log(`Removed user "${username}".`);
      return;
    }
    case "passwd": {
      const [username] = rest;
      if (!username) {
        usage();
        process.exitCode = 1;
        return;
      }
      if (!findUserByUsername(username)) {
        console.error(`User "${username}" not found.`);
        process.exitCode = 1;
        return;
      }
      const password = await askPassword(`New password for ${username}: `);
      setPassword(username, password);
      console.log(`Password updated for "${username}".`);
      return;
    }
    default:
      usage();
      process.exitCode = sub ? 1 : 0;
  }
}
