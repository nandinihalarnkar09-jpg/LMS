# Closing the gaps (Task 5, product track)

We took **two** product-track gaps, because each one proves a different reason a college would pay for this. Each has a spec, a GitHub issue that describes the symptom, a linked PR, tests, and screenshots.

## 1. Exam robustness: auto-save, server-side timer, reconnect after a WiFi drop
- **Issue:** #6 "Students lose quiz answers when WiFi drops; no timed exams". The spec is in the issue body.
- **PR:** #9 (merged)
- **Commercial reason it serves:** #1, exam-grade reliability.
- **How it works:** server-owned deadline (start + limit, capped at the due date, 30 s network grace); questions hidden until Start; autosave on change, every 15 s, on reconnect and when the tab hides; a localStorage mirror for offline work; resume on any device; late saves refused; when time runs out, the server submits the last saved answers.
- **Code:** `artifacts/api-server/src/lib/examSession.ts`, `artifacts/api-server/src/routes/quizzes.ts`, `artifacts/dempo/src/components/exam-session.tsx`, `artifacts/dempo/src/pages/quiz-view.tsx`, `lib/db/src/schema/quizzes.ts`
- **Proof:** `artifacts/api-server/src/routes/examMode.test.ts` (12 tests), plus a 13-check browser test with the network cut and restored. Screenshots in [screenshots/exam](screenshots/exam).

## 2. Bulk roster import: 2,000 students from a CSV
- **Issue:** #10. **Spec:** [`docs/specs/roster-import.md`](../specs/roster-import.md). It covers columns, duplicates, malformed rows, partial vs all-or-nothing, and what the admin sees afterwards.
- **PR:** #11 (merged)
- **Commercial reasons it serves:** #4, ownership (the college's own roster, roll numbers and sections), and groundwork for #3 (marks keyed to roll numbers).
- **Proof:** `artifacts/api-server/src/routes/roster.test.ts` (11 tests, including a 2,000-row import); sample file [`docs/specs/sample-roster.csv`](../specs/sample-roster.csv); screenshots in [screenshots/roster](screenshots/roster).

## Also closed on the way
Accessibility, done as a first pass by hand in PR #13: contrast ratios recomputed (`scripts/check-contrast.py`), pinch-zoom restored, quiz options given radio semantics, one global focus outline, reduced motion respected. Keyboard-only navigation was checked on the quiz and roster flows. A full WCAG audit is still owed (see the memo).
