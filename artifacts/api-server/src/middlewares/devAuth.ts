import { Router, type IRouter, type Request, type Response } from "express";
import { eq, like } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

/**
 * Local "dev auth" mode.
 *
 * Production auth is Clerk. Running the app locally used to require a Clerk
 * account, Clerk keys, and an email on the invite allow-list before a new
 * contributor could see a single screen. With AUTH_MODE=dev the API instead
 * trusts a cookie naming one of the seeded demo accounts (see
 * `pnpm run db:seed`), so the whole app runs offline with zero third-party
 * accounts.
 *
 * Safety: dev auth refuses to start when NODE_ENV=production, and it only
 * ever signs in as users whose id starts with DEV_USER_PREFIX — accounts that
 * the seed script created. It can never impersonate a real Clerk user.
 */
export const DEV_AUTH_ENABLED = process.env.AUTH_MODE === "dev";
export const DEV_USER_PREFIX = "demo_";
const COOKIE = "lms_dev_user";

/**
 * A public demo site (fictional data only, banner on every page) may run demo
 * sign-in in production, but only when it says so explicitly with
 * PUBLIC_DEMO=true. A real deployment that accidentally carries AUTH_MODE=dev
 * still refuses to start.
 */
export const PUBLIC_DEMO = process.env.PUBLIC_DEMO === "true";

if (DEV_AUTH_ENABLED && process.env.NODE_ENV === "production" && !PUBLIC_DEMO) {
  throw new Error(
    "AUTH_MODE=dev is a local-development convenience and must never run with NODE_ENV=production. Unset AUTH_MODE (or, for a public demo with fictional data only, set PUBLIC_DEMO=true).",
  );
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** The signed-in demo user id from the dev cookie, or null. */
export function getDevUserId(req: Request): string | null {
  if (!DEV_AUTH_ENABLED) return null;
  const id = readCookie(req, COOKIE);
  return id && id.startsWith(DEV_USER_PREFIX) ? id : null;
}

/** Routes that only exist in dev auth mode: list demo users, sign in, sign out. */
export function devAuthRouter(): IRouter {
  const router: IRouter = Router();

  router.get("/dev/users", async (_req: Request, res: Response) => {
    const users = await db
      .select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        role: usersTable.role,
        isAdmin: usersTable.isAdmin,
      })
      .from(usersTable)
      .where(like(usersTable.id, `${DEV_USER_PREFIX}%`))
      .orderBy(usersTable.id);
    res.json(users);
  });

  router.get("/dev/session", (req: Request, res: Response) => {
    res.json({ userId: getDevUserId(req) });
  });

  router.post("/dev/login", async (req: Request, res: Response) => {
    const userId = typeof req.body?.userId === "string" ? req.body.userId : "";
    if (!userId.startsWith(DEV_USER_PREFIX)) {
      res.status(400).json({ error: "Pick one of the demo accounts." });
      return;
    }
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) {
      res.status(404).json({
        error: "That demo account does not exist yet. Run `pnpm run db:seed` and try again.",
      });
      return;
    }
    res.cookie(COOKIE, userId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
    });
    res.json({ userId });
  });

  router.post("/dev/logout", (_req: Request, res: Response) => {
    res.clearCookie(COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  return router;
}
