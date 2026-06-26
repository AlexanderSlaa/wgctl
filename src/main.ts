#!/usr/bin/env node
import { checkForUpdate } from "./version-check.js";
import { ensureRoot } from "./elevate.js";
import { ensureNativeAddon } from "./shared/ensure-addon.js";

const ROOT_REQUIRED_COMMANDS = new Set([
  "serve",
  "status",
  "peer",
  "service",
  "setup",
  "join",
  "uninstall",
]);

const NATIVE_ADDON_COMMANDS = new Set(["serve", "status", "peer"]);

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

Commands that configure the WireGuard interface (serve, status, peer, setup)
require root / CAP_NET_ADMIN. If you run one without it, wgctl re-runs
itself under \`sudo\` automatically (set WGCTL_NO_SUDO=1 to disable).
`;

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;

  if (command && ROOT_REQUIRED_COMMANDS.has(command)) {
    ensureRoot();
  }

  if (command && NATIVE_ADDON_COMMANDS.has(command)) {
    await ensureNativeAddon();
  }

  switch (command) {
    case "setup":
      await (await import("./commands/admin/setup.js")).setupCommand(args);
      break;
    case "serve":
      await (await import("./server/serve.js")).serveCommand();
      break;
    case "peer":
      await (await import("./commands/admin/peer.js")).peerCommand(args);
      break;
    case "status":
      await (await import("./commands/admin/status.js")).statusCommand(args);
      break;
    case "join":
      await (await import("./commands/join.js")).joinCommand(args);
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
  if (err?.code === "ERR_DLOPEN_FAILED" && /\.so(\.\d+)?: cannot open shared object file/.test(err.message ?? "")) {
    console.error(
      `${err.message}\n\n` +
        "wgctl's native WireGuard addon needs the libmnl and libssl runtime libraries:\n\n" +
        "  Debian/Ubuntu:  apt-get install -y libmnl0 libssl3\n" +
        "  Fedora/RHEL:    dnf install -y libmnl openssl-libs\n" +
        "  Alpine:         apk add libmnl openssl\n",
    );
  } else {
    console.error(err instanceof Error ? err.message : err);
  }
  process.exitCode = 1;
});
