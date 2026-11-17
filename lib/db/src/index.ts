import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// DATABASE_URL locally and in CI; POSTGRES_URL is what Vercel's Postgres
// integrations (Neon, Supabase) inject.
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL must be set. Copy .env.example to .env at the repo root (see README.md).",
  );
}

/**
 * TLS for the database connection.
 *
 * - localhost: no TLS (local Postgres).
 * - Otherwise: encrypted AND certificate-verified by default (Neon and most
 *   managed Postgres present valid certificates).
 * - DATABASE_TLS_INSECURE=true: encrypted but not verified — only for poolers
 *   that present a self-signed chain (e.g. Supabase Supavisor).
 *
 * The sslmode query parameter is removed so this explicit setting is the only
 * one in force (pg also warns about sslmode=require semantics changing).
 */
export function databaseConnectionOptions(url: string): { connectionString: string; ssl: undefined | { rejectUnauthorized: boolean } } {
  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  let cleaned = url;
  try {
    const u = new URL(url);
    u.searchParams.delete("sslmode");
    cleaned = u.toString();
  } catch {
    // Not a URL we can parse; leave it untouched.
  }
  if (isLocal) return { connectionString: cleaned, ssl: undefined };
  return {
    connectionString: cleaned,
    ssl: { rejectUnauthorized: process.env.DATABASE_TLS_INSECURE !== "true" },
  };
}

export const pool = new Pool({
  ...databaseConnectionOptions(connectionString),
});
export const db = drizzle(pool, { schema });

export * from "./schema";
