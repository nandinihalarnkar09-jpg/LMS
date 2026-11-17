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

export const pool = new Pool({
  connectionString,
  // In production keep TLS encryption on. We do NOT verify the CA
  // (rejectUnauthorized: false) because managed poolers — notably Supabase's
  // Supavisor — present a self-signed certificate in the chain, which strict
  // verification rejects with SELF_SIGNED_CERT_IN_CHAIN. Traffic is still
  // encrypted; local/CI Postgres (no TLS) leaves ssl off.
  ssl:
    process.env.NODE_ENV === "production" && !/@(localhost|127\.0\.0\.1)[:/]/.test(connectionString)
      ? { rejectUnauthorized: false }
      : undefined,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
