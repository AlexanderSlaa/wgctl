import { existsSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { askText } from "../../client/prompts.js";

function parseArgs(args: string[]): { sub: string | undefined; iface: string; rest: string[] } {
  let iface = "wg0";
  let sub: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--interface" || args[i] === "-i") && args[i + 1]) {
      iface = args[++i];
    } else if (!sub && !args[i].startsWith("-")) {
      sub = args[i];
    } else {
      rest.push(args[i]);
    }
  }
  return { sub, iface, rest };
}

function usage(): void {
  console.log(`Usage:
  wgctl service enable   [--interface <name>]   Start now and on every boot
  wgctl service disable  [--interface <name>]   Stop and remove from boot (unit kept)
  wgctl service start    [--interface <name>]   Start the service
  wgctl service stop     [--interface <name>]   Stop the service (keeps autostart)
  wgctl service restart  [--interface <name>]   Restart the service
  wgctl service status   [--interface <name>]   Show systemd status
  wgctl service logs     [--interface <name>] [-f] [-n N]
                                                Show logs via journalctl
  wgctl service uninstall [--interface <name>] [-y]
                                                Stop, disable, delete unit + env file

--interface defaults to wg0. Run \`wgctl setup\` to create a new hub service.`);
}

export async function serviceCommand(args: string[]): Promise<void> {
  const { sub, iface, rest } = parseArgs(args);
  const unitName = `wg-quick@${iface}`;
  const unitPath = `/etc/systemd/system/${unitName}.service`;
  const envPath = `/etc/wgctl/${iface}.env`;

  switch (sub) {
    case "enable":
      execFileSync("systemctl", ["enable", "--now", unitName], { stdio: "inherit" });
      console.log(`${unitName} enabled and started.`);
      return;
    case "disable":
      execFileSync("systemctl", ["disable", "--now", unitName], { stdio: "inherit" });
      console.log(`${unitName} stopped and disabled from boot. (Unit file kept at ${unitPath}.)`);
      return;
    case "start":
      execFileSync("systemctl", ["start", unitName], { stdio: "inherit" });
      console.log(`${unitName} started.`);
      return;
    case "stop":
      execFileSync("systemctl", ["stop", unitName], { stdio: "inherit" });
      console.log(`${unitName} stopped.`);
      return;
    case "restart":
      execFileSync("systemctl", ["restart", unitName], { stdio: "inherit" });
      console.log(`${unitName} restarted.`);
      return;
    case "status":
      spawnSync("systemctl", ["status", unitName, "--no-pager"], { stdio: "inherit" });
      return;
    case "logs": {
      const follow = rest.includes("-f") || rest.includes("--follow");
      const nIndex = rest.indexOf("-n");
      const lines = nIndex !== -1 ? rest[nIndex + 1] : "50";
      const journalArgs = ["-u", unitName, "-n", lines];
      if (follow) journalArgs.push("-f");
      spawnSync("journalctl", journalArgs, { stdio: "inherit" });
      return;
    }
    case "uninstall": {
      const isEnabled = spawnSync("systemctl", ["is-enabled", "--quiet", unitName], { stdio: "ignore" }).status === 0;
      if (!isEnabled && !existsSync(envPath)) {
        console.log(`${unitName} is not enabled and no env file found — nothing to do.`);
        return;
      }
      if (!rest.includes("-y") && !rest.includes("--yes")) {
        const answer = await askText(
          `This will stop and disable ${unitName} and delete ${envPath}.\n` +
            `WireGuard config and SQLite data are NOT touched. Continue? [y/N]: `,
        );
        if (answer.trim().toLowerCase() !== "y") {
          console.log("Aborted.");
          return;
        }
      }
      try {
        execFileSync("systemctl", ["disable", "--now", unitName], { stdio: "inherit" });
      } catch { /* already stopped/disabled */ }
      if (existsSync(envPath)) rmSync(envPath);
      console.log(`Disabled ${unitName} and removed ${envPath}.`);
      return;
    }
    default:
      usage();
      process.exitCode = sub ? 1 : 0;
  }
}
