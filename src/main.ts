#!/usr/bin/env node
import { checkForUpdate } from "./version-check.js";
import { ensureRoot } from "./elevate.js";

const ROOT_REQUIRED_COMMANDS = new Set([
  "serve",
  "status",
  "peer",
  "service",
  "setup",
  "join",
  "up",
  "down",
  "uninstall",
]);

const HELP = `wgctl — WireGuard overlay network manager

First-time setup (run on the hub server, as root):
  wgctl setup [--interface <name>] [--force]
                              Interactive wizard: configure WireGuard, write
                              env file, install systemd service.

Hub server administration (run locally on the server, as root):
  wgctl serve                 Start the WireGuard hub daemon (managed by systemd)
  wgctl peer add <label> [--endpoint <host:port>] [--output <file>] [--join-token]
                              Add a peer. Prints a join token or .conf by default.
  wgctl peer token <label>    Re-generate a join token for an existing peer.
  wgctl peer ls               List peers with tunnel IPs and last handshake times.
  wgctl peer rm <id|label>    Remove a peer from the overlay.
  wgctl status                Show live WireGuard interface status.
  wgctl service install       Write the systemd unit (without starting it)
  wgctl service enable        Start now and on every boot
  wgctl service disable       Stop and remove from boot
  wgctl service uninstall [-y]
                              Stop, disable, and delete the unit
  wgctl service status        Show systemd status
  wgctl service logs [-f] [-n N]
                              Show logs via journalctl
  wgctl uninstall [-y] [--purge-data]
                              Stop services and remove wgctl artifacts
  wgctl update [-y]           Check npm for a newer version and install it

Joining the overlay (run on any peer machine, as root):
  wgctl join <join-token> [--interface <name>] [--force]
                              Apply a join token, write the WireGuard config, and
                              enable wg-quick@<iface> via systemd.
  wgctl join rm [--interface <name>] [-y]
                              Stop the tunnel and remove its config.
  wgctl up [--interface <name>]
                              Start a stopped tunnel (hub or joined peer).
  wgctl down [--interface <name>]
                              Stop a running tunnel without removing its config.

Commands that configure the WireGuard interface (serve, status, peer, setup)
require root / CAP_NET_ADMIN. If you run one without it, wgctl re-runs
itself under \`sudo\` automatically (set WGCTL_NO_SUDO=1 to disable).
`;

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;

  if (command && ROOT_REQUIRED_COMMANDS.has(command)) {
    ensureRoot();
  }

  switch (command) {
    case "setup":
      await (await import("./commands/admin/setup.js")).setupCommand(args);
      break;
    case "serve":
      await (await import("./server/serve.js")).serveCommand();
      break;
    case "peer":
      (await import("./commands/admin/peer.js")).peerCommand(args);
      break;
    case "status":
      (await import("./commands/admin/status.js")).statusCommand(args);
      break;
    case "join":
      await (await import("./commands/join.js")).joinCommand(args);
      break;
    case "up":
      (await import("./commands/updown.js")).upCommand(args);
      break;
    case "down":
      (await import("./commands/updown.js")).downCommand(args);
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

  if (command !== "serve" && command !== "update") {
    checkForUpdate();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
