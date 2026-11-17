import express, { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  appInvitesTable,
  usersTable,
  cohortsTable,
  cohortMembersTable,
} from "@workspace/db";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { logActivity } from "../lib/activityLog";
import { sendInviteEmail } from "../lib/email";
import { parseRoster, type RosterRow } from "../lib/roster";

/**
 * Bulk roster import (spec: docs/specs/roster-import.md).
 *
 * POST /api/admin/roster/import  { csv, dryRun?: boolean, sendEmails?: boolean }
 *
 * Always preview first (dryRun: true) — nothing is written and every row comes
 * back with what would happen to it. Importing applies only the rows that
 * passed, in one transaction; rows with problems are listed so the admin can
 * fix them and re-upload just those.
 */
const router: IRouter = Router();

const bodySchema = z.object({
  csv: z.string().min(1, "The file is empty.").max(3_000_000, "The file is too large (limit 3 MB)."),
  dryRun: z.boolean().optional().default(true),
  sendEmails: z.boolean().optional().default(false),
});

type RowStatus = "create" | "update" | "existing_user" | "error";
type RowResult = {
  line: number;
  email: string | null;
  name: string | null;
  rollNo: string | null;
  role: string | null;
  cohorts: string[];
  status: RowStatus;
  message: string | null;
};

function inviteUrl(token: string): string {
  const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  return `${base}/sign-up?invite=${token}`;
}

/** Send invite emails a few at a time, after the response, so 2,000 emails don't fire at once. */
function sendInvitesInBackground(
  invites: { email: string; name: string | null; role: "student" | "teacher"; token: string }[],
  inviterName: string | null,
): void {
  const queue = [...invites];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      await sendInviteEmail({
        email: next.email,
        name: next.name,
        inviterName,
        role: next.role,
        inviteUrl: inviteUrl(next.token),
      }).catch(() => undefined);
    }
  };
  for (let i = 0; i < 4; i++) void worker();
}

router.post(
  "/admin/roster/import",
  // A 5,000-row roster is ~400 KB of CSV; the global JSON limit is 512 KB.
  express.json({ limit: "4mb" }),
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response) => {
    const parsedBody = bodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({ error: parsedBody.error.issues[0]?.message ?? "Invalid request" });
      return;
    }
    const { csv, dryRun, sendEmails } = parsedBody.data;
    const admin = req.localUser!;

    const roster = parseRoster(csv);
    if (roster.fatal) {
      res.status(400).json({ error: roster.fatal });
      return;
    }

    // ---- Resolve against the database (read-only) ----------------------
    const emails = roster.rows.map((r) => r.email);
    const rollNos = roster.rows.map((r) => r.rollNo).filter((r): r is string => !!r);
    const [cohorts, existingInvites, existingUsers, rollInvites, rollUsers] = await Promise.all([
      db.select({ id: cohortsTable.id, name: cohortsTable.name }).from(cohortsTable),
      emails.length ? db.select().from(appInvitesTable).where(inArray(appInvitesTable.email, emails)) : [],
      emails.length
        ? db.select({ id: usersTable.id, email: usersTable.email, role: usersTable.role, rollNo: usersTable.rollNo }).from(usersTable).where(inArray(usersTable.email, emails))
        : [],
      rollNos.length ? db.select({ email: appInvitesTable.email, rollNo: appInvitesTable.rollNo }).from(appInvitesTable).where(inArray(appInvitesTable.rollNo, rollNos)) : [],
      rollNos.length ? db.select({ email: usersTable.email, rollNo: usersTable.rollNo }).from(usersTable).where(inArray(usersTable.rollNo, rollNos)) : [],
    ]);

    const cohortsByName = new Map<string, number[]>();
    for (const c of cohorts) {
      const key = c.name.trim().toLowerCase();
      cohortsByName.set(key, [...(cohortsByName.get(key) ?? []), c.id]);
    }
    const inviteByEmail = new Map(existingInvites.map((i) => [i.email, i]));
    const userByEmail = new Map(existingUsers.map((u) => [u.email.toLowerCase(), u]));
    const rollOwner = new Map<string, string>();
    for (const r of [...rollInvites, ...rollUsers]) if (r.rollNo) rollOwner.set(r.rollNo.toLowerCase(), r.email.toLowerCase());

    const results: RowResult[] = roster.problems.map((p) => ({
      line: p.line,
      email: p.email,
      name: null,
      rollNo: null,
      role: null,
      cohorts: [],
      status: "error",
      message: p.message,
    }));
    const plan: { row: RosterRow; status: Exclude<RowStatus, "error">; cohortIds: number[] }[] = [];

    for (const row of roster.rows) {
      const base = { line: row.line, email: row.email, name: row.name, rollNo: row.rollNo, role: row.role, cohorts: row.cohortNames };
      const cohortIds: number[] = [];
      let problem: string | null = null;
      for (const cname of row.cohortNames) {
        const ids = cohortsByName.get(cname.toLowerCase());
        if (!ids) {
          problem = `Cohort "${cname}" doesn't exist. Create it on the Cohorts page first, or fix the spelling.`;
          break;
        }
        if (ids.length > 1) {
          problem = `More than one cohort is called "${cname}". Rename one so the name is unique.`;
          break;
        }
        cohortIds.push(ids[0]);
      }
      if (!problem && row.rollNo) {
        const owner = rollOwner.get(row.rollNo.toLowerCase());
        if (owner && owner !== row.email) problem = `Roll number ${row.rollNo} already belongs to ${owner}.`;
      }
      if (problem) {
        results.push({ ...base, status: "error", message: problem });
        continue;
      }
      const user = userByEmail.get(row.email);
      if (user) {
        const note = user.role !== row.role && user.role !== "unassigned"
          ? `Already has an account (${user.role}). Role is not changed by imports; ${cohortIds.length ? "will be added to the cohorts." : "nothing else to do."}`
          : `Already has an account. ${cohortIds.length ? "Will be added to the cohorts." : "Nothing to change."}`;
        results.push({ ...base, status: "existing_user", message: note });
        plan.push({ row, status: "existing_user", cohortIds });
      } else if (inviteByEmail.has(row.email)) {
        results.push({ ...base, status: "update", message: "Already invited — name, roll number, role and cohorts will be updated." });
        plan.push({ row, status: "update", cohortIds });
      } else {
        results.push({ ...base, status: "create", message: null });
        plan.push({ row, status: "create", cohortIds });
      }
    }
    results.sort((a, b) => a.line - b.line);

    const summary = {
      rows: results.length,
      create: plan.filter((p) => p.status === "create").length,
      update: plan.filter((p) => p.status === "update").length,
      existingUser: plan.filter((p) => p.status === "existing_user").length,
      errors: results.filter((r) => r.status === "error").length,
    };

    if (dryRun) {
      res.json({ dryRun: true, summary, rows: results });
      return;
    }
    if (plan.length === 0) {
      res.status(400).json({ error: "No rows can be imported. Fix the problems listed in the preview and try again.", summary, rows: results });
      return;
    }

    // ---- Apply, all valid rows in one transaction -------------------------
    const created: { email: string; name: string | null; role: "student" | "teacher"; token: string }[] = [];
    await db.transaction(async (tx) => {
      const toCreate = plan.filter((p) => p.status === "create");
      for (let i = 0; i < toCreate.length; i += 500) {
        const batch = toCreate.slice(i, i + 500).map((p) => ({
          email: p.row.email,
          name: p.row.name,
          rollNo: p.row.rollNo,
          role: p.row.role,
          cohortIds: p.cohortIds,
          token: randomUUID(),
          invitedBy: admin.id,
          invitedByEmail: admin.email,
        }));
        const inserted = await tx.insert(appInvitesTable).values(batch).returning();
        for (const inv of inserted) created.push({ email: inv.email, name: inv.name, role: inv.role === "teacher" ? "teacher" : "student", token: inv.token });
      }
      for (const p of plan.filter((x) => x.status === "update")) {
        const existing = inviteByEmail.get(p.row.email)!;
        const merged = [...new Set([...(existing.cohortIds ?? []), ...p.cohortIds])];
        await tx
          .update(appInvitesTable)
          .set({
            name: p.row.name ?? existing.name,
            rollNo: p.row.rollNo ?? existing.rollNo,
            role: p.row.role,
            cohortIds: merged,
          })
          .where(eq(appInvitesTable.id, existing.id));
      }
      for (const p of plan.filter((x) => x.status === "existing_user")) {
        const user = userByEmail.get(p.row.email)!;
        if (p.cohortIds.length) {
          await tx
            .insert(cohortMembersTable)
            .values(p.cohortIds.map((cohortId) => ({ cohortId, studentId: user.id })))
            .onConflictDoNothing();
        }
        if (p.row.rollNo && !user.rollNo) {
          await tx.update(usersTable).set({ rollNo: p.row.rollNo }).where(eq(usersTable.id, user.id));
        }
      }
    });

    if (sendEmails && created.length) sendInvitesInBackground(created, admin.name);

    void logActivity({
      user: admin,
      action: "roster.imported",
      message: `Roster import: ${summary.create} invited, ${summary.update} updated, ${summary.existingUser} existing accounts, ${summary.errors} rows skipped`,
      metadata: { ...summary, emailsQueued: sendEmails ? created.length : 0 },
    });

    res.status(201).json({ dryRun: false, summary, rows: results, emailsQueued: sendEmails ? created.length : 0 });
  },
);

export default router;
