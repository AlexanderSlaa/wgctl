import { randomBytes } from "node:crypto";
import { getDb } from "../db/index.js";
import { findUserByUsername } from "../db/users.repo.js";
import { config } from "../config.js";

export interface Session {
  username: string;
  role: "user" | "admin";
}

export function createSession(username: string): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + config.sessionTtlMs).toISOString();
  getDb().prepare("INSERT INTO sessions (token, username, expires_at) VALUES (?, ?, ?)").run(token, username, expiresAt);
  return { token, expiresAt };
}

export function lookupSession(token: string): Session | undefined {
  const row = getDb().prepare("SELECT username, expires_at FROM sessions WHERE token = ?").get(token) as
    | { username: string; expires_at: string }
    | undefined;
  if (!row) return undefined;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    getDb().prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return undefined;
  }
  const user = findUserByUsername(row.username);
  if (!user) return undefined;
  return { username: user.username, role: user.role };
}
