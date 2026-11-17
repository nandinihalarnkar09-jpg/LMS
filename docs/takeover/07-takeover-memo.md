# Takeover memo

**To:** The founder  **From:** The new product team  **Re:** Can we sell LMS to a 2,000-student college, and what happens in the next 90 days?

## The short answer
**Not yet, but it is closer than the documents suggest, and the remaining gap is mostly not code.** The product is broad, tested (203 API tests on Postgres, green CI on Node 22 and 24) and now runs anywhere in four commands. What blocks a signed contract is proof (a pilot, a penetration test), paperwork (DPDP, the contracts we hold with our vendors) and one missing academic feature (the Indian gradebook). More features won't fix any of that. We recommend **one free pilot with one department this semester**, and a sales conversation only after the pilot results are in.

## What we found
- **The code is ahead of its documents, and the documents promise things the code doesn't have.** The docs promise Sentry, redacting student names before AI calls, WhatsApp/SMS and "verified TLS"; none of these exist. Meanwhile bulk invites, the weighted gradebook and a DPDP export exist even though the plan lists them as "to build". 22 contradictions are logged in `02-contradictions.md`. We do not know which database and storage region is live. That single fact decides whether the "your data stays in India" pitch is true.
- **It could not be run or reviewed without vendor accounts, and the install was broken on Macs.** It is now fixed, with demo data (PR #5). Twelve failures and their root causes are logged in `03-failure-log.md`.
- **Against Google Classroom** (`04-gap-audit.md`): we are better at roles/permissions and at records. We are partial on grading, communication, assignments and integrity. Classroom still wins on the assignment lifecycle (returning work, resubmission, late flags) and on zero setup.

## What we already moved forward (all merged, each with an issue and a PR)
1. **Exam mode** (#6 → PR #9). The server runs the timer, answers autosave, a student resumes after a WiFi drop, and their saved answers are submitted when time runs out. This proves commercial reason #1.
2. **Roster import** (#10 → PR #11). 2,000 students from a CSV, with roll numbers and sections, a preview first, and a downloadable file of the rows that need fixing.
3. **Rebrand and accessibility** (#12 → PR #13). The college's own crest colours, contrast that meets AA, pinch-zoom restored, error messages people can act on, and no more promises the product doesn't keep.
4. **It runs on any developer's machine** (#1–#4 → PR #5). README, demo accounts, cross-platform setup, CI that catches lockfile drift.

## The next 90 days
**Days 1–30: make the claims true.**
- Confirm the live database and storage regions, and move them to Mumbai if they aren't there. Until then, nobody says "India-resident" in a sales meeting.
- Wire up error tracking and uptime monitoring on *our own* deployment, then break something on purpose to prove the alerts fire.
- Commission the external penetration test now, because it has the longest lead time.
- Start the DPDP work with a lawyer: privacy policy, consent, retention period, breach process, and contracts with each vendor (Clerk, hosting, MSG91).

**Days 31–60: close the gap the college will feel in week one.**
- **The Indian academic gradebook:** internal/external split, semester aggregation, SGPA/CGPA, and an export in the university's format. This is commercial reason #3, and it is our biggest real product gap.
- **The assignment lifecycle:** return work to the student, allow resubmission, flag late submissions. Without these, faculty will compare us with Classroom and find us worse.
- A load test of one exam spike (300–600 concurrent students) against the Mumbai region.

**Days 61–90: pilot.**
- One department, one semester, free. A named support contact, a response-time promise, and someone on call during the exam window. Measure lost submissions (target: zero), support tickets, and how many faculty stay with us.

## What we will refuse to do, and why
1. **No AI grading in the pilot.** It ships off, and it stays off. The code sends a student's text to the AI provider without any name redaction (`lib/grading.ts`), and a mark suggested by a model is the first thing a parent will appeal. It doesn't trace to any of the four reasons a college buys from us. We'll revisit it after the DPDP sign-off, with redaction built.
2. **No proctoring, webcams or lockdown browser.** They are expensive, invasive, and a DPDP liability. And they are not what costs students marks: dropped WiFi is, and we have fixed that.
3. **No multi-college SaaS, and no second customer, before this pilot succeeds.** `ARCHITECTURE.md` scopes the product as single-tenant, and that's right. Re-architecting for tenants we don't have would burn the 90 days.
4. **No WhatsApp/SMS in the pilot.** Each needs separate approval (DLT registration for SMS, template approval for WhatsApp) before a single message can go out. Email plus in-app notifications are enough to prove the product.
5. **No more features on the course planner, journal or "My Plan".** That's where the last five commits went. None of it is a reason a college pays, and Classroom isn't losing on them.
6. **No public leaderboard by default.** Ranking students publicly is the college's policy call, not a default we ship. It becomes off-by-default and teacher opt-in.
7. **No sales claim we can't point to in the code.** Every pitch line must cite a file or a test, the same standard as this memo.

## What we need from you
A decision on the hosting and data region, budget for the penetration test and legal work (about ₹1.2–3 lakh one-time, per `ARCHITECTURE.md` §12), and one introduction to a Head of Department who will run the pilot.
