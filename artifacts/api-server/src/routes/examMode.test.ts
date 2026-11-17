import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { inArray, eq, and } from "drizzle-orm";
import {
  db,
  usersTable,
  coursesTable,
  enrollmentsTable,
  quizzesTable,
  quizQuestionsTable,
  quizAttemptsTable,
  quizAttemptSessionsTable,
} from "@workspace/db";
import { computeDeadline, isPastDeadline, cleanDraftAnswers, DEADLINE_GRACE_MS } from "../lib/examSession";

const mockGetAuth = vi.fn();
vi.mock("@clerk/express", () => ({
  getAuth: (...args: unknown[]) => mockGetAuth(...args),
  clerkClient: { users: { getUser: vi.fn() } },
}));
vi.mock("../lib/grading", () => ({
  gradeShortAnswer: vi.fn(async () => ({ aiScore: null, aiFeedback: null })),
  gradeTextSubmission: vi.fn(),
  computePlagiarismScore: vi.fn(),
}));

const { default: quizzesRouter } = await import("./quizzes");

const P = "exammode";
const TEACHER = `${P}_teacher`;
const ASHA = `${P}_asha`;
const RAVI = `${P}_ravi`;
const MEERA = `${P}_meera`;
const ALL = [TEACHER, ASHA, RAVI, MEERA];
let courseId: number;

const app: Express = express();
app.use(express.json());
app.use((req, _res, next) => {
  // @ts-expect-error minimal logger stub for tests
  req.log = { warn: () => {}, info: () => {}, error: () => {} };
  next();
});
app.use("/api", quizzesRouter);
const asUser = (id: string) => mockGetAuth.mockReturnValue({ userId: id });

async function cleanup() {
  const courses = await db.select().from(coursesTable).where(eq(coursesTable.teacherId, TEACHER));
  const ids = courses.map((c) => c.id);
  if (ids.length) {
    const quizzes = await db.select().from(quizzesTable).where(inArray(quizzesTable.courseId, ids));
    const qIds = quizzes.map((q) => q.id);
    if (qIds.length) {
      await db.delete(quizAttemptsTable).where(inArray(quizAttemptsTable.quizId, qIds));
      await db.delete(quizAttemptSessionsTable).where(inArray(quizAttemptSessionsTable.quizId, qIds));
      await db.delete(quizQuestionsTable).where(inArray(quizQuestionsTable.quizId, qIds));
    }
    await db.delete(quizzesTable).where(inArray(quizzesTable.courseId, ids));
    await db.delete(enrollmentsTable).where(inArray(enrollmentsTable.courseId, ids));
    await db.delete(coursesTable).where(inArray(coursesTable.id, ids));
  }
  await db.delete(usersTable).where(inArray(usersTable.id, ALL));
}

beforeAll(async () => {
  await cleanup();
  await db.insert(usersTable).values([
    { id: TEACHER, email: `${TEACHER}@example.com`, role: "teacher", name: "Teacher" },
    { id: ASHA, email: `${ASHA}@example.com`, role: "student", name: "Asha" },
    { id: RAVI, email: `${RAVI}@example.com`, role: "student", name: "Ravi" },
    { id: MEERA, email: `${MEERA}@example.com`, role: "student", name: "Meera" },
  ]);
  const [course] = await db
    .insert(coursesTable)
    .values({ title: "Exam Mode Course", teacherId: TEACHER, inviteCode: "EXAM01" })
    .returning();
  courseId = course!.id;
  await db.insert(enrollmentsTable).values([ASHA, RAVI, MEERA].map((studentId) => ({ courseId, studentId })));
});
afterAll(cleanup);
beforeEach(() => mockGetAuth.mockReset());

async function makeQuiz(opts: { timeLimitMinutes?: number | null; dueDate?: string } = {}) {
  asUser(TEACHER);
  const created = await request(app)
    .post(`/api/courses/${courseId}/quizzes`)
    .send({
      title: "Midterm",
      ...(opts.dueDate ? { dueDate: opts.dueDate } : {}),
      timeLimitMinutes: opts.timeLimitMinutes ?? null,
      questions: [
        { type: "multiple_choice", prompt: "2+2?", options: ["3", "4"], correctOption: 1, points: 2 },
        { type: "short_answer", prompt: "Explain the median.", points: 3 },
      ],
    });
  expect(created.status).toBe(201);
  await request(app).post(`/api/quizzes/${created.body.id}/publish`).send();
  return created.body as { id: number; questions: { id: number }[] };
}

/** Move a student's clock into the past, as if they started long ago. */
async function rewindClock(quizId: number, studentId: string, deadlineMsAgo: number) {
  await db
    .update(quizAttemptSessionsTable)
    .set({ deadlineAt: new Date(Date.now() - deadlineMsAgo) })
    .where(and(eq(quizAttemptSessionsTable.quizId, quizId), eq(quizAttemptSessionsTable.studentId, studentId)));
}

describe("exam mode helpers", () => {
  it("deadline is start + limit, capped at the due date, null when untimed", () => {
    const start = new Date("2026-11-18T10:00:00Z");
    expect(computeDeadline(start, 30, null)?.toISOString()).toBe("2026-11-18T10:30:00.000Z");
    expect(computeDeadline(start, 30, new Date("2026-11-18T10:10:00Z"))?.toISOString()).toBe("2026-11-18T10:10:00.000Z");
    expect(computeDeadline(start, null, null)).toBeNull();
  });

  it("allows a short network grace after the deadline", () => {
    const deadline = new Date(Date.now() - DEADLINE_GRACE_MS / 2);
    expect(isPastDeadline(deadline)).toBe(false);
    expect(isPastDeadline(new Date(Date.now() - DEADLINE_GRACE_MS - 1000))).toBe(true);
    expect(isPastDeadline(null)).toBe(false);
  });

  it("drops answers to other quizzes' questions and keeps one per question", () => {
    const out = cleanDraftAnswers(
      [
        { questionId: 1, selectedOption: 0 },
        { questionId: 1, selectedOption: 2 },
        { questionId: 99, textAnswer: "x" },
        { questionId: 2, textAnswer: "a".repeat(30) },
      ],
      new Set([1, 2]),
      10,
    );
    expect(out).toEqual([{ questionId: 1, selectedOption: 2 }, { questionId: 2, textAnswer: "a".repeat(10) }]);
  });
});

describe("timed quiz (exam mode)", () => {
  it("hides questions until the student starts, then starts a server clock", async () => {
    const quiz = await makeQuiz({ timeLimitMinutes: 20 });
    asUser(ASHA);
    const before = await request(app).get(`/api/quizzes/${quiz.id}`);
    expect(before.status).toBe(200);
    expect(before.body.timeLimitMinutes).toBe(20);
    expect(before.body.questions).toEqual([]);
    expect(before.body.mySession).toBeNull();

    const started = await request(app).post(`/api/quizzes/${quiz.id}/session`).send();
    expect(started.status).toBe(200);
    expect(started.body.questions).toHaveLength(2);
    expect(started.body.questions[0].correctOption).toBeNull();
    const ms = new Date(started.body.deadlineAt).getTime() - new Date(started.body.startedAt).getTime();
    expect(ms).toBe(20 * 60_000);
  });

  it("refuses a direct submit that never started the clock", async () => {
    const quiz = await makeQuiz({ timeLimitMinutes: 15 });
    asUser(RAVI);
    const res = await request(app)
      .post(`/api/quizzes/${quiz.id}/attempts`)
      .send({ answers: [{ questionId: quiz.questions[0].id, selectedOption: 1 }] });
    expect(res.status).toBe(400);
  });

  it("survives a reload: resuming returns the same clock and the saved answers", async () => {
    const quiz = await makeQuiz({ timeLimitMinutes: 30 });
    asUser(ASHA);
    const first = await request(app).post(`/api/quizzes/${quiz.id}/session`).send();
    const q1 = quiz.questions[0].id;
    const q2 = quiz.questions[1].id;
    const saved = await request(app)
      .put(`/api/quizzes/${quiz.id}/session`)
      .send({ answers: [{ questionId: q1, selectedOption: 1 }, { questionId: q2, textAnswer: "The middle value" }] });
    expect(saved.status).toBe(200);
    expect(saved.body.saveCount).toBe(1);

    // "WiFi drops, student reopens the page"
    const resumed = await request(app).post(`/api/quizzes/${quiz.id}/session`).send();
    expect(resumed.body.startedAt).toBe(first.body.startedAt);
    expect(resumed.body.deadlineAt).toBe(first.body.deadlineAt);
    expect(resumed.body.answers).toEqual([
      { questionId: q1, selectedOption: 1 },
      { questionId: q2, textAnswer: "The middle value" },
    ]);
    const view = await request(app).get(`/api/quizzes/${quiz.id}`);
    expect(view.body.mySession.deadlineAt).toBe(first.body.deadlineAt);
  });

  it("after the deadline, autosave is refused and the saved answers are submitted", async () => {
    const quiz = await makeQuiz({ timeLimitMinutes: 10 });
    const q1 = quiz.questions[0].id;
    asUser(MEERA);
    await request(app).post(`/api/quizzes/${quiz.id}/session`).send();
    await request(app).put(`/api/quizzes/${quiz.id}/session`).send({ answers: [{ questionId: q1, selectedOption: 1 }] });
    await rewindClock(quiz.id, MEERA, DEADLINE_GRACE_MS + 5_000);

    const late = await request(app).put(`/api/quizzes/${quiz.id}/session`).send({ answers: [{ questionId: q1, selectedOption: 0 }] });
    expect(late.status).toBe(409);
    expect(late.body.error).toMatch(/Time is up/);

    const [attempt] = await db
      .select()
      .from(quizAttemptsTable)
      .where(and(eq(quizAttemptsTable.quizId, quiz.id), eq(quizAttemptsTable.studentId, MEERA)));
    expect(attempt.autoSubmitted).toBe(true);
    // The answer saved before time ran out stands (option 1 = correct), not the late one.
    expect(attempt.answers.find((a) => a.questionId === q1)?.selectedOption).toBe(1);
    expect(attempt.answers.find((a) => a.questionId === q1)?.autoScore).toBe(2);
  });

  it("a late submit uses the answers saved in time", async () => {
    const quiz = await makeQuiz({ timeLimitMinutes: 10 });
    const q1 = quiz.questions[0].id;
    asUser(RAVI);
    await request(app).post(`/api/quizzes/${quiz.id}/session`).send();
    await request(app).put(`/api/quizzes/${quiz.id}/session`).send({ answers: [{ questionId: q1, selectedOption: 0 }] });
    await rewindClock(quiz.id, RAVI, DEADLINE_GRACE_MS + 60_000);
    const res = await request(app)
      .post(`/api/quizzes/${quiz.id}/attempts`)
      .send({ answers: [{ questionId: q1, selectedOption: 1 }] });
    expect(res.status).toBe(201);
    expect(res.body.autoSubmitted).toBe(true);
    expect(res.body.answers.find((a: { questionId: number }) => a.questionId === q1).selectedOption).toBe(0);
  });

  it("a student who never comes back still appears in the teacher's results", async () => {
    const quiz = await makeQuiz({ timeLimitMinutes: 10 });
    asUser(ASHA);
    await request(app).post(`/api/quizzes/${quiz.id}/session`).send();
    await request(app)
      .put(`/api/quizzes/${quiz.id}/session`)
      .send({ answers: [{ questionId: quiz.questions[1].id, textAnswer: "half way" }] });
    await rewindClock(quiz.id, ASHA, DEADLINE_GRACE_MS + 1_000);

    asUser(TEACHER);
    const attempts = await request(app).get(`/api/quizzes/${quiz.id}/attempts`);
    expect(attempts.status).toBe(200);
    expect(attempts.body).toHaveLength(1);
    expect(attempts.body[0].studentId).toBe(ASHA);
    expect(attempts.body[0].autoSubmitted).toBe(true);
  });

  it("locks question edits while a student is mid-attempt", async () => {
    const quiz = await makeQuiz({ timeLimitMinutes: 10 });
    asUser(RAVI);
    await request(app).post(`/api/quizzes/${quiz.id}/session`).send();
    asUser(TEACHER);
    const res = await request(app)
      .put(`/api/quizzes/${quiz.id}`)
      .send({ title: "Edited", questions: [{ type: "short_answer", prompt: "New?", points: 1 }] });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/while students are taking/);
  });

  it("caps the clock at the due date", async () => {
    const due = new Date(Date.now() + 5 * 60_000).toISOString();
    const quiz = await makeQuiz({ timeLimitMinutes: 60, dueDate: due });
    asUser(MEERA);
    const s = await request(app).post(`/api/quizzes/${quiz.id}/session`).send();
    expect(new Date(s.body.deadlineAt).toISOString()).toBe(due);
  });
});

describe("untimed quiz keeps working, now with autosave", () => {
  it("restores saved answers and submits normally", async () => {
    const quiz = await makeQuiz({ timeLimitMinutes: null });
    const q1 = quiz.questions[0].id;
    asUser(ASHA);
    const view = await request(app).get(`/api/quizzes/${quiz.id}`);
    expect(view.body.questions).toHaveLength(2); // untimed: visible as before
    const s = await request(app).post(`/api/quizzes/${quiz.id}/session`).send();
    expect(s.body.deadlineAt).toBeNull();
    await request(app).put(`/api/quizzes/${quiz.id}/session`).send({ answers: [{ questionId: q1, selectedOption: 1 }] });
    const submit = await request(app).post(`/api/quizzes/${quiz.id}/attempts`).send({ answers: [{ questionId: q1, selectedOption: 1 }] });
    expect(submit.status).toBe(201);
    expect(submit.body.autoSubmitted).toBe(false);
    const again = await request(app).post(`/api/quizzes/${quiz.id}/session`).send();
    expect(again.status).toBe(409);
  });
});
