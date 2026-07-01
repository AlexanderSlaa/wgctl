import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let db: DatabaseSync | undefined;

export function getDb(): DatabaseSync {
  if (!db) {
    mkdirSync(dirname(config.dbPath), { recursive: true });
    db = new DatabaseSync(config.dbPath);
    const schema = readFileSync(join(__dirname, "schema.sql"), "utf8");
    db.exec(schema);
    // Migration: add routes column to existing databases.
    try {
      db.exec("ALTER TABLE peers ADD COLUMN routes TEXT NOT NULL DEFAULT ''");
    } catch {
      // Column already exists — safe to ignore.
    }
  }
  return db;
}
