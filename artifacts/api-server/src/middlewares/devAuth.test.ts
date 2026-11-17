import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { inArray } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

// Dev auth is decided at import time, so switch it on before importing.
process.env.AUTH_MODE = "dev";
const { devAuthRouter, getDevUserId } = await import("./devAuth");
const { requireAuth } = await import("./auth");

const DEMO = "demo_test_devauth_student";
const REAL = "user_realclerkid_devauth";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // @ts-expect-error minimal logger stub for tests
    req.log = { warn: () => {}, info: () => {}, error: () => {} };
    next();
  });
  app.use("/api", devAuthRouter());
  app.get("/api/whoami", requireAuth, (req, res) => {
    res.json({ id: req.localUser!.id });
  });
  return app;
}
const app = buildApp();

async function cleanup() {
  await db.delete(usersTable).where(inArray(usersTable.id, [DEMO, REAL]));
}

beforeAll(async () => {
  await cleanup();
  await db.insert(usersTable).values([
    { id: DEMO, email: "devauth@demo.college.test", role: "student" },
    { id: REAL, email: "real@college.example", role: "teacher", isAdmin: true },
  ]);
});
afterAll(cleanup);

describe("dev auth (AUTH_MODE=dev)", () => {
  it("rejects requests with no dev cookie", async () => {
    const res = await request(app).get("/api/whoami");
    expect(res.status).toBe(401);
  });

  it("only signs in as seeded demo_ accounts", async () => {
    const res = await request(app).post("/api/dev/login").send({ userId: REAL });
    expect(res.status).toBe(400);
  });

  it("explains how to fix a missing demo account", async () => {
    const res = await request(app).post("/api/dev/login").send({ userId: "demo_does_not_exist" });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/db:seed/);
  });

  it("signs in a demo account and authenticates later requests", async () => {
    const login = await request(app).post("/api/dev/login").send({ userId: DEMO });
    expect(login.status).toBe(200);
    const cookie = login.headers["set-cookie"];
    expect(cookie?.[0]).toMatch(/HttpOnly/i);
    const me = await request(app).get("/api/whoami").set("Cookie", cookie);
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(DEMO);
  });

  it("ignores a forged cookie naming a non-demo user", async () => {
    const res = await request(app).get("/api/whoami").set("Cookie", `lms_dev_user=${REAL}`);
    expect(res.status).toBe(401);
    expect(getDevUserId({ headers: { cookie: `lms_dev_user=${REAL}` } } as never)).toBeNull();
  });
});
