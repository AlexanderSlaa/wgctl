import { Router, json, error } from "@sourceregistry/node-webserver";
import type { LoginResponse } from "../../shared/index.js";
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { createUser, findUserByUsername, verifyCredentials } from "../db/users.repo.js";
import { createSession, deleteSession } from "../auth/session.js";
import { getDb } from "../db/index.js";
import { config } from "../config.js";

export const authRoutes = new Router();

function tokenEquals(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function getOrCreateSetupUser() {
  const existing = findUserByUsername(config.setupUsername);
  if (existing) return existing;
  return createUser(config.setupUsername, randomBytes(32).toString("base64url"), "admin");
}

authRoutes.POST("/auth/login", async (event) => {
  const body = (await event.request.json()) as Record<string, unknown> | null;

  if (!body || typeof body !== "object") {
    error(400, { message: "login request body is required" });
  }

  if ("setupToken" in body) {
    if (!config.setupToken) {
      error(401, { message: "Setup token login is not enabled on this server" });
    }
    if (typeof body.setupToken !== "string" || !tokenEquals(body.setupToken, config.setupToken)) {
      error(401, { message: "Invalid setup token" });
    }
    // One-time use: atomically mark this token as consumed via its SHA-256 hash.
    // INSERT OR IGNORE returns changes=0 if the row already exists (already consumed).
    const tokenHash = createHash("sha256").update(config.setupToken).digest("hex");
    const consumed = getDb()
      .prepare("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)")
      .run(`setup_token_hash:${tokenHash}`, new Date().toISOString());
    if (consumed.changes === 0) {
      error(401, { message: "Setup token has already been used" });
    }
    const user = getOrCreateSetupUser();
    const { token, expiresAt } = createSession(user.username);
    const response: LoginResponse = { token, username: user.username, expiresAt };
    return json(response, { status: 200 });
  }

  if (typeof body.username !== "string" || typeof body.password !== "string") {
    error(400, { message: "username and password are required" });
  }
  const user = verifyCredentials(body.username, body.password);
  if (!user) {
    error(401, { message: "Invalid credentials" });
  }
  const { token, expiresAt } = createSession(user.username);
  const response: LoginResponse = { token, username: user.username, expiresAt };
  return json(response, { status: 200 });
});

// Revoke the caller's own session (logout). Best-effort: always returns 204
// so the client removes local credentials regardless of server state.
authRoutes.DELETE("/auth/session", async (event) => {
  const authHeader = event.request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : undefined;
  if (token) deleteSession(token);
  return new Response(null, { status: 204 });
});
