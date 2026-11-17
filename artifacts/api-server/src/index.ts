import app from "./app";
import { pruneOldActivityLogs } from "./lib/activityLog";
import { logger } from "./lib/logger";

// Defaults to 8080 — the port the docs, the Vite dev proxy
// (artifacts/dempo/vite.config.ts) and the old Replit config all assume.
const rawPort = process.env["PORT"] || "8080";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Prune activity logs past their retention window on startup, so old rows
  // are cleaned even during quiet periods with few log writes.
  void pruneOldActivityLogs();
});
