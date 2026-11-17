import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { inArray, like, eq } from "drizzle-orm";
import { db, usersTable, appInvitesTable, cohortsTable, cohortMembersTable, activityLogsTable } from "@workspace/db";
import { parseCsv, parseRoster, csvCell, MAX_ROWS } from "../lib/roster";

const mockGetAuth = vi.fn();
vi.mock("@clerk/express", () => ({
  getAuth: (...args: unknown[]) => mockGetAuth(...args),
  clerkClient: { users: { getUser: vi.fn() } },
}));
const sent: string[] = [];
vi.mock("../lib/email", () => ({
  sendInviteEmail: vi.fn(async (o: { email: string }) => {
    sent.push(o.email);
    return true;
  }),
}));

const { default: rosterRouter } = await import("./roster");

const P = "rostertest";
const ADMIN = `${P}_admin`;
const TEACHER = `${P}_teacher`;
const EXISTING = `${P}_existing`;
const DOMAIN = "roster.test.example";
let cohortA: number;

const app: Express = express();
app.use((req, _res, next) => {
  // @ts-expect-error minimal logger stub for tests
  req.log = { warn: () => {}, info: () => {}, error: () => {} };
  next();
});
app.use("/api", rosterRouter);
const asUser = (id: string) => mockGetAuth.mockReturnValue({ userId: id });

async function cleanup() {
  const cohorts = await db.select().from(cohortsTable).where(eq(cohortsTable.teacherId, TEACHER));
  if (cohorts.length) {
    await db.delete(cohortMembersTable).where(inArray(cohortMembersTable.cohortId, cohorts.map((c) => c.id)));
    await db.delete(cohortsTable).where(inArray(cohortsTable.id, cohorts.map((c) => c.id)));
  }
  await db.delete(appInvitesTable).where(like(appInvitesTable.email, `%@${DOMAIN}`));
  await db.delete(activityLogsTable).where(eq(activityLogsTable.userId, ADMIN));
  await db.delete(usersTable).where(inArray(usersTable.id, [ADMIN, TEACHER, EXISTING]));
}

beforeAll(async () => {
  await cleanup();
  await db.insert(usersTable).values([
    { id: ADMIN, email: `admin@${DOMAIN}`, role: "teacher", isAdmin: true, name: "Admin" },
    { id: TEACHER, email: `teacher@${DOMAIN}`, role: "teacher", name: "Teacher" },
    { id: EXISTING, email: `existing@${DOMAIN}`, role: "student", name: "Existing Student" },
  ]);
  const [a] = await db.insert(cohortsTable).values({ teacherId: TEACHER, name: "BBA Sem 1 - A" }).returning();
  await db.insert(cohortsTable).values({ teacherId: TEACHER, name: "BBA Sem 1 - B" });
  cohortA = a.id;
});
afterAll(cleanup);

describe("CSV parsing", () => {
  it("handles quotes, embedded commas/newlines, CRLF and an Excel BOM", () => {
    const rows = parseCsv('﻿email,name\r\na@x.in,"Naik, Asha"\r\nb@x.in,"Line\nbreak ""quoted"""\r\n');
    expect(rows.map((r) => r.cells)).toEqual([
      ["email", "name"],
      ["a@x.in", "Naik, Asha"],
      ["b@x.in", 'Line\nbreak "quoted"'],
    ]);
    expect(rows[2].line).toBe(3);
  });

  it("accepts common header spellings in any order", () => {
    const r = parseRoster("Roll Number,Student Name,E-mail,Section\n21BBA001,Asha,ASHA@X.IN,BBA A\n");
    expect(r.fatal).toBeNull();
    expect(r.rows[0]).toMatchObject({ email: "asha@x.in", name: "Asha", rollNo: "21BBA001", role: "student", cohortNames: ["BBA A"] });
  });

  it("explains a missing email column", () => {
    expect(parseRoster("name,roll\nAsha,1\n").fatal).toMatch(/No "email" column/);
  });

  it("flags bad rows without stopping good ones, with spreadsheet line numbers", () => {
    const r = parseRoster(
      [
        "email,name,roll_no,role",
        "good1@x.in,Good One,R1,student",
        "not-an-email,Bad,R2,",
        ",Missing,R3,",
        "good1@x.in,Dup,R4,",
        "good2@x.in,Roll Clash,R1,",
        "good3@x.in,Odd Role,R5,principal",
        "good4@x.in,Too,Many,Columns,Here",
        "",
        "good5@x.in,Faculty,R6,faculty",
      ].join("\n"),
    );
    expect(r.rows.map((x) => x.email)).toEqual(["good1@x.in", "good5@x.in"]);
    expect(r.rows[1].role).toBe("teacher");
    expect(r.problems.map((p) => p.line)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(r.problems[2].message).toMatch(/row 2/);
    expect(r.problems[3].message).toMatch(/R1/);
    expect(r.problems[5].message).toMatch(/unquoted comma/);
  });

  it("refuses files over the row limit", () => {
    const big = ["email", ...Array.from({ length: MAX_ROWS + 1 }, (_, i) => `s${i}@x.in`)].join("\n");
    expect(parseRoster(big).fatal).toMatch(/limit/);
  });

  it("neutralises spreadsheet formulas when exporting", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
  });
});

describe("POST /api/admin/roster/import", () => {
  const csv = [
    "email,name,roll_no,role,cohort",
    `asha@${DOMAIN},Asha Naik,21BBA001,student,BBA Sem 1 - A`,
    `ravi@${DOMAIN},Ravi Kamat,21BBA002,,BBA Sem 1 - A; BBA Sem 1 - B`,
    `existing@${DOMAIN},Existing Student,21BBA003,student,BBA Sem 1 - A`,
    `ghost@${DOMAIN},Ghost,21BBA004,student,No Such Cohort`,
    `bad-email,Bad,21BBA005,,`,
  ].join("\n");

  it("is admin-only", async () => {
    asUser(TEACHER);
    const res = await request(app).post("/api/admin/roster/import").send({ csv, dryRun: true });
    expect(res.status).toBe(403);
  });

  it("previews without writing anything", async () => {
    asUser(ADMIN);
    const res = await request(app).post("/api/admin/roster/import").send({ csv, dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({ rows: 5, create: 2, update: 0, existingUser: 1, errors: 2 });
    const byEmail = Object.fromEntries(res.body.rows.map((r: { email: string }) => [r.email, r]));
    expect(byEmail[`ghost@${DOMAIN}`].message).toMatch(/doesn't exist/);
    const invites = await db.select().from(appInvitesTable).where(like(appInvitesTable.email, `%@${DOMAIN}`));
    expect(invites).toHaveLength(0);
  });

  it("imports valid rows, skips the rest, and is safe to re-run", async () => {
    asUser(ADMIN);
    const res = await request(app).post("/api/admin/roster/import").send({ csv, dryRun: false, sendEmails: true });
    expect(res.status).toBe(201);
    expect(res.body.summary.create).toBe(2);
    expect(res.body.emailsQueued).toBe(2);

    const invites = await db.select().from(appInvitesTable).where(like(appInvitesTable.email, `%@${DOMAIN}`));
    const ravi = invites.find((i) => i.email === `ravi@${DOMAIN}`)!;
    expect(ravi.rollNo).toBe("21BBA002");
    expect(ravi.cohortIds).toHaveLength(2);
    expect(invites.some((i) => i.email === `ghost@${DOMAIN}`)).toBe(false);

    const members = await db.select().from(cohortMembersTable).where(eq(cohortMembersTable.studentId, EXISTING));
    expect(members.map((m) => m.cohortId)).toEqual([cohortA]);
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, EXISTING));
    expect(existing.rollNo).toBe("21BBA003");

    // Same file again: nothing duplicated, invites become updates.
    const again = await request(app).post("/api/admin/roster/import").send({ csv, dryRun: true });
    expect(again.body.summary).toMatchObject({ create: 0, update: 2, existingUser: 1 });
  });

  it("rejects a roll number that already belongs to someone else", async () => {
    asUser(ADMIN);
    const res = await request(app)
      .post("/api/admin/roster/import")
      .send({ csv: `email,roll_no\nnewperson@${DOMAIN},21BBA001\n`, dryRun: true });
    expect(res.body.rows[0].status).toBe("error");
    expect(res.body.rows[0].message).toMatch(/already belongs to asha@/);
  });

  it("handles a 2,000-student roster in one request", async () => {
    asUser(ADMIN);
    const lines = ["email,name,roll_no,cohort"];
    for (let i = 0; i < 2000; i++) lines.push(`bulk${i}@${DOMAIN},Student ${i},B${String(i).padStart(5, "0")},BBA Sem 1 - B`);
    const t0 = Date.now();
    const res = await request(app).post("/api/admin/roster/import").send({ csv: lines.join("\n"), dryRun: false });
    expect(res.status).toBe(201);
    expect(res.body.summary.create).toBe(2000);
    expect(Date.now() - t0).toBeLessThan(20_000);
  });
});
