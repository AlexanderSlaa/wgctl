import { getDb } from "./index.js";
import { hashPassword, verifyPassword } from "../auth/password.js";

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: "user" | "admin";
}

export function findUserByUsername(username: string): UserRow | undefined {
  return getDb().prepare("SELECT * FROM users WHERE username = ?").get(username) as unknown as UserRow | undefined;
}

export function verifyCredentials(username: string, password: string): UserRow | undefined {
  const user = findUserByUsername(username);
  if (!user) return undefined;
  return verifyPassword(password, user.password_hash) ? user : undefined;
}

export function createUser(username: string, password: string, role: "user" | "admin" = "user"): UserRow {
  const passwordHash = hashPassword(password);
  getDb()
    .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
    .run(username, passwordHash, role);
  return findUserByUsername(username)!;
}

export function listUsers(): UserRow[] {
  return getDb().prepare("SELECT * FROM users ORDER BY id").all() as unknown as UserRow[];
}

export function deleteUser(username: string): void {
  const db = getDb();
  // sessions.username has no ON DELETE CASCADE (a session outliving its
  // user is never desirable, so it's just deleted outright rather than
  // cascaded) — without this, deleting a user with an active session fails
  // with a foreign key constraint error instead of removing the user.
  db.prepare("DELETE FROM sessions WHERE username = ?").run(username);
  db.prepare("DELETE FROM users WHERE username = ?").run(username);
}

export function setPassword(username: string, password: string): void {
  getDb().prepare("UPDATE users SET password_hash = ? WHERE username = ?").run(hashPassword(password), username);
}
