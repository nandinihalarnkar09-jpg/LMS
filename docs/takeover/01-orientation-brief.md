# Orientation brief (Task 1)

This brief is based on reading the root `.md` files in the order they were last changed, before installing anything. The dates come from `git log -1 --format=%ad -- <file>`:

| Last changed | File | What it is |
|---|---|---|
| 2026-07-20 | `replit.md` | Notes from the Replit agent. The oldest and most out of date |
| 2026-07-21 | `ARCHITECTURE.md` | The intended design: DigitalOcean (Bangalore), Sarvam AI, MSG91 |
| 2026-07-22 | `DEPLOY.md` | Free demo deploy on Render, using a US Neon database |
| 2026-07-23 | `docs/email-setup.md` | MSG91 email setup, written for Render |
| 2026-07-23 | `PLAN.md` | Staged "path to first sale". Payments dropped |
| 2026-07-24 | `DEPLOY-VERCEL.md` | Vercel deploy (the latest hosting choice) |
| 2026-07-24 | `MIGRATE-SUPABASE.md` | Runbook for moving the database from Neon to Supabase (Mumbai) |

The last commit is `02b6bc7` on 2026-08-01, "Fix course-plan autosave data loss". There are 61 commits in total, all by one author.

## What does the product do?
It is a teaching and learning platform for one college. Faculty create courses, post materials and a session-by-session course plan, set assignments (`artifacts/api-server/src/routes/assignments.ts`) and quizzes (`routes/quizzes.ts`), and grade with rubrics (`routes/rubrics.ts`) and a weighted gradebook (`routes/gradebook.ts`, `lib/gradebookWeighting.ts`). Students join courses, submit text, files, links, video or audio, and see their marks and feedback. There are also attendance (`routes/attendance.ts`), announcements, a discussion forum (`routes/discussions.ts`), direct messages (`routes/messaging.ts`), analytics with early alerts (`routes/analytics.ts`, `routes/earlyAlerts.ts`), a transcript CSV (`routes/transcript.ts`), and a DPDP data export (`routes/privacy.ts`).

AI grading suggestions exist but are **off by default**: `AI_GRADING_ENABLED` is checked in `lib/grading.ts`. The plagiarism check is local word-shingle similarity (`lib/similarity.ts`).

## Who are its users?
One college: Srinivassa Sinai Dempo College (Autonomous), Goa, with about 2,000 students (`ARCHITECTURE.md` header; `artifacts/dempo/src/pages/legal.tsx` `ORG`). The roles in the code are `student`, `teacher`, `dean` and `course_coordinator`, plus an `isAdmin` flag (`artifacts/dempo/src/router.tsx`, `lib/db/src/schema/users.ts`). Access is invite-only: an email must be on `app_invites` or in `ADMIN_EMAILS`, otherwise sign-in returns 403 `not_invited` (`artifacts/api-server/src/middlewares/auth.ts`).

## What is it built with?
- **Monorepo:** pnpm workspaces (`pnpm-workspace.yaml`), TypeScript 5.9 (`package.json`)
- **Web:** React 19, Vite, wouter, TanStack Query, shadcn/ui, Tailwind v4 (`artifacts/dempo/package.json`, `artifacts/dempo/components.json`)
- **API:** Express 5, Pino, helmet, express-rate-limit (`artifacts/api-server/package.json`), bundled with esbuild (`artifacts/api-server/build.mjs`)
- **Database:** PostgreSQL via Drizzle ORM and `pg` (`lib/db/src/index.ts`). There are 42 tables in `lib/db/src/schema/` and **no foreign keys** (`grep -c references( lib/db/src/schema` → 0)
- **API contract:** OpenAPI, with orval generating the client and zod schemas (`lib/api-spec/openapi.yaml`, `lib/api-spec/orval.config.ts`)
- **Auth:** Clerk (`@clerk/express`, `@clerk/react`). **Storage:** S3-compatible (`lib/objectStorage.ts`). **Email:** MSG91 (`lib/email.ts`)
- **Hosting:** Vercel is the current target, with a single serverless function in the Mumbai region (`vercel.json` `regions: ["bom1"]`, `api/index.mjs`). Render (`render.yaml`) and Replit (`.replit`) configs are leftovers
- **CI:** GitHub Actions typecheck, test against Postgres 16, and build (`.github/workflows/ci.yml`)

## What state is it in?
- **The code works, but the documentation does not describe it.** The code is far ahead of `ARCHITECTURE.md` and `PLAN.md`. Roster bulk-invite, the weighted gradebook, a DPDP export and VAPT hardening all exist, even though the docs list them as "to build". Meanwhile the docs promise things the code doesn't have: Sentry, identity stripping before AI calls, and WhatsApp/SMS. The full list is in [02-contradictions.md](02-contradictions.md).
- **Tests and CI were healthy.** At handover, CI was green on `main` (the last 11 runs passed; runs #1, #2 and #4 had failed). The 175 API tests pass on a local Postgres 16.
- **There was no README, and you could not run it locally without third-party accounts.** It needed a Clerk account, keys, and an email on the allow-list. On a Mac the install was broken. See [03-failure-log.md](03-failure-log.md).
- **Abandoned or half-finished work:** the Replit coupling the plan said to delete is still there (`.replit`, `.replitignore`, `@replit/*` Vite plugins in `artifacts/dempo/vite.config.ts`). `artifacts/mockup-sandbox` is unused. `replit.md` mentions a seeded "DEMOHR" course that the code never seeds. The generated API client was hand-edited (`getGroupRemovalImpact`), so the documented codegen command broke the build.
- **The last five things the previous owner worked on** were all autosave and course-plan polish (`git log --oneline -5`): autosave for course plans, notes and the journal; Word/PDF export of the course plan; and a fix for dialogs overflowing sideways. None of it touched the four commercial reasons a college would pay.
