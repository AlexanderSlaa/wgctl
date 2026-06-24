#!/usr/bin/env node
import { checkForUpdate } from "./version-check.js";

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
  wgctl update [-y]                        Check npm for a newer version and install it (asks to confirm)

Client (run on the machine that wants to connect):
  wgctl login [--server <url>]      Log in with username/password
  wgctl networks [--server <url>]   List networks available to your account
  wgctl connect [--server <url>]    Select networks and bring up the local tunnel (requires root)
  wgctl status                      Show local tunnel/peer status (requires root)
  wgctl down [--server <url>]       Tear down the local tunnel (requires root)

You can be logged in to multiple servers at once; --server picks which one a
command applies to. With no --server, commands use whichever server you most
recently logged in to (or the only one, if you're only logged in to one).

Commands that configure the local WireGuard interface directly via netlink
(serve, connect, status, down, and all server administration commands)
require root / CAP_NET_ADMIN — run them as \`sudo wgctl <command>\`.
`;

// Commands are imported lazily (inside each case) rather than statically at
// the top of this file. Most of them transitively load the native
// @sourceregistry/node-wireguard addon, which dynamically links against
// libmnl/libsodium at runtime — if those shared libraries aren't installed,
// loading fails immediately. Lazy imports mean that failure only happens for
// commands that actually need netlink access; pure-HTTP commands (login,
// networks, update, ...) keep working regardless, and the error is caught
// below with an actionable message instead of a raw stack trace.
async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;

  switch (command) {
    case "serve":
      await (await import("./server/serve.js")).serveCommand();
      break;
    case "login":
      await (await import("./client/commands/login.js")).loginCommand(args);
      break;
    case "networks":
      await (await import("./client/commands/networks.js")).networksCommand(args);
      break;
    case "connect":
      await (await import("./client/commands/connect.js")).connectCommand(args);
      break;
    case "status":
      await (await import("./client/commands/status.js")).statusCommand();
      break;
    case "down":
      await (await import("./client/commands/down.js")).downCommand(args);
      break;
    case "user":
      await (await import("./commands/admin/user.js")).userCommand(args);
      break;
    case "network":
      await (await import("./commands/admin/network.js")).networkCommand(args);
      break;
    case "peer":
      await (await import("./commands/admin/peer.js")).peerCommand(args);
      break;
    case "service":
      await (await import("./commands/admin/service.js")).serviceCommand(args);
      break;
    case "update":
      await (await import("./commands/update.js")).updateCommand(args);
      break;
    default:
      console.log(HELP);
      process.exitCode = command ? 1 : 0;
  }

  // Skip for `serve` (a long-running daemon shouldn't hit the registry on
  // every restart) and `update` (which already checks for itself).
  if (command !== "serve" && command !== "update") {
    checkForUpdate();
  }
}

main().catch((err) => {
  if (err?.code === "ERR_DLOPEN_FAILED" && /\.so(\.\d+)?: cannot open shared object file/.test(err.message ?? "")) {
    console.error(
      `${err.message}\n\n` +
        "wgctl's native WireGuard addon needs the libmnl and libsodium runtime libraries installed " +
        "(not the full build toolchain — just the shared libraries). On Debian/Ubuntu:\n\n" +
        "  apt-get update && apt-get install -y --no-install-recommends libmnl0 libsodium23\n",
    );
  } else {
    console.error(err instanceof Error ? err.message : err);
  }
  process.exitCode = 1;
});
