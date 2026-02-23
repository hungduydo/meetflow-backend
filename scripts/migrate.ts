#!/usr/bin/env tsx
// scripts/migrate.ts
// Run DB migrations directly via Supabase service-role client.
// Usage:  npm run db:migrate
//         npm run db:migrate -- --rollback   (drop all tables, re-run)

import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import "dotenv/config";

// ── Env validation (minimal — only what migrate needs) ────────────────────────
const env = z
  .object({
    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  })
  .parse(process.env);

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "../src/db/migrations");

// ── Migration tracking table ──────────────────────────────────────────────────
const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS _migrations (
  id          SERIAL PRIMARY KEY,
  filename    TEXT UNIQUE NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

async function runSQL(sql: string, label = ""): Promise<void> {
  // Supabase JS doesn't expose raw SQL — we use the REST /rpc workaround
  // by calling a pg function. Instead, we split statements and run them
  // via the supabase.rpc("exec_sql") pattern, which requires a helper fn.
  //
  // Better approach: use postgres.js or pg directly with the DB connection string.
  // For projects using Supabase, the DB connection string is available in:
  //   Dashboard → Settings → Database → Connection string (URI)

  // Detect if a direct DB URL is available (preferred for migrations)
  const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

  if (dbUrl) {
    await runViaPg(dbUrl, sql, label);
  } else {
    await runViaRpc(sql, label);
  }
}

// ── Strategy A: Direct PostgreSQL via `pg` ────────────────────────────────────
async function runViaPg(dbUrl: string, sql: string, label: string): Promise<void> {
  // Dynamically import pg so the script works even if pg isn't installed
  let Client: typeof import("pg").Client;
  try {
    ({ Client } = await import("pg"));
  } catch {
    console.error("❌ `pg` package not found. Run: npm install --save-dev pg @types/pg");
    process.exit(1);
  }

  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql);
    if (label) console.log(`   ✓ ${label}`);
  } finally {
    await client.end();
  }
}

// ── Strategy B: Supabase RPC (requires exec_sql function to exist) ─────────────
async function runViaRpc(sql: string, label: string): Promise<void> {
  // Split on semicolons, skip blank statements
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  for (const stmt of statements) {
    const { error } = await supabase.rpc("exec_sql", { sql: stmt });
    if (error) {
      // Ignore "already exists" errors for idempotent migrations
      if (error.message.includes("already exists")) continue;
      throw new Error(`SQL error${label ? ` in ${label}` : ""}: ${error.message}\nStatement: ${stmt.slice(0, 120)}…`);
    }
  }
  if (label) console.log(`   ✓ ${label}`);
}

// ── Check which migrations have already been applied ─────────────────────────
async function getApplied(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("_migrations")
    .select("filename");
  if (error) return new Set(); // table doesn't exist yet — that's fine
  return new Set((data ?? []).map((r: { filename: string }) => r.filename));
}

async function markApplied(filename: string): Promise<void> {
  await supabase.from("_migrations").insert({ filename });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function migrate() {
  const isRollback = process.argv.includes("--rollback");

  console.log("\n🗄️  MeetFlow AI — Database Migration");
  console.log("────────────────────────────────────");
  console.log(`Target: ${env.SUPABASE_URL}`);

  if (isRollback) {
    console.log("\n⚠️  Rolling back ALL tables…");
    const rollbackSql = readFileSync(
      join(MIGRATIONS_DIR, "rollback.sql"),
      "utf-8"
    );
    await runSQL(rollbackSql, "rollback.sql");
    console.log("✅ Rollback complete. Re-run without --rollback to migrate.\n");
    return;
  }

  // Bootstrap migration tracking
  await runSQL(BOOTSTRAP_SQL, "_migrations tracking table");

  // Read + sort migration files
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && f !== "rollback.sql")
    .sort();

  if (!files.length) {
    console.log("No migration files found in", MIGRATIONS_DIR);
    return;
  }

  const applied = await getApplied();
  const pending = files.filter((f) => !applied.has(f));

  if (!pending.length) {
    console.log("\n✅ All migrations already applied.\n");
    return;
  }

  console.log(`\nApplied : ${applied.size} migration(s)`);
  console.log(`Pending : ${pending.length} migration(s)\n`);

  for (const filename of pending) {
    process.stdout.write(`→ ${filename} … `);
    const sql = readFileSync(join(MIGRATIONS_DIR, filename), "utf-8");
    try {
      await runSQL(sql, filename);
      await markApplied(filename);
      console.log("✅");
    } catch (err) {
      console.log("❌");
      console.error(`\nFailed on ${filename}:`);
      console.error((err as Error).message);
      process.exit(1);
    }
  }

  console.log(`\n✅ ${pending.length} migration(s) applied successfully.\n`);
}

migrate();
