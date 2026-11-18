import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { inArray, eq } from "drizzle-orm";
import {
  db,
  usersTable,
  coursesTable,
  enrollmentsTable,
  assignmentsTable,
  submissionsTable,
  submissionSimilaritiesTable,
} from "@workspace/db";

const mockGetAuth = vi.fn();
const mockGetUser = vi.fn();

vi.mock("@clerk/express", () => ({
  getAuth: (...args: unknown[]) => mockGetAuth(...args),
  clerkClient: {
    users: {
      getUser: (...args: unknown[]) => mockGetUser(...args),
    },
  },
}));

// Stub AI grading so tests never call the model.
vi.mock("../lib/grading", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/grading")>();
  return {
    ...actual,
    gradeTextSubmission: vi
      .fn()
      .mockResolvedValue({ aiScore: null, aiFeedback: null }),
  };
});

const { default: submissionsRouter } = await import("./submissions");
const { gradeTextSubmission } = await import("../lib/grading");

const TEST_PREFIX = "task40test";
const TEACHER_ID = `${TEST_PREFIX}_teacher`;
const ALICE = `${TEST_PREFIX}_alice`;
const BOB = `${TEST_PREFIX}_bob`;
const CARA = `${TEST_PREFIX}_cara`;
const ALL_IDS = [TEACHER_ID, ALICE, BOB, CARA];

let courseId: number;
let assignmentId: number;

const ESSAY =
  "The industrial revolution transformed European society by moving production from homes into factories and reshaping cities around new sources of energy and labor.";
const DIFFERENT =
  "Photosynthesis converts light energy into chemical energy inside chloroplasts, producing glucose and oxygen from carbon dioxide and water molecules.";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // @ts-expect-error minimal logger stub for tests
    req.log = { warn: () => {}, info: () => {}, error: () => {} };
    next();
  });
  app.use("/api", submissionsRouter);
  return app;
}

const app = buildApp();

function asUser(userId: string) {
  mockGetAuth.mockReturnValue({ userId });
}

async function cleanup(): Promise<void> {
  const courses = await db
    .select()
    .from(coursesTable)
    .where(eq(coursesTable.teacherId, TEACHER_ID));
  const ids = courses.map((c) => c.id);
  if (ids.length) {
    const assignments = await db
      .select()
      .from(assignmentsTable)
      .where(inArray(assignmentsTable.courseId, ids));
    const aIds = assignments.map((a) => a.id);
    if (aIds.length) {
      await db
        .delete(submissionSimilaritiesTable)
        .where(inArray(submissionSimilaritiesTable.assignmentId, aIds));
      await db
        .delete(submissionsTable)
        .where(inArray(submissionsTable.assignmentId, aIds));
    }
    await db
      .delete(assignmentsTable)
      .where(inArray(assignmentsTable.courseId, ids));
    await db
      .delete(enrollmentsTable)
      .where(inArray(enrollmentsTable.courseId, ids));
    await db.delete(coursesTable).where(inArray(coursesTable.id, ids));
  }
  await db.delete(usersTable).where(inArray(usersTable.id, ALL_IDS));
}

beforeAll(async () => {
  await cleanup();

  await db.insert(usersTable).values([
    { id: TEACHER_ID, email: `${TEACHER_ID}@example.com`, role: "teacher", name: "Teach" },
    { id: ALICE, email: `${ALICE}@example.com`, role: "student", name: "Alice" },
    { id: BOB, email: `${BOB}@example.com`, role: "student", name: "Bob" },
    { id: CARA, email: `${CARA}@example.com`, role: "student", name: "Cara" },
  ]);

  const [course] = await db
    .insert(coursesTable)
    .values({ title: "Sim Test Course", teacherId: TEACHER_ID, inviteCode: "T40AAA" })
    .returning();
  courseId = course!.id;

  await db.insert(enrollmentsTable).values([
    { courseId, studentId: ALICE },
    { courseId, studentId: BOB },
    { courseId, studentId: CARA },
  ]);

  const [assignment] = await db
    .insert(assignmentsTable)
    .values({ courseId, title: "Essay", allowedTypes: ["text"], maxScore: 100 })
    .returning();
  assignmentId = assignment!.id;
});

afterAll(cleanup);

beforeEach(() => {
  mockGetAuth.mockReset();
  mockGetUser.mockReset();
});

describe("AI declaration + similarity", () => {
  let aliceSubId: number;
  let bobSubId: number;

  it("requires an AI declaration on submission", async () => {
    asUser(ALICE);
    const res = await request(app)
      .post(`/api/assignments/${assignmentId}/submissions`)
      .send({ textResponse: ESSAY });
    expect(res.status).toBe(400);
  });

  it("persists the declaration and note", async () => {
    asUser(ALICE);
    const res = await request(app)
      .post(`/api/assignments/${assignmentId}/submissions`)
      .send({
        textResponse: ESSAY,
        aiDeclaration: "assisted",
        aiDeclarationNote: "Used ChatGPT for outlining",
      });
    expect(res.status).toBe(201);
    expect(res.body.aiDeclaration).toBe("assisted");
    expect(res.body.aiDeclarationNote).toBe("Used ChatGPT for outlining");
    aliceSubId = res.body.id;
  });

  it("flags identical submissions from different students", async () => {
    asUser(BOB);
    const res = await request(app)
      .post(`/api/assignments/${assignmentId}/submissions`)
      .send({ textResponse: ESSAY, aiDeclaration: "none" });
    expect(res.status).toBe(201);
    bobSubId = res.body.id;

    const pairs = await db
      .select()
      .from(submissionSimilaritiesTable)
      .where(eq(submissionSimilaritiesTable.assignmentId, assignmentId));
    expect(pairs.length).toBe(1);
    expect(pairs[0]!.score).toBe(100);
  });

  it("does not flag a dissimilar submission", async () => {
    asUser(CARA);
    const res = await request(app)
      .post(`/api/assignments/${assignmentId}/submissions`)
      .send({ textResponse: DIFFERENT, aiDeclaration: "generated" });
    expect(res.status).toBe(201);

    const pairs = await db
      .select()
      .from(submissionSimilaritiesTable)
      .where(eq(submissionSimilaritiesTable.assignmentId, assignmentId));
    // Still only the Alice-Bob pair.
    expect(pairs.length).toBe(1);
  });

  it("teacher queue shows declaration and similarityMax", async () => {
    asUser(TEACHER_ID);
    const res = await request(app).get(
      `/api/assignments/${assignmentId}/submissions`,
    );
    expect(res.status).toBe(200);
    const alice = res.body.find((s: any) => s.id === aliceSubId);
    const cara = res.body.find((s: any) => s.studentId === CARA);
    expect(alice.aiDeclaration).toBe("assisted");
    expect(alice.similarityMax).toBe(100);
    expect(cara.similarityMax).toBeNull();
  });

  it("teacher sees similarity matches with excerpts on the submission view", async () => {
    asUser(TEACHER_ID);
    const res = await request(app).get(`/api/submissions/${aliceSubId}`);
    expect(res.status).toBe(200);
    expect(res.body.similarityMax).toBe(100);
    expect(res.body.similarityMatches).toHaveLength(1);
    expect(res.body.similarityMatches[0].submissionId).toBe(bobSubId);
    expect(res.body.similarityMatches[0].studentName).toBe("Bob");
    expect(res.body.similarityMatches[0].excerpt).toContain(
      "industrial revolution",
    );
  });

  it("student sees own declaration but no similarity matches", async () => {
    asUser(ALICE);
    const res = await request(app).get(`/api/submissions/${aliceSubId}`);
    expect(res.status).toBe(200);
    expect(res.body.aiDeclaration).toBe("assisted");
    expect(res.body.similarityMatches ?? null).toBeNull();
    expect(res.body.similarityMax ?? null).toBeNull();
  });

  it("students cannot view another student's submission", async () => {
    asUser(CARA);
    const res = await request(app).get(`/api/submissions/${aliceSubId}`);
    expect(res.status).toBe(403);
  });

  it("students cannot re-run the similarity check", async () => {
    asUser(ALICE);
    const res = await request(app).post(
      `/api/assignments/${assignmentId}/similarity`,
    );
    expect(res.status).toBe(403);
  });

  it("teacher can re-run the similarity check", async () => {
    asUser(TEACHER_ID);
    const res = await request(app).post(
      `/api/assignments/${assignmentId}/similarity`,
    );
    expect(res.status).toBe(200);
    expect(res.body.flaggedPairs).toBe(1);
  });

  it("legacy submissions without a declaration read back as null", async () => {
    const [legacy] = await db
      .insert(submissionsTable)
      .values({ assignmentId, studentId: CARA, textResponse: null, status: "submitted" })
      .returning();
    asUser(TEACHER_ID);
    const res = await request(app).get(`/api/submissions/${legacy!.id}`);
    expect(res.status).toBe(200);
    expect(res.body.aiDeclaration).toBeNull();
  });

  it("teacher gets a side-by-side comparison with highlight ranges", async () => {
    asUser(TEACHER_ID);
    const res = await request(app).get(
      `/api/submissions/${aliceSubId}/comparison/${bobSubId}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.score).toBe(100);
    expect(res.body.left.submissionId).toBe(aliceSubId);
    expect(res.body.right.submissionId).toBe(bobSubId);
    expect(res.body.left.text).toBe(ESSAY);
    expect(res.body.right.text).toBe(ESSAY);
    // Identical texts: one range spanning all words (trailing period excluded).
    expect(res.body.left.ranges).toEqual([{ start: 0, end: ESSAY.length - 1 }]);
    expect(res.body.right.ranges).toEqual([{ start: 0, end: ESSAY.length - 1 }]);
    expect(res.body.left.studentName).toBe("Alice");
    expect(res.body.right.studentName).toBe("Bob");
  });

  it("students cannot access the comparison endpoint", async () => {
    asUser(ALICE);
    const res = await request(app).get(
      `/api/submissions/${aliceSubId}/comparison/${bobSubId}`,
    );
    expect(res.status).toBe(403);
  });

  it("comparison 404s for submissions from different assignments", async () => {
    const [otherAssignment] = await db
      .insert(assignmentsTable)
      .values({ courseId, title: "Other", allowedTypes: ["text"], maxScore: 100 })
      .returning();
    const [foreign] = await db
      .insert(submissionsTable)
      .values({
        assignmentId: otherAssignment!.id,
        studentId: CARA,
        textResponse: ESSAY,
        status: "submitted",
      })
      .returning();
    asUser(TEACHER_ID);
    const res = await request(app).get(
      `/api/submissions/${aliceSubId}/comparison/${foreign!.id}`,
    );
    expect(res.status).toBe(404);
  });
});

describe("AI draft visibility", () => {
  let draftAssignmentId: number;
  let draftSubId: number;

  beforeAll(async () => {
    const [assignment] = await db
      .insert(assignmentsTable)
      .values({ courseId, title: "Draft essay", allowedTypes: ["text"], maxScore: 100 })
      .returning();
    draftAssignmentId = assignment!.id;
  });

  it("stores the AI draft but never returns it to the student", async () => {
    vi.mocked(gradeTextSubmission).mockResolvedValueOnce({
      aiScore: 72,
      aiFeedback: "Clear argument; cite one more source.",
    });
    asUser(ALICE);
    const created = await request(app)
      .post(`/api/assignments/${draftAssignmentId}/submissions`)
      .send({ textResponse: DIFFERENT, aiDeclaration: "none" });
    expect(created.status).toBe(201);
    expect(created.body.aiScore).toBeNull();
    expect(created.body.aiFeedback).toBeNull();
    draftSubId = created.body.id;

    const [stored] = await db
      .select()
      .from(submissionsTable)
      .where(eq(submissionsTable.id, draftSubId));
    expect(stored!.aiScore).toBe(72);

    const one = await request(app).get(`/api/submissions/${draftSubId}`);
    expect(one.status).toBe(200);
    expect(one.body.aiScore).toBeNull();
    expect(one.body.aiFeedback).toBeNull();

    const mine = await request(app).get("/api/submissions/mine");
    const listed = mine.body.find((s: any) => s.id === draftSubId);
    expect(listed.aiScore).toBeNull();
    expect(listed.aiFeedback).toBeNull();
  });

  it("the course teacher still sees the AI draft", async () => {
    asUser(TEACHER_ID);
    const one = await request(app).get(`/api/submissions/${draftSubId}`);
    expect(one.body.aiScore).toBe(72);
    expect(one.body.aiFeedback).toContain("Clear argument");

    const list = await request(app).get(`/api/assignments/${draftAssignmentId}/submissions`);
    expect(list.body.find((s: any) => s.id === draftSubId).aiScore).toBe(72);
  });
});
