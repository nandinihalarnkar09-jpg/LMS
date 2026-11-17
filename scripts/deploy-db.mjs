#!/usr/bin/env node
// Runs at the end of the Vercel build (vercel.json buildCommand).
//
// - AUTO_MIGRATE=true or PUBLIC_DEMO=true: apply lib/db/src/schema to the
//   database the host injected (DATABASE_URL / POSTGRES_URL). The connection
//   string never leaves the hosting provider.
// - PUBLIC_DEMO=true: also load the fictional demo college if it isn't there.
// - Otherwise: do nothing — schema changes on a real deployment stay a
//   deliberate, reviewed step (README.md).
import { spawnSync } from "node:child_process";

const demo = process.env.PUBLIC_DEMO === "true";
const migrate = demo || process.env.AUTO_MIGRATE === "true";
const hasDb = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL);

if (!migrate) {
  console.log("[deploy-db] AUTO_MIGRATE/PUBLIC_DEMO not set — skipping schema push.");
  process.exit(0);
}
if (!hasDb) {
  console.error("[deploy-db] No DATABASE_URL or POSTGRES_URL in the build environment. Connect a Postgres database to this project, then redeploy.");
  process.exit(1);
}

function run(args) {
  console.log(`[deploy-db] pnpm ${args.join(" ")}`);
  const r = spawnSync("pnpm", args, { stdio: "inherit", env: process.env, shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run(["--filter", "@workspace/db", "run", "push-force"]);
if (demo) run(["--filter", "@workspace/scripts", "run", "seed"]);
console.log("[deploy-db] done");
