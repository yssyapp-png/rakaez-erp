import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../src/db/pool.js";
import { migrationFiles } from "../src/db/migrations.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.resolve(root, "../src/db");
const client = await pool.connect();
try {
  await client.query("SELECT pg_advisory_lock(731954201)");
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  const databaseState = await client.query("SELECT to_regclass('public.organizations') AS organizations");
  if (!databaseState.rows[0].organizations) {
    const schema = await fs.readFile(path.join(migrationsDirectory, "schema.sql"), "utf8");
    console.log("[migrate] initializing a new database from schema.sql");
    await client.query("BEGIN");
    try {
      await client.query(schema);
      for (const name of migrationFiles) {
        const sql = await fs.readFile(path.join(migrationsDirectory, name), "utf8");
        const checksum = crypto.createHash("sha256").update(sql).digest("hex");
        await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1,$2)", [name, checksum]);
      }
      await client.query("COMMIT");
      console.log("[migrate] new database initialized");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  for (const name of migrationFiles) {
    const sql = await fs.readFile(path.join(migrationsDirectory, name), "utf8");
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");
    const existing = await client.query("SELECT checksum FROM schema_migrations WHERE name = $1", [name]);
    if (existing.rows[0]) {
      if (existing.rows[0].checksum !== checksum) {
        throw new Error(`Previously applied migration was modified: ${name}`);
      }
      console.log(`[migrate] already applied: ${name}`);
      continue;
    }
    console.log(`[migrate] applying: ${name}`);
    const body = sql.replace(/^\s*BEGIN;\s*/i, "").replace(/\s*COMMIT;\s*$/i, "");
    await client.query("BEGIN");
    try {
      await client.query(body);
      await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1,$2)", [name, checksum]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
  console.log("[migrate] database is up to date");
} finally {
  await client.query("SELECT pg_advisory_unlock(731954201)").catch(() => {});
  client.release();
  await pool.end();
}
