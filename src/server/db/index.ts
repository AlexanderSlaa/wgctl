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
  }
  return db;
}
