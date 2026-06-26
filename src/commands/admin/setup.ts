import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { askText, askChoice } from "../../client/prompts.js";
import { isValidCidr, hostAtOffset, parseCidr } from "../../shared/cidr.js";
import { ensureNativeAddon } from "../../shared/ensure-addon.js";

function detectPublicHost(): string | undefined {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }
  return undefined;
}

function parseIfaceNum(iface: string): number {
  const match = iface.match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function deriveDefaults(iface: string) {
  const n = parseIfaceNum(iface);
  return {
    wgPort: 51820 + n,
    apiPort: 8443 + n,
    subnet: `10.${88 + n}.0.0/24`,
  };
}

function buildUnitContent(iface: string, envFilePath: string, binPath: string): string {
  return `[Unit]
Description=wgctl WireGuard orchestration daemon (${iface})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${binPath} serve
Restart=on-failure
RestartSec=2
EnvironmentFile=-${envFilePath}

[Install]
WantedBy=multi-user.target
`;
}

function checkState(iface: string) {
  return {
    confExists: existsSync(`/etc/wireguard/${iface}.conf`),
    envExists: existsSync(`/etc/wgctl/${iface}.env`),
    unitExists: existsSync(`/etc/systemd/system/wgctl-${iface}.service`),
  };
}

function stopIfActive(unitName: string): boolean {
  const result = spawnSync("systemctl", ["is-active", unitName], { stdio: "ignore" });
  if (result.status === 0) {
    spawnSync("systemctl", ["stop", unitName], { stdio: "inherit" });
    return true;
  }
  return false;
}

export async function setupCommand(args: string[]): Promise<void> {
  const force = args.includes("--force") || args.includes("-f");
  const ifaceFlagIdx = args.findIndex((a) => a === "--interface" || a === "-i");
  const ifaceFlag = ifaceFlagIdx !== -1 ? args[ifaceFlagIdx + 1] : undefined;

  // Step 0: ensure native module is built (build and re-exec if scripts were skipped at install)
  await ensureNativeAddon();

  // Step 1: interface name
  let iface: string;
  if (ifaceFlag) {
    iface = ifaceFlag;
  } else {
    const answer = await askText("WireGuard interface name [wg0]: ");
    iface = answer || "wg0";
  }

  // Already-configured check
  if (!force) {
    const state = checkState(iface);
    if (state.confExists || state.envExists || state.unitExists) {
      const pad = 45;
      console.log(`\n${iface} is already (partially) configured:`);
      console.log(`  ${"  /etc/wireguard/" + iface + ".conf"}`.padEnd(pad) + (state.confExists ? "✓ exists" : "✗ missing"));
      console.log(`  ${"/etc/wgctl/" + iface + ".env"}`.padEnd(pad) + (state.envExists ? "✓ exists" : "✗ missing"));
      console.log(
        `  ${"/etc/systemd/system/wgctl-" + iface + ".service"}`.padEnd(pad) + (state.unitExists ? "✓ exists" : "✗ missing"),
      );
      console.log();
      const choice = await askChoice("What would you like to do?", [
        "Re-run setup and overwrite existing config (will restart service if running)",
        "Exit — keep existing config",
      ]);
      if (choice === 1) {
        console.log("Aborted — nothing was changed.");
        return;
      }
    }
  }

  const defaults = deriveDefaults(iface);

  // Step 2: WireGuard UDP port
  const wgPortStr = (await askText(`WireGuard UDP listen port [${defaults.wgPort}]: `)) || String(defaults.wgPort);
  const wgPort = Number(wgPortStr);
  if (!Number.isInteger(wgPort) || wgPort < 1024 || wgPort > 65535) {
    console.error("Invalid port — must be an integer between 1024 and 65535.");
    process.exitCode = 1;
    return;
  }

  // Step 3: Tunnel subnet
  const subnetInput = (await askText(`Tunnel subnet CIDR [${defaults.subnet}]: `)) || defaults.subnet;
  if (!isValidCidr(subnetInput)) {
    console.error(`Invalid CIDR: ${subnetInput}`);
    process.exitCode = 1;
    return;
  }
  const subnetParsed = parseCidr(subnetInput);
  const serverIp = hostAtOffset(subnetInput, 1);
  const serverAddress = `${serverIp}/${subnetParsed.prefixLength}`;

  // Step 4: Public host
  const detected = detectPublicHost();
  const publicHostPrompt = detected
    ? `Public hostname or IP for clients [${detected}]: `
    : "Public hostname or IP for clients (leave empty to auto-detect at runtime): ";
  const publicHostInput = await askText(publicHostPrompt);
  const publicHost = publicHostInput || detected || "";

  // Step 5: HTTPS API port
  const apiPortStr = (await askText(`HTTPS control-plane port [${defaults.apiPort}]: `)) || String(defaults.apiPort);
  const apiPort = Number(apiPortStr);
  if (!Number.isInteger(apiPort) || apiPort < 1024 || apiPort > 65535) {
    console.error("Invalid port — must be an integer between 1024 and 65535.");
    process.exitCode = 1;
    return;
  }

  // Step 6: Service mode
  const serviceChoice = await askChoice("Systemd service setup?", [
    "Start now + autostart on boot  (recommended)",
    "Autostart on boot only",
    "Start now only",
    "Install unit only (no start, no enable)",
  ]);

  // Summary + confirmation
  const serviceLabel = ["enable --now", "enable (no start)", "start (no enable)", "install only"][serviceChoice];
  console.log(`
Summary:
  Interface:     ${iface}
  WG UDP port:   ${wgPort}
  Tunnel subnet: ${subnetInput}
  Server IP:     ${serverAddress}
  Public host:   ${publicHost || "(auto-detect at runtime)"}
  API port:      ${apiPort}
  Service:       ${serviceLabel}
`);
  const confirm = await askText("Proceed? [Y/n]: ");
  if (confirm.trim().toLowerCase() === "n") {
    console.log("Aborted — nothing was changed.");
    return;
  }

  // === Write phase ===
  const unitName = `wgctl-${iface}`;
  stopIfActive(unitName);

  // Check wg binary
  if (spawnSync("which", ["wg"], { stdio: "ignore" }).status !== 0) {
    console.error(
      "WireGuard tools not found. Install them first:\n\n" +
        "  Debian/Ubuntu:  apt-get install wireguard-tools\n" +
        "  Fedora/RHEL:    dnf install wireguard-tools\n",
    );
    process.exitCode = 1;
    return;
  }

  // WireGuard conf
  const confPath = `/etc/wireguard/${iface}.conf`;
  mkdirSync("/etc/wireguard", { recursive: true, mode: 0o700 });
  const genKey = spawnSync("wg", ["genkey"], { encoding: "utf8" });
  if (genKey.status !== 0 || !genKey.stdout.trim()) {
    console.error("Failed to generate WireGuard private key via `wg genkey`.");
    process.exitCode = 1;
    return;
  }
  writeFileSync(
    confPath,
    `[Interface]\nPrivateKey = ${genKey.stdout.trim()}\nAddress = ${serverAddress}\nListenPort = ${wgPort}\n`,
    { mode: 0o600 },
  );
  console.log(`Wrote ${confPath}`);

  // Env file
  const envDir = "/etc/wgctl";
  const envFilePath = `${envDir}/${iface}.env`;
  mkdirSync(envDir, { recursive: true });
  const envLines = [
    `# wgctl environment for interface ${iface}`,
    `# Generated by \`wgctl setup\` on ${new Date().toISOString()}`,
    `WG_INTERFACE=${iface}`,
    `WG_CONF_PATH=${confPath}`,
    `WG_LISTEN_PORT=${wgPort}`,
    `WG_SUBNET=${subnetInput}`,
    `WG_SERVER_ADDRESS=${serverAddress}`,
    `PORT=${apiPort}`,
    `DB_PATH=${envDir}/${iface}.sqlite`,
  ];
  if (publicHost) envLines.push(`PUBLIC_HOST=${publicHost}`);
  writeFileSync(envFilePath, envLines.join("\n") + "\n", { mode: 0o600 });
  console.log(`Wrote ${envFilePath}`);

  // Systemd unit
  const unitPath = `/etc/systemd/system/${unitName}.service`;
  const binPath = realpathSync(process.argv[1]);
  writeFileSync(unitPath, buildUnitContent(iface, envFilePath, binPath));
  execFileSync("systemctl", ["daemon-reload"]);
  console.log(`Wrote ${unitPath}`);

  // Apply service choice
  switch (serviceChoice) {
    case 0:
      execFileSync("systemctl", ["enable", "--now", unitName], { stdio: "inherit" });
      break;
    case 1:
      execFileSync("systemctl", ["enable", unitName], { stdio: "inherit" });
      console.log(`${unitName} enabled — will start on next boot.`);
      break;
    case 2:
      execFileSync("systemctl", ["start", unitName], { stdio: "inherit" });
      console.log(`${unitName} started.`);
      break;
    case 3:
      console.log(`Unit installed. Start manually with: systemctl start ${unitName}`);
      break;
  }

  console.log(`
Setup complete for ${iface}.
  Status:  systemctl status ${unitName}
  Logs:    journalctl -u ${unitName} -f
  Restart: systemctl restart ${unitName}

Next: add an admin user with  wgctl user add <username> <password> --admin
`);
}
