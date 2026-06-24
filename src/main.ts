#!/usr/bin/env node
import { serveCommand } from "./server/serve.js";
import { loginCommand } from "./client/commands/login.js";
import { networksCommand } from "./client/commands/networks.js";
import { connectCommand } from "./client/commands/connect.js";
import { statusCommand } from "./client/commands/status.js";
import { downCommand } from "./client/commands/down.js";
import { userCommand } from "./commands/admin/user.js";
import { networkCommand } from "./commands/admin/network.js";
import { peerCommand } from "./commands/admin/peer.js";
import { serviceCommand } from "./commands/admin/service.js";

const HELP = `wgctl — orchestrated WireGuard tunnels

Server (run on the box that should act as the VPN hub):
  wgctl serve                    Start the HTTPS control-plane daemon (requires root)

Server administration (run locally on the server, as root):
  wgctl user add <user> <pass> [--admin]   Create a user
  wgctl user ls                            List users
  wgctl user rm <user>                     Remove a user (and revoke their tunnel access)
  wgctl user passwd <user>                 Change a user's password
  wgctl network add <name> <cidr> [desc]   Define a network users can connect to
  wgctl network ls                         List networks
  wgctl network rm <name>                  Remove a network
  wgctl network grant <user> <network>     Authorize a user for a network
  wgctl network revoke <user> <network>    Revoke a user's access to a network
  wgctl peer ls                            List all registered peers (with live handshake status)
  wgctl peer rm <id> [--force]             Revoke a single peer/device without removing its user
  wgctl service install                    Write the systemd unit (without starting it)
  wgctl service enable                     Start now and on every boot
  wgctl service disable                    Stop and remove from boot
  wgctl service uninstall [-y]             Stop, disable, and delete the unit (asks to confirm)
  wgctl service status                     Show systemd status
  wgctl service logs [-f] [-n N]           Show logs via journalctl

Client (run on the machine that wants to connect):
  wgctl login [--server <url>]   Log in with username/password
  wgctl networks                 List networks available to your account
  wgctl connect                  Select networks and bring up the local tunnel (requires root)
  wgctl status                   Show local tunnel/peer status (requires root)
  wgctl down                     Tear down the local tunnel (requires root)

Commands that configure the local WireGuard interface directly via netlink
(serve, connect, status, down, and all server administration commands)
require root / CAP_NET_ADMIN — run them as \`sudo wgctl <command>\`.
`;

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;

  switch (command) {
    case "serve":
      await serveCommand();
      break;
    case "login":
      await loginCommand(args);
      break;
    case "networks":
      await networksCommand();
      break;
    case "connect":
      await connectCommand();
      break;
    case "status":
      await statusCommand();
      break;
    case "down":
      await downCommand();
      break;
    case "user":
      await userCommand(args);
      break;
    case "network":
      await networkCommand(args);
      break;
    case "peer":
      await peerCommand(args);
      break;
    case "service":
      await serviceCommand(args);
      break;
    default:
      console.log(HELP);
      process.exitCode = command ? 1 : 0;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
