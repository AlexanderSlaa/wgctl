import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".config", "wgctl");
const SESSIONS_DIR = join(CONFIG_DIR, "sessions");
const DEFAULT_SERVER_PATH = join(CONFIG_DIR, "default-server");
const KEYS_DIR = join(CONFIG_DIR, "keys");

export interface SessionData {
  serverUrl: string;
  token: string;
  username: string;
  /** TOFU-pinned SHA-256 fingerprint (hex) of the server's TLS certificate, captured on first login. */
  certFingerprint: string;
}

export interface KeyPair {
  privateKey: string;
  publicKey: string;
}

function ensureConfigDir(): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 });
  mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
}

function hostOf(serverUrl: string): string {
  return new URL(serverUrl).host;
}

function sessionPathFor(host: string): string {
  return join(SESSIONS_DIR, `${host}.json`);
}

/** Every server currently logged in to — useful for error messages when --server is ambiguous/required. */
export function listSessionHosts(): string[] {
  if (!existsSync(SESSIONS_DIR)) return [];
  return readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length));
}

/**
 * Sessions are stored per-server (one file per host under sessions/), since
 * a user may be logged in to more than one wgctl server at once. With no
 * `serverUrl`, falls back to whichever server was most recently logged in
 * to (tracked in `default-server`), or to the only stored session if
 * exactly one exists.
 */
export function loadSession(serverUrl?: string): SessionData | undefined {
  if (serverUrl) {
    const path = sessionPathFor(hostOf(serverUrl));
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
  }

  if (existsSync(DEFAULT_SERVER_PATH)) {
    const host = readFileSync(DEFAULT_SERVER_PATH, "utf8").trim();
    const path = sessionPathFor(host);
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  }

  const hosts = listSessionHosts();
  if (hosts.length === 1) {
    return JSON.parse(readFileSync(sessionPathFor(hosts[0]), "utf8"));
  }
  return undefined;
}

export function saveSession(session: SessionData): void {
  ensureConfigDir();
  const host = hostOf(session.serverUrl);
  writeFileSync(sessionPathFor(host), JSON.stringify(session, null, 2), { mode: 0o600 });
  writeFileSync(DEFAULT_SERVER_PATH, host, { mode: 0o600 });
}

export function removeSession(serverUrl: string): void {
  const path = sessionPathFor(hostOf(serverUrl));
  if (existsSync(path)) rmSync(path);
}

function keyPathFor(serverHost: string): string {
  return join(KEYS_DIR, `${serverHost}.json`);
}

export function loadKeyPair(serverHost: string): KeyPair | undefined {
  const path = keyPathFor(serverHost);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8"));
}

export function saveKeyPair(serverHost: string, keyPair: KeyPair): void {
  ensureConfigDir();
  writeFileSync(keyPathFor(serverHost), JSON.stringify(keyPair, null, 2), { mode: 0o600 });
}
