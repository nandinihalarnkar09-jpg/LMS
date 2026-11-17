#!/usr/bin/env node
// pnpm run dev — start the API (port 8080) and the web app (port 5173) together.
//
// Cross-platform replacement for dev.ps1 (which only works in Windows
// PowerShell). Reads the shared .env at the repo root, then runs both servers
// in this terminal with prefixed output. Ctrl+C stops both.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env");

if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
} else {
  console.error(
    "No .env at the repo root. Create one first:\n\n  cp .env.example .env\n\nThen run: pnpm run db:push && pnpm run db:seed && pnpm run dev",
  );
  process.exit(1);
}

for (const key of ["DATABASE_URL"]) {
  if (!process.env[key]) console.warn(`[dev] ${key} is empty in .env — the API will not start until it is set.`);
}
if (process.env.AUTH_MODE !== "dev" && !process.env.CLERK_SECRET_KEY) {
  console.warn("[dev] No CLERK_SECRET_KEY and AUTH_MODE is not 'dev'. Sign-in will fail. Set AUTH_MODE=dev and VITE_AUTH_MODE=dev for local demo accounts.");
}

const apiPort = process.env.API_PORT || "8080";
const webPort = process.env.WEB_PORT || "5173";
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const procs = [];
function run(name, color, args, extraEnv) {
  const child = spawn(pnpm, args, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  const tag = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) =>
    stream.on("data", (buf) => {
      for (const line of buf.toString().split(/\r?\n/)) if (line) out.write(tag + line + "\n");
    });
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => {
    console.log(`${tag}exited with code ${code}`);
    shutdown(code ?? 0);
  });
  procs.push(child);
}

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) if (!p.killed) p.kill();
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run("api", "36", ["--filter", "@workspace/api-server", "run", "dev"], { PORT: apiPort });
run("web", "35", ["--filter", "@workspace/dempo", "run", "dev"], {
  PORT: webPort,
  BASE_PATH: process.env.BASE_PATH || "/",
  API_PROXY_TARGET: process.env.API_PROXY_TARGET || `http://localhost:${apiPort}`,
});

console.log(`\n  API  → http://localhost:${apiPort}/api/healthz\n  Web  → http://localhost:${webPort}  (open this)\n`);
