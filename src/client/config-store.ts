import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".config", "wgctl");
const SESSION_PATH = join(CONFIG_DIR, "session.json");
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
  mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
}

export function loadSession(): SessionData | undefined {
  if (!existsSync(SESSION_PATH)) return undefined;
  return JSON.parse(readFileSync(SESSION_PATH, "utf8"));
}

export function saveSession(session: SessionData): void {
  ensureConfigDir();
  writeFileSync(SESSION_PATH, JSON.stringify(session, null, 2), { mode: 0o600 });
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
