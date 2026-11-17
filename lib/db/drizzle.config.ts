import { defineConfig } from "drizzle-kit";
import path from "path";

// Local dev keeps one shared .env at the repo root (README.md). Load it if it
// exists; real environment variables (CI, hosting) always win.
try {
  process.loadEnvFile(path.resolve(__dirname, "../../.env"));
} catch {
  // No .env file — fine in CI and production.
}

// Schema changes go over a direct (unpooled) connection when the host offers one.
const url =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL;

if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env at the repo root and point it at your Postgres (see README.md).",
  );
}

export default defineConfig({
  // Normalize to forward slashes: drizzle-kit's glob treats the "\" in Windows
  // paths as an escape char and fails to find the schema. No-op on Linux.
  schema: path.join(__dirname, "./src/schema/index.ts").replace(/\\/g, "/"),
  dialect: "postgresql",
  dbCredentials: {
    url,
  },
});
