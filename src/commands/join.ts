import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";

const TOKEN_PREFIX = "wgctl-join-v1.";

interface JoinToken {
  version: number;
  label: string;
  privateKey: string;
  presharedKey: string;
  clientAddress: string;
  serverPublicKey: string;
  endpoint: string;
  allowedIPs: string[];
  persistentKeepalive: number;
  dns?: string;
}

function usage(): void {
  console.log(`Usage:
  wgctl join <join-token> [--interface <name>] [--force]
  wgctl join rm [--interface <name>] [-y]

Consumes a token from \`wgctl peer add <label> --join-token\`, writes a
wgctl-managed WireGuard config, and enables the wgctl service for this server.`);
}

function assertIface(iface: string): void {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,14}$/.test(iface)) {
    throw new Error("Interface name must start with a letter, be 1-15 characters, and contain only letters, digits, underscores, or hyphens.");
  }
}

function parseArgs(args: string[]): { token?: string; iface: string; force: boolean; help: boolean } {
  let token: string | undefined;
  let iface = "wg0";
  let force = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--interface":
      case "-i":
        iface = args[++i] ?? "";
        break;
      case "--force":
      case "-f":
        force = true;
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
        if (token) throw new Error("Only one join token can be provided.");
        token = arg;
    }
  }

  return { token, iface, force, help };
}

function parseRemoveArgs(args: string[]): { iface: string; yes: boolean; help: boolean } {
  let iface = "wg0";
  let yes = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "rm":
      case "remove":
        break;
      case "--interface":
      case "-i":
        iface = args[++i] ?? "";
        break;
      case "-y":
      case "--yes":
        yes = true;
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { iface, yes, help };
}

function decodeToken(token: string): JoinToken {
  if (!token.startsWith(TOKEN_PREFIX)) {
    throw new Error("Invalid join token prefix.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token.slice(TOKEN_PREFIX.length), "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid join token encoding.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid join token payload.");
  }
  const body = parsed as Record<string, unknown>;
  if (
    body.version !== 1 ||
    typeof body.label !== "string" ||
    typeof body.privateKey !== "string" ||
    typeof body.presharedKey !== "string" ||
    typeof body.clientAddress !== "string" ||
    typeof body.serverPublicKey !== "string" ||
    typeof body.endpoint !== "string" ||
    !Array.isArray(body.allowedIPs) ||
    !body.allowedIPs.every((ip) => typeof ip === "string") ||
    typeof body.persistentKeepalive !== "number" ||
    (body.dns !== undefined && typeof body.dns !== "string")
  ) {
    throw new Error("Invalid join token payload.");
  }
  return body as unknown as JoinToken;
}

function renderConfig(token: JoinToken): string {
  const lines = [
    "[Interface]",
    `PrivateKey = ${token.privateKey}`,
    `Address = ${token.clientAddress}`,
    "ListenPort = 51820",
  ];
  lines.push(
    "",
    "[Peer]",
    `PublicKey = ${token.serverPublicKey}`,
    `PresharedKey = ${token.presharedKey}`,
    `Endpoint = ${token.endpoint}`,
    `AllowedIPs = ${token.allowedIPs.join(", ")}`,
    `PersistentKeepalive = ${token.persistentKeepalive}`,
  );
  return lines.join("\n") + "\n";
}

function buildUnitContent(iface: string, envFilePath: string): string {
  return `[Unit]
Description=wgctl WireGuard joined peer (${iface})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${realpathSync(process.argv[1])} serve
Restart=on-failure
RestartSec=2
EnvironmentFile=-${envFilePath}

[Install]
WantedBy=multi-user.target
`;
}

function pathsForIface(iface: string) {
  return {
    confPath: `/etc/wireguard/${iface}.conf`,
    envPath: `/etc/wgctl/${iface}.env`,
    dbPath: `/etc/wgctl/${iface}.sqlite`,
    unitName: `wgctl-${iface}`,
    unitPath: `/etc/systemd/system/wgctl-${iface}.service`,
  };
}

function maybeRemove(path: string): void {
  if (!existsSync(path)) return;
  rmSync(path, { recursive: true, force: true });
  console.log(`Removed ${path}`);
}

function removeRuntimeIface(iface: string): void {
  const deleted = spawnSync("ip", ["link", "delete", iface], { stdio: "ignore" });
  if (deleted.status === 0) console.log(`Removed runtime interface ${iface}.`);
}

export async function removeJoinCommand(args: string[]): Promise<void> {
  let parsed: ReturnType<typeof parseRemoveArgs>;
  try {
    parsed = parseRemoveArgs(args);
    if (parsed.help) {
      usage();
      return;
    }
    assertIface(parsed.iface);
  } catch (err: any) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }

  const { iface, yes } = parsed;
  const paths = pathsForIface(iface);
  if (!existsSync(paths.confPath) && !existsSync(paths.envPath) && !existsSync(paths.unitPath)) {
    console.log(`No joined wgctl connection found for ${iface}.`);
    return;
  }

  if (!yes) {
    console.log(`This will stop ${paths.unitName} and remove:`);
    for (const path of [paths.unitPath, paths.envPath, paths.confPath, paths.dbPath]) {
      if (existsSync(path)) console.log(`  ${path}`);
    }
    const { askText } = await import("../client/prompts.js");
    const answer = await askText("Continue? [y/N]: ");
    if (answer.trim().toLowerCase() !== "y") {
      console.log("Aborted - nothing was changed.");
      return;
    }
  }

  spawnSync("systemctl", ["disable", "--now", paths.unitName], { stdio: "ignore" });
  removeRuntimeIface(iface);
  maybeRemove(paths.unitPath);
  maybeRemove(paths.envPath);
  maybeRemove(paths.confPath);
  maybeRemove(paths.dbPath);
  execFileSync("systemctl", ["daemon-reload"]);
  console.log(`Removed joined connection ${iface}.`);
}

export async function joinCommand(args: string[]): Promise<void> {
  if (args[0] === "rm" || args[0] === "remove") {
    await removeJoinCommand(args);
    return;
  }

  let parsed: ReturnType<typeof parseArgs>;
  let iface: string;
  let token: JoinToken;
  try {
    parsed = parseArgs(args);
    if (parsed.help || !parsed.token) {
      usage();
      process.exitCode = parsed.help ? 0 : 1;
      return;
    }
    iface = parsed.iface;
    assertIface(iface);
    token = decodeToken(parsed.token);
  } catch (err: any) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }

  const envDir = "/etc/wgctl";
  const paths = pathsForIface(iface);
  if (existsSync(paths.confPath) && !parsed.force) {
    console.error(`${paths.confPath} already exists. Use --force to overwrite it.`);
    process.exitCode = 1;
    return;
  }
  if ((existsSync(paths.envPath) || existsSync(paths.unitPath)) && !parsed.force) {
    console.error(`${paths.envPath} or ${paths.unitPath} already exists. Use --force to overwrite them.`);
    process.exitCode = 1;
    return;
  }

  mkdirSync("/etc/wireguard", { recursive: true, mode: 0o700 });
  writeFileSync(paths.confPath, renderConfig(token), { mode: 0o600 });
  console.log(`Wrote ${paths.confPath} for ${token.label}.`);

  mkdirSync(envDir, { recursive: true });
  writeFileSync(
    paths.envPath,
    [
      `# wgctl joined-peer environment for interface ${iface}`,
      `# Generated by \`wgctl join\` on ${new Date().toISOString()}`,
      `WG_INTERFACE=${iface}`,
      `WG_CONF_PATH=${paths.confPath}`,
      "WG_LISTEN_PORT=51820",
      `WG_SUBNET=${token.clientAddress}`,
      `WG_SERVER_ADDRESS=${token.clientAddress}`,
      `DB_PATH=${paths.dbPath}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  console.log(`Wrote ${paths.envPath}.`);

  writeFileSync(paths.unitPath, buildUnitContent(iface, paths.envPath));
  execFileSync("systemctl", ["daemon-reload"]);
  execFileSync("systemctl", ["enable", "--now", paths.unitName], { stdio: "inherit" });
  console.log(`Connected ${iface}. Status: systemctl status ${paths.unitName}`);
}
