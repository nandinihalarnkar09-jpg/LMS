import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/** True when an S3-compatible bucket is configured for file uploads. */
export function uploadsEnabled(): boolean {
  return Boolean(
    process.env.STORAGE_ENDPOINT &&
      process.env.STORAGE_BUCKET &&
      process.env.STORAGE_ACCESS_KEY &&
      process.env.STORAGE_SECRET_KEY,
  );
}

// Public, non-secret switches the web app needs before sign-in.
router.get("/config", (_req, res) => {
  res.json({
    uploadsEnabled: uploadsEnabled(),
    publicDemo: process.env.PUBLIC_DEMO === "true",
  });
});

export default router;
