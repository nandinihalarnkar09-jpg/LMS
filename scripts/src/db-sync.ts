/**
 * Non-interactive schema sync for deployments (used by scripts/deploy-db.mjs).
 *
 * `drizzle-kit push` asks questions on a TTY, which a Vercel build doesn't
 * have — and against Neon (Postgres 17) it re-proposes unique constraints that
 * already exist, then stops at "Do you want to truncate …?". This script uses
 * drizzle-kit's programmatic API instead and:
 *
 *   - skips statements that re-create a constraint/index that already exists
 *     (and the matching DROP of a drop-and-re-add pair),
 *   - applies everything else (new tables, columns, indexes),
 *   - refuses statements that would lose data (DROP TABLE/COLUMN, TRUNCATE,
 *     type changes) unless ALLOW_SCHEMA_DATA_LOSS=true — a production
 *     database is never silently truncated by a deploy.
 *
 * Usage: pnpm --filter @workspace/scripts run db-sync [-- --dry-run]
 */
import { pushSchema } from "drizzle-kit/api";
import { sql } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { db, pool } from "@workspace/db";
import * as schema from "@workspace/db/schema";

const dryRun = process.argv.includes("--dry-run");

const ADD_CONSTRAINT = /ADD CONSTRAINT\s+"([^"]+)"/i;
const DROP_CONSTRAINT = /DROP CONSTRAINT\s+"([^"]+)"/i;
const CREATE_INDEX = /CREATE (?:UNIQUE )?INDEX(?: IF NOT EXISTS)?\s+"([^"]+)"/i;
const DROP_INDEX = /DROP INDEX(?: IF EXISTS)?\s+"([^"]+)"/i;
const DATA_LOSS = /\b(DROP TABLE|DROP COLUMN|TRUNCATE|ALTER COLUMN\s+"[^"]+"\s+SET DATA TYPE)\b/i;

async function existingNames(): Promise<Set<string>> {
  const res = await db.execute(sql`
    select conname as name from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public'
    union
    select indexname as name from pg_indexes where schemaname = 'public'
  `);
  return new Set((res.rows as { name: string }[]).map((r) => r.name));
}

/**
 * drizzle-kit's planner stops to ask "truncate this table?" before adding a
 * unique constraint to a table that has rows — even when no duplicates exist.
 * Add any missing named unique constraints ourselves first (Postgres rejects
 * the statement if there really are duplicates, which is the right outcome).
 */
async function ensureUniqueConstraints(): Promise<void> {
  for (const value of Object.values(schema)) {
    if (!(value instanceof PgTable)) continue;
    const cfg = getTableConfig(value);
    for (const uc of cfg.uniqueConstraints) {
      const name = uc.getName();
      const exists = await db.execute(sql`select 1 from pg_constraint where conname = ${name}`);
      const tableExists = await db.execute(sql`select 1 from information_schema.tables where table_schema = 'public' and table_name = ${cfg.name}`);
      if (exists.rows.length || !tableExists.rows.length) continue;
      const cols = uc.columns.map((c) => `"${c.name}"`).join(", ");
      console.log(`[db-sync] adding missing unique constraint ${name} on ${cfg.name} (${cols})`);
      if (!dryRun) await db.execute(sql.raw(`ALTER TABLE "${cfg.name}" ADD CONSTRAINT "${name}" UNIQUE (${cols})`));
    }
  }
}

async function main(): Promise<void> {
  await ensureUniqueConstraints();
  const plan = await pushSchema(schema as Record<string, unknown>, db as never);
  const statements = plan.statementsToExecute;
  if (statements.length === 0) {
    console.log("[db-sync] Schema is up to date.");
    return;
  }

  const existing = await existingNames();
  const readded = new Set(
    statements.map((s) => s.match(ADD_CONSTRAINT)?.[1] ?? s.match(CREATE_INDEX)?.[1]).filter((x): x is string => !!x),
  );
  const toRun: string[] = [];
  const skipped: string[] = [];
  for (const s of statements) {
    const added = s.match(ADD_CONSTRAINT)?.[1] ?? s.match(CREATE_INDEX)?.[1];
    const dropped = s.match(DROP_CONSTRAINT)?.[1] ?? s.match(DROP_INDEX)?.[1];
    if (added && existing.has(added)) {
      skipped.push(s);
      continue;
    }
    if (dropped && readded.has(dropped) && existing.has(dropped)) {
      skipped.push(s); // drop-and-re-add of an identical, existing object
      continue;
    }
    toRun.push(s);
  }

  if (skipped.length) console.log(`[db-sync] Skipping ${skipped.length} statement(s) for objects that already exist.`);
  if (toRun.length === 0) {
    console.log("[db-sync] Schema is up to date.");
    return;
  }

  const lossy = toRun.filter((s) => DATA_LOSS.test(s));
  if (lossy.length && process.env.ALLOW_SCHEMA_DATA_LOSS !== "true") {
    console.error("[db-sync] Refusing to apply statements that would lose data:");
    for (const s of lossy) console.error("  " + s.replace(/\s+/g, " ").slice(0, 200));
    console.error("Review them, migrate the data deliberately, or set ALLOW_SCHEMA_DATA_LOSS=true for a throwaway database.");
    process.exitCode = 1;
    return;
  }

  for (const s of toRun) {
    console.log(`[db-sync] ${dryRun ? "would run" : "run"}: ${s.replace(/\s+/g, " ").slice(0, 160)}`);
    if (!dryRun) await db.execute(sql.raw(s));
  }
  console.log(`[db-sync] ${dryRun ? "Dry run: " : ""}${toRun.length} statement(s) ${dryRun ? "planned" : "applied"}.`);
}

main()
  .catch((err) => {
    console.error("[db-sync] failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
