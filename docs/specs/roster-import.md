# Spec — Bulk roster import (CSV)

**Problem.** A college onboarding 2,000 students cannot type them in one at a time. Before this change the only bulk path was pasting a list of emails (`POST /admin/invites/bulk`, `artifacts/api-server/src/routes/invites.ts`): no names, no roll numbers, no per-student sections, and no report of which lines failed beyond a list of invalid strings. `ARCHITECTURE.md` §14 and `PLAN.md` gap #5 both list "bulk roster import" as *to build*.

**Commercial premise it serves:** *Ownership* (the college's own records — roll numbers, sections — live in the platform) and *a real academic gradebook* (marks need to be keyed to roll numbers to be exported to the university).

**Implementation:** `artifacts/api-server/src/lib/roster.ts` (parsing/validation), `artifacts/api-server/src/routes/roster.ts` (endpoint), `artifacts/dempo/src/components/roster-import.tsx` (UI on Admin → Invites). Tests: `artifacts/api-server/src/routes/roster.test.ts`. Sample file: [`sample-roster.csv`](sample-roster.csv).

---

## 1. File format

| Rule | Decision |
|---|---|
| Encoding | UTF-8; a leading BOM (added by Excel's "CSV UTF-8") is ignored |
| Header row | **Required.** Column order doesn't matter; names are case-insensitive; spaces/hyphens are treated as `_` |
| Delimiter / quoting | Comma, RFC 4180 quoting (`"Naik, Asha"`, `""` for a quote, newlines inside quotes allowed) |
| Blank lines | Skipped |
| Size | ≤ 5,000 data rows and ≤ 3 MB per file. Larger → whole-file error asking to split |

### Columns

| Column | Required | Accepted header names | Rules |
|---|---|---|---|
| `email` | **yes** | `email`, `e-mail`, `email_address` | Lower-cased. Must look like `x@y.zz`. This is the identity the student signs in with |
| `name` | no | `name`, `full_name`, `student_name` | Max 120 chars. Becomes the student's display name on first sign-in (roster name wins over the sign-in provider's) |
| `roll_no` | no | `roll_no`, `roll_number`, `rollno`, `roll`, `prn` | Max 40 chars. Must be unique within the file **and** not already belong to a different email |
| `role` | no | `role` | `student` (default when blank) or `teacher` (`faculty` accepted). Anything else → row error |
| `cohort` | no | `cohort`, `cohorts`, `section`, `batch` | One or more existing cohort names separated by `;`. Must match exactly one existing cohort (case-insensitive). Unknown or ambiguous → row error |

Why cohorts and not courses: the platform's model is *cohort (section) → teacher enrols the cohort into a course* (`POST /courses/:id/enroll-cohort`). Importing into cohorts reuses that, rather than inventing a second enrolment path.

## 2. Row outcomes

Each row gets exactly one status:

| Status | When | What happens on import |
|---|---|---|
| `create` | Email not invited and no account | New invitation (allow-list entry) with name, roll no, role, cohorts |
| `update` | Email already invited, not yet joined | Name / roll no / role replaced if given; cohorts **merged** (never removed) |
| `existing_user` | Email already has an account | Added to the listed cohorts; roll no filled in only if empty. **Role is never changed by an import** — role changes stay a deliberate admin action on the Users page |
| `error` | Any rule broken | Nothing written for this row; reason shown |

### Errors (exact messages the admin sees)

| Case | Message |
|---|---|
| Missing email | Email is missing. |
| Malformed email | "x" doesn't look like an email address. |
| Duplicate email in file | Same email as row N. Only the first row is imported. |
| Duplicate roll no in file | Roll number R is also used on row N. Roll numbers must be unique. |
| Roll no taken by another person | Roll number R already belongs to someone@college. |
| Unknown role | Role "x" isn't recognised. Use "student" or "teacher" (or leave it blank for student). |
| Unknown cohort | Cohort "x" doesn't exist. Create it on the Cohorts page first, or fix the spelling. |
| Ambiguous cohort | More than one cohort is called "x". Rename one so the name is unique. |
| Too many cells | This row has N columns but the header has M. Check for an unquoted comma (e.g. in a name) and wrap that value in double quotes. |

Whole-file errors (nothing previewed): empty file; no `email` column (message shows what headers were found); over 5,000 rows.

## 3. Flow — preview first, then partial import

1. Admin chooses a file → the server runs a **dry run** (`dryRun: true`) and returns every row with its status. **Nothing is written.**
2. The UI shows four counts (new / updated / existing accounts / need fixing) and the rows, problems first. Problem rows can be downloaded as `roster-rows-to-fix.csv` with the reason in a `problem` column.
3. Admin presses **Import N rows**. All non-error rows are applied **in one database transaction** — either all of them land or none do (e.g. if the DB drops mid-way).
4. Optionally, invitation emails are queued (4 at a time, after the response) when MSG91 is configured.

**Why partial, not all-or-nothing?** At 2,000 rows one typo should not block 1,999 students on the first day of term. The preview step means nothing is skipped silently, and the "rows to fix" download makes the second pass a 5-row file, not a 2,000-row one. The transaction makes the *valid* set atomic.

**Re-running the same file is safe**: creates become updates; nothing is duplicated (email is unique on the allow-list).

## 4. API

`POST /api/admin/roster/import` — admin only (403 otherwise). Body `{ csv: string, dryRun?: boolean = true, sendEmails?: boolean = false }`. Body limit 4 MB for this route only.

Response `200` (dry run) / `201` (import):
```json
{
  "dryRun": true,
  "summary": { "rows": 31, "create": 26, "update": 0, "existingUser": 0, "errors": 5 },
  "rows": [{ "line": 27, "email": "…", "name": "…", "rollNo": "…", "role": "student",
             "cohorts": ["…"], "status": "error", "message": "Same email as row 2. …" }],
  "emailsQueued": 0
}
```
`400` for whole-file errors, or when an import has no importable rows.

## 5. Security and audit
- Admin-only; every import writes an activity-log entry (`roster.imported`) with the counts.
- Values are length-capped; the problem-rows CSV neutralises spreadsheet formulas (a cell starting with `=`, `+`, `-`, `@` is prefixed with `'`).
- Roll numbers and names are personal data under DPDP: they are stored only on the allow-list and the user record, and are included in the student's own data export.

## 6. Performance
Verified by test: a 2,000-row file imports in one request (well under the 20 s test bound on a local Postgres; database work is ~6 queries plus batched inserts of 500).

## 7. Not in scope
- Creating cohorts or courses from the CSV (typos would silently create junk sections).
- Removing students who are missing from a new file (a sync, not an import — dangerous without an explicit "these will be removed" confirmation).
- SIS/ERP integration — future, on request (`ARCHITECTURE.md` §14).
