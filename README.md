# LMS · Dempo College

A learning platform for **Srinivassa Sinai Dempo College (Autonomous), Goa**, covering coursework, quizzes and marks for about 2,000 students and 200 staff. It is built to keep working on campus WiFi.

Faculty post materials and a session-by-session course plan, set assignments and **timed quizzes**, take attendance, and grade with rubrics and a weighted gradebook. Students submit work (text, files, links, audio, video), take quizzes that save as they type, and see their marks and feedback. Admins onboard whole batches from a **CSV roster**. Deans and course coordinators get oversight and analytics.

> **New here?** Read this file, then [`docs/takeover/`](docs/takeover/README.md). It covers what the product is, which documents to trust, what broke and why, how we compare with Google Classroom, and the plan.

---

## Run it locally (Windows, macOS or Linux)

**You need:** Node.js 22.12+ (24 recommended), PostgreSQL 16, and Git. You do **not** need any third-party accounts.

```bash
corepack enable                 # uses the pnpm version pinned in package.json (11.15.1)
pnpm install
cp .env.example .env            # Windows PowerShell: Copy-Item .env.example .env
# create the database the .env points at:  createuser -s lms -P  &&  createdb -O lms lms
pnpm run db:push                # create tables
pnpm run db:seed                # demo college: 12 accounts, 2 courses, a timed quiz…
pnpm run dev                    # API on :8080, web on :5173
```

Open **http://localhost:5173**, choose **Sign in**, and pick a demo account (student, faculty/admin, dean, or coordinator). Local sign-in works because `.env.example` sets `AUTH_MODE=dev`. The API **refuses to start** in that mode when `NODE_ENV=production`, and it only accepts the seeded `demo_` accounts.

Re-seed from scratch with `pnpm run db:seed --reset`.

| Command | What it does |
|---|---|
| `pnpm run dev` | API and web together, with prefixed logs (`scripts/dev.mjs`). `dev.ps1` still works on Windows |
| `pnpm test` | API integration tests (needs `DATABASE_URL`; CI uses a throwaway Postgres 16) |
| `pnpm run typecheck` | Builds the shared libraries, then typechecks every app |
| `pnpm --filter @workspace/api-spec run codegen` | Regenerates the API client and zod schemas from `lib/api-spec/openapi.yaml` |
| `pnpm run db:push` | Applies `lib/db/src/schema/` to the database (development only) |
| `python3 scripts/check-contrast.py` | Recomputes WCAG contrast ratios for the colour tokens |

**Real sign-in (Clerk):** remove the two `AUTH_MODE` lines from `.env` and set `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `VITE_CLERK_PUBLISHABLE_KEY` and `ADMIN_EMAILS`. Every other variable (storage, AI, email) is optional and documented in [`artifacts/api-server/.env.example`](artifacts/api-server/.env.example). **Never commit `.env`.**

## How it's built

| Piece | Where | Notes |
|---|---|---|
| Web app (React 19, Vite, Tailwind v4, shadcn/ui) | `artifacts/dempo/` | Design tokens in `src/index.css`; product identity in `src/lib/brand.ts` |
| API (Express 5) | `artifacts/api-server/` | Routes in `src/routes/`; auth in `src/middlewares/auth.ts` (Clerk) and `src/middlewares/devAuth.ts` (local) |
| Database schema (Drizzle, Postgres) | `lib/db/src/schema/` | Source of truth for data. **No foreign keys** (known gap) |
| API contract (OpenAPI → orval) | `lib/api-spec/openapi.yaml` → `lib/api-zod`, `lib/api-client-react` | Never hand-edit `generated/`. The admin invite and roster routes are not in the spec yet |
| Seed and dev tooling | `scripts/` | `scripts/src/seed.ts`, `scripts/dev.mjs`, `scripts/check-contrast.py` |
| CI | `.github/workflows/ci.yml` | Typecheck, test (Postgres 16) and build, on Node 22 and 24, with a frozen lockfile |

## Put a live demo online (Vercel + Neon, free tiers, ~5 minutes)

The repo is set up so nobody has to copy a database password or API key by hand. The database connection is injected by Vercel, and the build creates the tables and loads the fictional demo college (`scripts/deploy-db.mjs`).

1. **Vercel → Add New → Project →** import `LMS` from GitHub. Leave every build setting at its default; `vercel.json` drives the build.
2. Before you press Deploy, add three **Environment Variables**. These are plain switches, not secrets:
   `AUTH_MODE` = `dev` · `VITE_AUTH_MODE` = `dev` · `PUBLIC_DEMO` = `true`
3. Deploy. The first build stops with *"No DATABASE_URL… Connect a Postgres database"*. That's expected.
4. In the project: **Storage → Create Database → Neon →** region **Singapore (sin1)**, Auth off → **Create**, and connect it to the `LMS` project (all environments).
5. **Deployments → ⋯ → Redeploy.** Open the URL and choose any sample account.

What you get: every feature working on fictional data, a "Demo site" label on every page, and file uploads replaced by "share a link" until a storage bucket is connected. For a **real** college deployment, leave out the three switches and set Clerk keys and `ADMIN_EMAILS` instead (see `DEPLOY-VERCEL.md`). Without `PUBLIC_DEMO=true`, the API refuses to start in demo sign-in mode.

## Where it deploys
- **Production target: Vercel**, one project. The SPA is served from the CDN and the API runs as one serverless function in Singapore (`sin1`), next to the Neon database (Vercel's Neon integration offers no Mumbai region). See `vercel.json`, `api/index.mjs` and [`DEPLOY-VERCEL.md`](DEPLOY-VERCEL.md).
- **Database: Supabase (Mumbai), probably.** Commit `5b913b9` and [`MIGRATE-SUPABASE.md`](MIGRATE-SUPABASE.md) point that way. *TODO, unverified: the live region and storage provider aren't recorded in the repo.*
- `render.yaml` and `.replit` are older deploy targets, kept for reference. `ARCHITECTURE.md`'s DigitalOcean plan was never carried out.
- **Do not touch the original live deployment.** Deploy your own copy.

## Known broken or missing (as of this README)
- **Assignment lifecycle:** no resubmission, no late flag, no "return to student" (`artifacts/api-server/src/routes/submissions.ts`).
- **Indian academic gradebook:** no internal/external split, semester aggregation or SGPA/CGPA.
- **Uploads and email are off until configured:** object storage (`STORAGE_*`) and MSG91 (`MSG91_*`). Without a bucket, every file picker says "share a link instead" (`GET /api/config`). WhatsApp/SMS flags have no code behind them.
- **Not built, although `ARCHITECTURE.md` describes them:** Sentry error tracking, and name/roll-number redaction before AI grading. AI grading is **off** by default (`AI_GRADING_ENABLED=false`), and it should stay off until redaction exists.
- **Database TLS** is now encrypted *and* certificate-verified by default (`lib/db/src/index.ts`). Set `DATABASE_TLS_INSECURE=true` only for a pooler with a self-signed chain (Supabase Supavisor); that's what the original deployment needed.
- **Leftovers:** Replit config files and Vite plugins, plus the unused `artifacts/mockup-sandbox`.
- The full list of contradictions between documents is in [`docs/takeover/02-contradictions.md`](docs/takeover/02-contradictions.md).

## Where to look first
1. [`docs/takeover/01-orientation-brief.md`](docs/takeover/01-orientation-brief.md): what this is, in one page.
2. [`docs/takeover/02-contradictions.md`](docs/takeover/02-contradictions.md): which documents to believe. In short: code beats docs, and `DEPLOY-VERCEL.md` and `MIGRATE-SUPABASE.md` are newest. `PLAN.md` and `replit.md` are out of date.
3. [`docs/takeover/07-takeover-memo.md`](docs/takeover/07-takeover-memo.md): what we would do next, and what we refuse to do.

### Older documents (kept, but read with care)
[`ARCHITECTURE.md`](ARCHITECTURE.md) is the intended design, not the current state. [`PLAN.md`](PLAN.md) is out of date. [`DEPLOY.md`](DEPLOY.md) describes the Render demo. [`DEPLOY-VERCEL.md`](DEPLOY-VERCEL.md) is current. [`MIGRATE-SUPABASE.md`](MIGRATE-SUPABASE.md) is current. [`docs/email-setup.md`](docs/email-setup.md) is still accurate, but substitute Vercel for Render. [`replit.md`](replit.md) is historical.
