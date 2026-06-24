// Manages a systemd unit that runs `wgctl serve` so the control-plane
// daemon (and therefore the wg0 interface it rebuilds on every start, per
// src/server/wg/bootstrap.ts) actually survives a reboot. systemd captures
// stdout/stderr to the journal automatically — no separate logging setup
// needed, just `wgctl service logs`.

import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { askText } from "../../client/prompts.js";

const UNIT_PATH = "/etc/systemd/system/wgctl.service";
const ENV_FILE_PATH = "/etc/wgctl/wgctl.env";
const UNIT_NAME = "wgctl";

function usage(): void {
  console.log(`Usage:
  wgctl service install            Write the systemd unit (does not start it)
  wgctl service enable             Install if needed, then start now and on every boot
  wgctl service disable            Stop and remove from boot (unit file is kept)
  wgctl service uninstall [-y]     Stop, disable, and delete the unit + env file (asks to confirm)
  wgctl service status             Show systemd status
  wgctl service logs [-f] [-n N]   Show logs via journalctl (-f to follow, default 50 lines)`);
}

function binaryPath(): string {
  // process.argv[1] is whatever path was used to invoke this process (the
  // global npm bin, typically a symlink). Resolve through any symlinks so
  // the unit file points at a stable, real path.
  return realpathSync(process.argv[1]);
}

function unitFileContent(): string {
  return `[Unit]
Description=wgctl WireGuard orchestration daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${binaryPath()} serve
Restart=on-failure
RestartSec=2
EnvironmentFile=-${ENV_FILE_PATH}

[Install]
WantedBy=multi-user.target
`;
}

function install(): void {
  mkdirSync("/etc/wgctl", { recursive: true });
  if (!existsSync(ENV_FILE_PATH)) {
    writeFileSync(
      ENV_FILE_PATH,
      `# Environment for the wgctl systemd service. Uncomment/edit as needed.
# PUBLIC_HOST=vpn.example.com
# PORT=8443
`,
    );
  }
  writeFileSync(UNIT_PATH, unitFileContent());
  execFileSync("systemctl", ["daemon-reload"]);
  console.log(`Installed ${UNIT_PATH} (ExecStart=${binaryPath()} serve).`);
  console.log(`Edit ${ENV_FILE_PATH} to set PUBLIC_HOST or other options, then \`wgctl service enable\`.`);
}

export async function serviceCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args;

  switch (sub) {
    case "install":
      install();
      return;
    case "enable":
      if (!existsSync(UNIT_PATH)) install();
      execFileSync("systemctl", ["enable", "--now", UNIT_NAME], { stdio: "inherit" });
      console.log(`${UNIT_NAME} enabled and started — it will now also start automatically on boot.`);
      return;
    case "disable":
      execFileSync("systemctl", ["disable", "--now", UNIT_NAME], { stdio: "inherit" });
      console.log(`${UNIT_NAME} stopped and disabled from starting on boot. (Unit file kept at ${UNIT_PATH}.)`);
      return;
    case "uninstall": {
      if (!existsSync(UNIT_PATH)) {
        console.log(`${UNIT_NAME} is not installed (no ${UNIT_PATH}) — nothing to do.`);
        return;
      }
      if (!rest.includes("-y") && !rest.includes("--yes")) {
        const answer = await askText(
          `This will stop ${UNIT_NAME}, disable it from starting on boot, and delete ${UNIT_PATH} and ${ENV_FILE_PATH}.\n` +
            `Your data (/etc/wgctl/db.sqlite, /etc/wgctl/tls/) is NOT touched. Continue? [y/N]: `,
        );
        if (answer.trim().toLowerCase() !== "y") {
          console.log("Aborted — nothing was changed.");
          return;
        }
      }
      try {
        execFileSync("systemctl", ["disable", "--now", UNIT_NAME], { stdio: "inherit" });
      } catch {
        // already stopped/disabled or never started — fine, continue to delete the files.
      }
      if (existsSync(UNIT_PATH)) rmSync(UNIT_PATH);
      if (existsSync(ENV_FILE_PATH)) rmSync(ENV_FILE_PATH);
      execFileSync("systemctl", ["daemon-reload"]);
      console.log(`Removed ${UNIT_PATH} and ${ENV_FILE_PATH}. ${UNIT_NAME} is fully uninstalled (data in /etc/wgctl was left in place).`);
      return;
    }
    case "status":
      spawnSync("systemctl", ["status", UNIT_NAME, "--no-pager"], { stdio: "inherit" });
      return;
    case "logs": {
      const follow = rest.includes("-f") || rest.includes("--follow");
      const nIndex = rest.indexOf("-n");
      const lines = nIndex !== -1 ? rest[nIndex + 1] : "50";
      const journalArgs = ["-u", UNIT_NAME, "-n", lines];
      if (follow) journalArgs.push("-f");
      spawnSync("journalctl", journalArgs, { stdio: "inherit" });
      return;
    }
    default:
      usage();
      process.exitCode = sub ? 1 : 0;
  }
}
