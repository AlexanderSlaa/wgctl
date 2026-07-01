import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = dirname(fileURLToPath(import.meta.url));

const TOKEN_PREFIX = "wgctl-join-v1.";
const META_PREFIX = "join_token_hash:";

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
  advertisedRoutes?: string[];
}

function usage(): void {
  console.log(`Usage:
  wgctl join <join-token> [--interface <name>] [--force]
  wgctl join rm [--interface <name>] [-y]

Applies a join token from \`wgctl peer add <label> --join-token\`, writes
/etc/wireguard/<iface>.conf and enables wg-quick@<iface>.`);
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
      case "--interface": case "-i": iface = args[++i] ?? ""; break;
      case "--force": case "-f": force = true; break;
      case "--help": case "-h": help = true; break;
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
      case "rm": case "remove": break;
      case "--interface": case "-i": iface = args[++i] ?? ""; break;
      case "-y": case "--yes": yes = true; break;
      case "--help": case "-h": help = true; break;
      default: throw new Error(`Unknown option: ${arg}`);
    }
  }
  return { iface, yes, help };
}

function decodeToken(token: string): JoinToken {
  if (!token.startsWith(TOKEN_PREFIX)) throw new Error("Invalid join token prefix.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token.slice(TOKEN_PREFIX.length), "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid join token encoding.");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid join token payload.");
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
    (body.dns !== undefined && typeof body.dns !== "string") ||
    (body.advertisedRoutes !== undefined && (!Array.isArray(body.advertisedRoutes) || !body.advertisedRoutes.every((r) => typeof r === "string")))
  ) {
    throw new Error("Invalid join token payload.");
  }
  return body as unknown as JoinToken;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function openTokenDb(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  return db;
}

function ensureUnusedToken(db: DatabaseSync, token: string): void {
  const hash = tokenHash(token);
  if (db.prepare("SELECT 1 FROM meta WHERE key = ?").get(`${META_PREFIX}${hash}`)) {
    throw new Error("This join token has already been used.");
  }
}

function markTokenUsed(db: DatabaseSync, token: string): void {
  const hash = tokenHash(token);
  db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)").run(
    `${META_PREFIX}${hash}`,
    new Date().toISOString(),
  );
}

function renderConf(token: JoinToken, outIface?: string): string {
  const lines = [
    "[Interface]",
    `PrivateKey = ${token.privateKey}`,
    `Address = ${token.clientAddress}`,
  ];
  if (token.dns) lines.push(`DNS = ${token.dns}`);
  if (outIface) {
    lines.push(
      `PostUp = iptables -A FORWARD -i %i -j ACCEPT; iptables -A FORWARD -o %i -j ACCEPT; iptables -t nat -A POSTROUTING -o ${outIface} -j MASQUERADE`,
      `PostDown = iptables -D FORWARD -i %i -j ACCEPT; iptables -D FORWARD -o %i -j ACCEPT; iptables -t nat -D POSTROUTING -o ${outIface} -j MASQUERADE`,
    );
  }
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

function detectDefaultIface(): string | undefined {
  const result = spawnSync("ip", ["route", "show", "default"], { encoding: "utf8" });
  return result.stdout?.match(/\bdev\s+(\S+)/)?.[1];
}

function isIpForwardEnabled(): boolean {
  try {
    return readFileSync("/proc/sys/net/ipv4/ip_forward", "utf8").trim() === "1";
  } catch {
    return false;
  }
}

function enableIpForward(iface: string): void {
  spawnSync("sysctl", ["-w", "net.ipv4.ip_forward=1"], { stdio: "inherit" });
  writeFileSync(`/etc/sysctl.d/99-wgctl-${iface}.conf`, "net.ipv4.ip_forward=1\n", { mode: 0o644 });
}

function checkWgQuick(): void {
  if (spawnSync("which", ["wg-quick"], { stdio: "ignore" }).status !== 0) {
    throw new Error(
      "wg-quick not found. Install wireguard-tools first:\n\n" +
        "  Debian/Ubuntu:  apt-get install wireguard-tools\n" +
        "  Fedora/RHEL:    dnf install wireguard-tools\n" +
        "  Alpine:         apk add wireguard-tools\n",
    );
  }
}

function pathsForIface(iface: string) {
  return {
    confPath: `/etc/wireguard/${iface}.conf`,
    dbPath: `/etc/wgctl/${iface}-tokens.sqlite`,
    unitName: `wg-quick@${iface}`,
  };
}

function maybeRemove(path: string): void {
  if (!existsSync(path)) return;
  rmSync(path, { recursive: true, force: true });
  console.log(`Removed ${path}`);
}

export async function removeJoinCommand(args: string[]): Promise<void> {
  let parsed: ReturnType<typeof parseRemoveArgs>;
  try {
    parsed = parseRemoveArgs(args);
    if (parsed.help) { usage(); return; }
    assertIface(parsed.iface);
  } catch (err: any) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }

  const { iface, yes } = parsed;
  const paths = pathsForIface(iface);

  if (!existsSync(paths.confPath)) {
    console.log(`No joined connection found for ${iface} (${paths.confPath} missing).`);
    return;
  }

  if (!yes) {
    console.log(`This will stop ${paths.unitName} and remove ${paths.confPath}`);
    const { askText } = await import("../client/prompts.js");
    const answer = await askText("Continue? [y/N]: ");
    if (answer.trim().toLowerCase() !== "y") {
      console.log("Aborted - nothing was changed.");
      return;
    }
  }

  spawnSync("systemctl", ["disable", "--now", paths.unitName], { stdio: "ignore" });
  maybeRemove(paths.confPath);
  maybeRemove(paths.dbPath);
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
  let rawToken: string;

  try {
    parsed = parseArgs(args);
    if (parsed.help || !parsed.token) {
      usage();
      process.exitCode = parsed.help ? 0 : 1;
      return;
    }
    iface = parsed.iface;
    assertIface(iface);
    rawToken = parsed.token;
    token = decodeToken(rawToken);
    checkWgQuick();
  } catch (err: any) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }

  const paths = pathsForIface(iface);

  let db: DatabaseSync;
  try {
    db = openTokenDb(paths.dbPath);
    ensureUnusedToken(db, rawToken);
  } catch (err: any) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }

  if (existsSync(paths.confPath) && !parsed.force) {
    console.error(`${paths.confPath} already exists. Use --force to overwrite it.`);
    process.exitCode = 1;
    return;
  }

  const advertisedRoutes = token.advertisedRoutes ?? [];
  let outIface: string | undefined;

  if (advertisedRoutes.length > 0) {
    outIface = detectDefaultIface();
    if (!outIface) {
      console.warn("Warning: could not detect default outbound interface — skipping PostUp/PostDown iptables rules.");
      console.warn("Add masquerade rules manually after joining.");
    }
  }

  mkdirSync("/etc/wireguard", { recursive: true, mode: 0o700 });
  writeFileSync(paths.confPath, renderConf(token, outIface), { mode: 0o600 });
  console.log(`Wrote ${paths.confPath} for ${token.label}.`);

  if (advertisedRoutes.length > 0) {
    if (!isIpForwardEnabled()) {
      console.log("Enabling IP forwarding (required to advertise routes)...");
      enableIpForward(iface);
    } else {
      console.log("IP forwarding already enabled.");
    }
    if (outIface) {
      console.log(`Routes ${advertisedRoutes.join(", ")} will be masqueraded via ${outIface}.`);
    }
  }

  execFileSync("systemctl", ["enable", "--now", paths.unitName], { stdio: "inherit" });

  markTokenUsed(db, rawToken);

  console.log(`\nConnected ${iface} (${token.clientAddress}) → ${token.endpoint}`);
  if (advertisedRoutes.length > 0) {
    console.log(`Advertising to network: ${advertisedRoutes.join(", ")}`);
  }
  console.log(`Status: systemctl status ${paths.unitName}`);
}
