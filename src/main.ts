#!/usr/bin/env node
import { checkForUpdate } from "./version-check.js";
import { ensureRoot } from "./elevate.js";
import { ensureNativeAddon } from "./shared/ensure-addon.js";

const ROOT_REQUIRED_COMMANDS = new Set([
  "serve",
  "connect",
  "up",
  "status",
  "down",
  "user",
  "network",
  "peer",
  "service",
  "init",
  "setup",
  "uninstall",
]);
// Subset of ROOT_REQUIRED_COMMANDS that actually load the native addon — needs ensureNativeAddon().
// "setup" handles its own check internally.
const NATIVE_ADDON_COMMANDS = new Set(["serve", "connect", "up", "status", "down", "init"]);

const HELP = `wgctl — orchestrated WireGuard tunnels

First-time setup (run on the server, as root):
  wgctl setup [--interface <name>] [--force]  Interactive wizard: build native addon if needed,
                                              configure WireGuard, write env, install systemd service
                                              Re-run with --interface wg1 to set up additional instances
  wgctl init [--force]                        Low-level: generate /etc/wireguard/wg0.conf only (no prompts)

Server (run on the box that should act as the VPN hub):
  wgctl serve [--host <addr>] [--port <n>]   Start the HTTPS control-plane daemon (requires root)
                                              Defaults to all interfaces and port 8443 (or $HOST/$PORT)

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
  wgctl peer add <label> [--network <name>]...
                                            Generate a WireGuard app/device config
  wgctl peer ls                            List all registered peers (with live handshake status)
  wgctl peer rm <id> [--force]             Revoke a single peer/device without removing its user
  wgctl service install                    Write the systemd unit (without starting it)
  wgctl service enable                     Start now and on every boot
  wgctl service disable                    Stop and remove from boot
  wgctl service uninstall [-y]             Stop, disable, and delete the unit (asks to confirm)
  wgctl service status                     Show systemd status
  wgctl service logs [-f] [-n N]           Show logs via journalctl
  wgctl uninstall [-y] [--purge-data]      Stop services and remove wgctl service artifacts
  wgctl update [-y]                        Check npm for a newer version and install it (asks to confirm)

Client (run on the machine that wants to connect):
  wgctl login [--server <url>] [--setup-token [token]] [--fingerprint <sha256>]
                                      Log in with username/password or the one-time setup token.
                                      --fingerprint pins the expected server cert fingerprint
                                      (copy from \`wgctl setup\` output) to prevent MITM on first
                                      login; without it the fingerprint is shown for confirmation.
  wgctl logout [--server <url>]     Revoke the session on the server and delete local credentials
  wgctl networks [--server <url>]   List networks available to your account
  wgctl connect [--server <url>]    Select networks and bring up the local tunnel (requires root)
  wgctl up [--server <url>]         Re-apply the existing registration and bring the tunnel back up (requires root)
  wgctl status                      Show local tunnel/peer status (requires root)
  wgctl down [--server <url>]       Tear down the local tunnel (requires root)

You can be logged in to multiple servers at once; --server picks which one a
command applies to. With no --server, commands use whichever server you most
recently logged in to (or the only one, if you're only logged in to one).

Commands that configure the local WireGuard interface directly via netlink
(serve, connect, up, status, down, and all server administration commands)
require root / CAP_NET_ADMIN. If you run one without it, wgctl re-runs
itself under \`sudo\` automatically (set WGCTL_NO_SUDO=1 to disable this and
get a plain permission error instead).
`;

// Commands are imported lazily (inside each case) rather than statically at
// the top of this file. Most of them transitively load the native
// @sourceregistry/node-wireguard addon, which dynamically links against
// libmnl/libcrypto at runtime — if those shared libraries aren't installed,
// loading fails immediately. Lazy imports mean that failure only happens for
// commands that actually need netlink access; pure-HTTP commands (login,
// networks, update, ...) keep working regardless, and the error is caught
// below with an actionable message instead of a raw stack trace.
async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;

  if (command && ROOT_REQUIRED_COMMANDS.has(command)) {
    ensureRoot(); // re-execs under sudo and exits if not already root
  }

  if (command && NATIVE_ADDON_COMMANDS.has(command)) {
    await ensureNativeAddon(); // builds addon if skipped at install time, then re-execs
  }

  switch (command) {
    case "setup":
      await (await import("./commands/admin/setup.js")).setupCommand(args);
      break;
    case "init":
      await (await import("./commands/admin/init.js")).initCommand(args);
      break;
    case "serve":
      await (await import("./server/serve.js")).serveCommand(args);
      break;
    case "login":
      await (await import("./client/commands/login.js")).loginCommand(args);
      break;
    case "logout":
      await (await import("./client/commands/logout.js")).logoutCommand(args);
      break;
    case "networks":
      await (await import("./client/commands/networks.js")).networksCommand(args);
      break;
    case "connect":
      await (await import("./client/commands/connect.js")).connectCommand(args);
      break;
    case "up":
      await (await import("./client/commands/up.js")).upCommand(args);
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
    case "uninstall":
      await (await import("./commands/admin/uninstall.js")).uninstallCommand(args);
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
        "wgctl's native WireGuard addon needs the libmnl and libssl runtime libraries " +
        "(not the full build toolchain — just the shared libraries):\n\n" +
        "  Debian/Ubuntu:  apt-get install -y libmnl0 libssl3\n" +
        "  Fedora/RHEL:    dnf install -y libmnl openssl-libs\n" +
        "  Alpine:         apk add libmnl openssl\n",
    );
  } else {
    console.error(err instanceof Error ? err.message : err);
  }
  process.exitCode = 1;
});
