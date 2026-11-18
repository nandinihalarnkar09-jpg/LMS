import { Router, type IRouter } from "express";
import { eq, and, desc, asc, inArray } from "drizzle-orm";
import {
  db,
  quizzesTable,
  quizQuestionsTable,
  quizAttemptsTable,
  quizAttemptSessionsTable,
  usersTable,
  type Quiz,
  type QuizQuestion,
  type QuizAttempt,
  type QuizAnswer,
} from "@workspace/db";
import {
  ListQuizzesParams,
  ListQuizzesResponse,
  CreateQuizParams,
  CreateQuizBody,
  CreateQuizResponse,
  GetQuizParams,
  GetQuizResponse,
  UpdateQuizParams,
  UpdateQuizBody,
  UpdateQuizResponse,
  DeleteQuizParams,
  PublishQuizParams,
  PublishQuizResponse,
  PublishQuizResultsParams,
  PublishQuizResultsResponse,
  ListQuizAttemptsParams,
  ListQuizAttemptsResponse,
  CreateQuizAttemptParams,
  CreateQuizAttemptBody,
  CreateQuizAttemptResponse,
  GradeQuizAttemptParams,
  GradeQuizAttemptBody,
  GradeQuizAttemptResponse,
  StartQuizSessionParams,
  StartQuizSessionResponse,
  SaveQuizSessionParams,
  SaveQuizSessionBody,
  SaveQuizSessionResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { getCourse, canAccessCourse, isCourseTeacher, isEnrolled } from "../lib/authz";
import { gradeShortAnswer } from "../lib/grading";
import { logActivity } from "../lib/activityLog";
import { notifyCourseStudents, createNotifications } from "../lib/notifications";
import {
  computeDeadline,
  isPastDeadline,
  cleanDraftAnswers,
  type DraftAnswer,
} from "../lib/examSession";

const router: IRouter = Router();

type QuestionInput = {
  type: "multiple_choice" | "short_answer";
  prompt: string;
  options?: string[];
  correctOption?: number;
  points: number;
};

function validateQuestions(questions: QuestionInput[]): string | null {
  for (const q of questions) {
    if (q.type === "multiple_choice") {
      const options = q.options ?? [];
      if (options.length < 2) {
        return "Multiple-choice questions need at least two options";
      }
      if (
        q.correctOption == null ||
        q.correctOption < 0 ||
        q.correctOption >= options.length
      ) {
        return "Multiple-choice questions need a valid correct option";
      }
    }
  }
  return null;
}

function quizMaxScore(questions: QuizQuestion[]): number {
  return questions.reduce((sum, q) => sum + q.points, 0);
}

/** Strip correct answers for students. */
function sanitizeQuestions(
  questions: QuizQuestion[],
  revealAnswers: boolean,
): (QuizQuestion | (Omit<QuizQuestion, "correctOption"> & { correctOption: null }))[] {
  if (revealAnswers) return questions;
  return questions.map((q) => ({ ...q, correctOption: null }));
}

/**
 * Shape a student's own attempt. Scores stay hidden until results are
 * published. AI suggestions are a draft for the teacher and never reach the
 * student, before or after publishing: the final mark is the teacher's.
 */
function sanitizeAttempt(attempt: QuizAttempt, revealScores: boolean): QuizAttempt {
  if (revealScores) {
    return {
      ...attempt,
      answers: attempt.answers.map((a) => ({ ...a, aiScore: null, aiFeedback: null })),
    };
  }
  return {
    ...attempt,
    score: null,
    answers: attempt.answers.map((a) => ({
      questionId: a.questionId,
      selectedOption: a.selectedOption ?? null,
      textAnswer: a.textAnswer ?? null,
      autoScore: null,
      aiScore: null,
      aiFeedback: null,
      score: null,
    })),
  };
}

async function getQuizQuestions(quizId: number): Promise<QuizQuestion[]> {
  return db
    .select()
    .from(quizQuestionsTable)
    .where(eq(quizQuestionsTable.quizId, quizId))
    .orderBy(asc(quizQuestionsTable.position), asc(quizQuestionsTable.id));
}

async function loadQuizWithCourse(quizId: number) {
  const [quiz] = await db
    .select()
    .from(quizzesTable)
    .where(eq(quizzesTable.id, quizId));
  if (!quiz) return { quiz: undefined, course: undefined };
  const course = await getCourse(quiz.courseId);
  return { quiz, course };
}

/**
 * Score answers (MC instantly, short answers via AI best-effort) and record
 * the student's one attempt. Shared by normal submission and by the server
 * auto-submitting a timed attempt whose clock ran out. Returns null if the
 * student already has an attempt (take-once is enforced by a unique index).
 */
async function scoreAndRecordAttempt(
  quiz: Quiz,
  studentId: string,
  input: DraftAnswer[],
  opts: { startedAt?: Date | null; autoSubmitted?: boolean } = {},
): Promise<QuizAttempt | null> {
  const questions = await getQuizQuestions(quiz.id);
  const answerByQuestion = new Map(input.map((a) => [a.questionId, a]));
  const answers: QuizAnswer[] = await Promise.all(
    questions.map(async (q) => {
      const a = answerByQuestion.get(q.id);
      if (q.type === "multiple_choice") {
        const selected =
          a?.selectedOption != null &&
          a.selectedOption >= 0 &&
          a.selectedOption < q.options.length
            ? a.selectedOption
            : null;
        const autoScore =
          selected != null && selected === q.correctOption ? q.points : 0;
        return {
          questionId: q.id,
          selectedOption: selected,
          textAnswer: null,
          autoScore,
          aiScore: null,
          aiFeedback: null,
          score: null,
        };
      }
      const text = a?.textAnswer?.trim() ?? "";
      const graded = await gradeShortAnswer(q.prompt, q.points, text);
      return {
        questionId: q.id,
        selectedOption: null,
        textAnswer: text || null,
        autoScore: null,
        aiScore: graded.aiScore,
        aiFeedback: graded.aiFeedback,
        score: null,
      };
    }),
  );

  const [attempt] = await db
    .insert(quizAttemptsTable)
    .values({
      quizId: quiz.id,
      studentId,
      answers,
      score: null,
      maxScore: quizMaxScore(questions),
      status: "submitted",
      startedAt: opts.startedAt ?? null,
      autoSubmitted: opts.autoSubmitted ?? false,
    })
    .onConflictDoNothing()
    .returning();
  // The in-progress copy is no longer needed once the attempt is recorded.
  await db
    .delete(quizAttemptSessionsTable)
    .where(
      and(
        eq(quizAttemptSessionsTable.quizId, quiz.id),
        eq(quizAttemptSessionsTable.studentId, studentId),
      ),
    );
  return attempt ?? null;
}

/**
 * Submit every in-progress attempt whose time is up, using the answers that
 * were saved before the deadline. Runs lazily whenever the quiz is looked at
 * (teacher results, publishing results, a student reopening it), so a student
 * whose laptop died still ends up with a submitted attempt.
 */
async function finalizeExpiredSessions(quiz: Quiz, onlyStudentId?: string): Promise<number> {
  const sessions = await db
    .select()
    .from(quizAttemptSessionsTable)
    .where(
      onlyStudentId
        ? and(
            eq(quizAttemptSessionsTable.quizId, quiz.id),
            eq(quizAttemptSessionsTable.studentId, onlyStudentId),
          )
        : eq(quizAttemptSessionsTable.quizId, quiz.id),
    );
  let finalized = 0;
  for (const s of sessions) {
    if (!isPastDeadline(s.deadlineAt)) continue;
    const attempt = await scoreAndRecordAttempt(quiz, s.studentId, s.answers, {
      startedAt: s.startedAt,
      autoSubmitted: true,
    });
    if (attempt) {
      finalized++;
      void logActivity({
        user: null,
        action: "quiz.auto_submitted",
        message: `Time ran out on quiz "${quiz.title}"; submitted ${s.answers.length} saved answer(s) for ${s.studentId}`,
        metadata: { quizId: quiz.id, attemptId: attempt.id, studentId: s.studentId },
      });
    }
  }
  return finalized;
}

async function getSession(quizId: number, studentId: string) {
  const [session] = await db
    .select()
    .from(quizAttemptSessionsTable)
    .where(
      and(
        eq(quizAttemptSessionsTable.quizId, quizId),
        eq(quizAttemptSessionsTable.studentId, studentId),
      ),
    );
  return session;
}

async function insertQuestions(quizId: number, questions: QuestionInput[]) {
  await db.insert(quizQuestionsTable).values(
    questions.map((q, i) => ({
      quizId,
      position: i,
      type: q.type,
      prompt: q.prompt,
      options: q.type === "multiple_choice" ? (q.options ?? []) : [],
      correctOption: q.type === "multiple_choice" ? q.correctOption! : null,
      points: q.points,
    })),
  );
}

router.get(
  "/courses/:courseId/quizzes",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = ListQuizzesParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const course = await getCourse(params.data.courseId);
    if (!course) {
      res.status(404).json({ error: "Course not found" });
      return;
    }
    if (!(await canAccessCourse(course, req.localUser!))) {
      res.status(403).json({ error: "Not a member of this course" });
      return;
    }
    const teacher = isCourseTeacher(course, req.localUser!);

    const quizzes = await db
      .select()
      .from(quizzesTable)
      .where(eq(quizzesTable.courseId, course.id))
      .orderBy(desc(quizzesTable.createdAt));

    const visible = teacher
      ? quizzes
      : quizzes.filter((q) => q.status === "published");

    const enriched = await Promise.all(
      visible.map(async (quiz) => {
        const questions = await getQuizQuestions(quiz.id);
        const attempts = await db
          .select()
          .from(quizAttemptsTable)
          .where(eq(quizAttemptsTable.quizId, quiz.id));
        const mine = attempts.find((a) => a.studentId === req.userId!);
        return {
          ...quiz,
          maxScore: quizMaxScore(questions),
          questionCount: questions.length,
          attemptCount: attempts.length,
          myAttempt: mine
            ? sanitizeAttempt(mine, !!quiz.resultsPublishedAt)
            : null,
        };
      }),
    );

    res.json(ListQuizzesResponse.parse(enriched));
  },
);

router.post(
  "/courses/:courseId/quizzes",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = CreateQuizParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = CreateQuizBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const course = await getCourse(params.data.courseId);
    if (!course) {
      res.status(404).json({ error: "Course not found" });
      return;
    }
    if (!isCourseTeacher(course, req.localUser!)) {
      res.status(403).json({ error: "Only the course teacher can create quizzes" });
      return;
    }
    const problem = validateQuestions(parsed.data.questions as QuestionInput[]);
    if (problem) {
      res.status(400).json({ error: problem });
      return;
    }

    const [quiz] = await db
      .insert(quizzesTable)
      .values({
        courseId: course.id,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
        timeLimitMinutes: parsed.data.timeLimitMinutes ?? null,
        status: "draft",
      })
      .returning();
    await insertQuestions(quiz.id, parsed.data.questions as QuestionInput[]);
    const questions = await getQuizQuestions(quiz.id);

    void logActivity({
      user: req.localUser!,
      action: "quiz.created",
      message: `${req.localUser!.email} created quiz "${quiz.title}" in course "${course.title}"`,
      metadata: { quizId: quiz.id, courseId: course.id },
    });

    res.status(201).json(
      CreateQuizResponse.parse({
        ...quiz,
        maxScore: quizMaxScore(questions),
        questionCount: questions.length,
        attemptCount: 0,
        questions,
        myAttempt: null,
      }),
    );
  },
);

router.get(
  "/quizzes/:quizId",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = GetQuizParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const { quiz, course } = await loadQuizWithCourse(params.data.quizId);
    if (!quiz || !course) {
      res.status(404).json({ error: "Quiz not found" });
      return;
    }
    if (!(await canAccessCourse(course, req.localUser!))) {
      res.status(403).json({ error: "Not a member of this course" });
      return;
    }
    const teacher = isCourseTeacher(course, req.localUser!);
    if (!teacher && quiz.status !== "published") {
      res.status(404).json({ error: "Quiz not found" });
      return;
    }

    await finalizeExpiredSessions(quiz, teacher ? undefined : req.userId!);
    const questions = await getQuizQuestions(quiz.id);
    const attempts = await db
      .select()
      .from(quizAttemptsTable)
      .where(eq(quizAttemptsTable.quizId, quiz.id));
    const mine = attempts.find((a) => a.studentId === req.userId!);
    const revealAnswers =
      teacher || (!!quiz.resultsPublishedAt && !!mine);
    const session = teacher ? undefined : await getSession(quiz.id, req.userId!);
    // Timed quiz: a student sees the questions only once their clock is
    // running (POST /quizzes/:id/session returns them), never before.
    const hideQuestions = !teacher && !!quiz.timeLimitMinutes && !mine;

    res.json(
      GetQuizResponse.parse({
        ...quiz,
        maxScore: quizMaxScore(questions),
        questionCount: questions.length,
        attemptCount: attempts.length,
        questions: hideQuestions ? [] : sanitizeQuestions(questions, revealAnswers),
        myAttempt: mine
          ? sanitizeAttempt(mine, !!quiz.resultsPublishedAt)
          : null,
        mySession: session
          ? { startedAt: session.startedAt, deadlineAt: session.deadlineAt }
          : null,
      }),
    );
  },
);

router.put(
  "/quizzes/:quizId",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = UpdateQuizParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = UpdateQuizBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { quiz, course } = await loadQuizWithCourse(params.data.quizId);
    if (!quiz || !course) {
      res.status(404).json({ error: "Quiz not found" });
      return;
    }
    if (!isCourseTeacher(course, req.localUser!)) {
      res.status(403).json({ error: "Only the course teacher can edit quizzes" });
      return;
    }
    const problem = validateQuestions(parsed.data.questions as QuestionInput[]);
    if (problem) {
      res.status(400).json({ error: problem });
      return;
    }

    const attempts = await db
      .select()
      .from(quizAttemptsTable)
      .where(eq(quizAttemptsTable.quizId, quiz.id));
    const sessions = await db
      .select({ id: quizAttemptSessionsTable.id })
      .from(quizAttemptSessionsTable)
      .where(eq(quizAttemptSessionsTable.quizId, quiz.id));
    if (attempts.length > 0 || sessions.length > 0) {
      res.status(409).json({
        error:
          attempts.length > 0
            ? "Questions cannot change after students have taken the quiz"
            : "Questions cannot change while students are taking the quiz",
      });
      return;
    }

    const [updated] = await db
      .update(quizzesTable)
      .set({
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
        timeLimitMinutes: parsed.data.timeLimitMinutes ?? null,
      })
      .where(eq(quizzesTable.id, quiz.id))
      .returning();
    await db
      .delete(quizQuestionsTable)
      .where(eq(quizQuestionsTable.quizId, quiz.id));
    await insertQuestions(quiz.id, parsed.data.questions as QuestionInput[]);
    const questions = await getQuizQuestions(quiz.id);

    res.json(
      UpdateQuizResponse.parse({
        ...updated,
        maxScore: quizMaxScore(questions),
        questionCount: questions.length,
        attemptCount: 0,
        questions,
        myAttempt: null,
      }),
    );
  },
);

router.delete(
  "/quizzes/:quizId",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = DeleteQuizParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const { quiz, course } = await loadQuizWithCourse(params.data.quizId);
    if (!quiz || !course) {
      res.status(404).json({ error: "Quiz not found" });
      return;
    }
    if (!isCourseTeacher(course, req.localUser!)) {
      res.status(403).json({ error: "Only the course teacher can delete quizzes" });
      return;
    }
    await db.delete(quizAttemptsTable).where(eq(quizAttemptsTable.quizId, quiz.id));
    await db.delete(quizAttemptSessionsTable).where(eq(quizAttemptSessionsTable.quizId, quiz.id));
    await db.delete(quizQuestionsTable).where(eq(quizQuestionsTable.quizId, quiz.id));
    await db.delete(quizzesTable).where(eq(quizzesTable.id, quiz.id));

    void logActivity({
      user: req.localUser!,
      action: "quiz.deleted",
      message: `${req.localUser!.email} deleted quiz "${quiz.title}"`,
      metadata: { quizId: quiz.id, courseId: course.id },
    });

    res.status(204).end();
  },
);

router.post(
  "/quizzes/:quizId/publish",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = PublishQuizParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const { quiz, course } = await loadQuizWithCourse(params.data.quizId);
    if (!quiz || !course) {
      res.status(404).json({ error: "Quiz not found" });
      return;
    }
    if (!isCourseTeacher(course, req.localUser!)) {
      res.status(403).json({ error: "Only the course teacher can publish quizzes" });
      return;
    }

    const [updated] = await db
      .update(quizzesTable)
      .set({ status: "published" })
      .where(eq(quizzesTable.id, quiz.id))
      .returning();
    const questions = await getQuizQuestions(quiz.id);

    if (quiz.status !== "published") {
      void notifyCourseStudents(course.id, {
        type: "quiz.published",
        title: `New quiz: ${quiz.title}`,
        body: `Posted in ${course.title}${quiz.dueDate ? ` — due ${quiz.dueDate.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC` : ""}`,
        link: `/quiz/${quiz.id}`,
        refId: quiz.id,
      });
    }

    res.json(
      PublishQuizResponse.parse({
        ...updated,
        maxScore: quizMaxScore(questions),
        questionCount: questions.length,
      }),
    );
  },
);

router.post(
  "/quizzes/:quizId/publish-results",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = PublishQuizResultsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const { quiz, course } = await loadQuizWithCourse(params.data.quizId);
    if (!quiz || !course) {
      res.status(404).json({ error: "Quiz not found" });
      return;
    }
    if (!isCourseTeacher(course, req.localUser!)) {
      res.status(403).json({ error: "Only the course teacher can publish results" });
      return;
    }

    // Anyone whose timed attempt has run out gets their saved answers in first.
    await finalizeExpiredSessions(quiz);

    // Finalize every attempt: any answer without a teacher-set score falls
    // back to its AI suggestion (short answer) or auto score (multiple choice).
    const attempts = await db
      .select()
      .from(quizAttemptsTable)
      .where(eq(quizAttemptsTable.quizId, quiz.id));
    const now = new Date();
    for (const attempt of attempts) {
      // Finalize with the teacher's manual score, else the deterministic
      // auto-score for objective questions. The AI suggestion (aiScore) is
      // NEVER auto-finalized — it can be steered by prompt injection in the
      // student's answer, so a short answer with no human/auto score stays 0
      // until a teacher grades it.
      const answers = attempt.answers.map((a) => ({
        ...a,
        score: a.score ?? a.autoScore ?? 0,
      }));
      const total = answers.reduce((sum, a) => sum + (a.score ?? 0), 0);
      await db
        .update(quizAttemptsTable)
        .set({ answers, score: total, status: "graded", gradedAt: now })
        .where(eq(quizAttemptsTable.id, attempt.id));
    }

    const [updated] = await db
      .update(quizzesTable)
      .set({ resultsPublishedAt: now })
      .where(eq(quizzesTable.id, quiz.id))
      .returning();
    const questions = await getQuizQuestions(quiz.id);

    void logActivity({
      user: req.localUser!,
      action: "quiz.results_published",
      message: `${req.localUser!.email} published results for quiz "${quiz.title}"`,
      metadata: { quizId: quiz.id, courseId: course.id },
    });

    void createNotifications(
      attempts.map((a) => ({
        userId: a.studentId,
        type: "quiz.results_published",
        title: `Results published: ${quiz.title}`,
        body: `Your quiz score is now available in ${course.title}.`,
        link: `/quiz/${quiz.id}`,
        courseId: course.id,
        refId: quiz.id,
      })),
    );

    res.json(
      PublishQuizResultsResponse.parse({
        ...updated,
        maxScore: quizMaxScore(questions),
        questionCount: questions.length,
        attemptCount: attempts.length,
      }),
    );
  },
);

router.get(
  "/quizzes/:quizId/attempts",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = ListQuizAttemptsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const { quiz, course } = await loadQuizWithCourse(params.data.quizId);
    if (!quiz || !course) {
      res.status(404).json({ error: "Quiz not found" });
      return;
    }
    if (!isCourseTeacher(course, req.localUser!)) {
      res.status(403).json({ error: "Only the course teacher can view all attempts" });
      return;
    }
    await finalizeExpiredSessions(quiz);

    const attempts = await db
      .select()
      .from(quizAttemptsTable)
      .where(eq(quizAttemptsTable.quizId, quiz.id))
      .orderBy(desc(quizAttemptsTable.submittedAt));

    const studentIds = attempts.map((a) => a.studentId);
    const students = studentIds.length
      ? await db
          .select()
          .from(usersTable)
          .where(inArray(usersTable.id, studentIds))
      : [];
    const nameById = new Map(students.map((s) => [s.id, s.name ?? s.email]));

    res.json(
      ListQuizAttemptsResponse.parse(
        attempts.map((a) => ({
          ...a,
          studentName: nameById.get(a.studentId) ?? null,
        })),
      ),
    );
  },
);

router.post(
  "/quizzes/:quizId/attempts",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = CreateQuizAttemptParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = CreateQuizAttemptBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { quiz, course } = await loadQuizWithCourse(params.data.quizId);
    if (!quiz || !course) {
      res.status(404).json({ error: "Quiz not found" });
      return;
    }
    if (!(await isEnrolled(course.id, req.userId!))) {
      res.status(403).json({ error: "Not enrolled in this course" });
      return;
    }
    if (quiz.status !== "published") {
      res.status(404).json({ error: "Quiz not found" });
      return;
    }
    if (quiz.resultsPublishedAt) {
      res.status(409).json({
        error: "Results have been published; this quiz is closed",
      });
      return;
    }

    const [existing] = await db
      .select()
      .from(quizAttemptsTable)
      .where(
        and(
          eq(quizAttemptsTable.quizId, quiz.id),
          eq(quizAttemptsTable.studentId, req.userId!),
        ),
      );
    if (existing) {
      res.status(409).json({ error: "You have already taken this quiz" });
      return;
    }

    const questions = await getQuizQuestions(quiz.id);
    const validIds = new Set(questions.map((q) => q.id));
    for (const a of parsed.data.answers) {
      if (!validIds.has(a.questionId)) {
        res.status(400).json({ error: "Answer references an unknown question" });
        return;
      }
    }

    const session = await getSession(quiz.id, req.userId!);
    if (quiz.timeLimitMinutes && !session) {
      res.status(400).json({ error: "Start the quiz first — the timer begins when you press Start." });
      return;
    }

    // Past the deadline: the answers saved in time stand, not whatever arrives
    // late. Within the deadline (plus network grace): the submitted answers.
    const late = !!session && isPastDeadline(session.deadlineAt);
    const answers = late
      ? session!.answers
      : cleanDraftAnswers(parsed.data.answers as DraftAnswer[], validIds);

    const attempt = await scoreAndRecordAttempt(quiz, req.userId!, answers, {
      startedAt: session?.startedAt ?? null,
      autoSubmitted: late,
    });
    if (!attempt) {
      res.status(409).json({ error: "You have already taken this quiz" });
      return;
    }

    void logActivity({
      user: req.localUser!,
      action: late ? "quiz.auto_submitted" : "quiz.attempted",
      message: late
        ? `${req.localUser!.email} submitted after time ran out on quiz "${quiz.title}"; saved answers were used`
        : `${req.localUser!.email} took quiz "${quiz.title}"`,
      metadata: { quizId: quiz.id, attemptId: attempt.id },
    });

    res.status(201).json(
      CreateQuizAttemptResponse.parse(
        sanitizeAttempt(attempt, !!quiz.resultsPublishedAt),
      ),
    );
  },
);

/** Shared checks for the session endpoints: enrolled, published, still open. */
async function loadOpenQuizForStudent(
  quizId: number,
  studentId: string,
): Promise<{ quiz: Quiz; error?: undefined } | { quiz?: undefined; error: { status: number; message: string } }> {
  const { quiz, course } = await loadQuizWithCourse(quizId);
  if (!quiz || !course || quiz.status !== "published") {
    return { error: { status: 404, message: "Quiz not found" } };
  }
  if (!(await isEnrolled(course.id, studentId))) {
    return { error: { status: 403, message: "Not enrolled in this course" } };
  }
  if (quiz.resultsPublishedAt) {
    return { error: { status: 409, message: "Results have been published; this quiz is closed" } };
  }
  return { quiz };
}

function sessionView(
  quiz: Quiz,
  session: typeof quizAttemptSessionsTable.$inferSelect,
  questions: QuizQuestion[],
) {
  return {
    quizId: quiz.id,
    startedAt: session.startedAt,
    deadlineAt: session.deadlineAt,
    serverNow: new Date(),
    answers: session.answers,
    lastSavedAt: session.lastSavedAt,
    saveCount: session.saveCount,
    questions: sanitizeQuestions(questions, false),
  };
}

// Start or resume an attempt. Idempotent: calling it again (page reload,
// reconnect, another device) returns the same clock and the saved answers.
router.post(
  "/quizzes/:quizId/session",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = StartQuizSessionParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const loaded = await loadOpenQuizForStudent(params.data.quizId, req.userId!);
    if (loaded.error) {
      res.status(loaded.error.status).json({ error: loaded.error.message });
      return;
    }
    const quiz = loaded.quiz;

    await finalizeExpiredSessions(quiz, req.userId!);
    const [attempt] = await db
      .select({ id: quizAttemptsTable.id, autoSubmitted: quizAttemptsTable.autoSubmitted })
      .from(quizAttemptsTable)
      .where(
        and(
          eq(quizAttemptsTable.quizId, quiz.id),
          eq(quizAttemptsTable.studentId, req.userId!),
        ),
      );
    if (attempt) {
      res.status(409).json({
        error: attempt.autoSubmitted
          ? "Time ran out, so your saved answers were submitted for you."
          : "You have already submitted this quiz.",
      });
      return;
    }

    let session = await getSession(quiz.id, req.userId!);
    if (!session) {
      const now = new Date();
      if (quiz.timeLimitMinutes && quiz.dueDate && quiz.dueDate.getTime() <= now.getTime()) {
        res.status(409).json({ error: "This quiz closed at its due date." });
        return;
      }
      await db
        .insert(quizAttemptSessionsTable)
        .values({
          quizId: quiz.id,
          studentId: req.userId!,
          startedAt: now,
          deadlineAt: computeDeadline(now, quiz.timeLimitMinutes, quiz.dueDate),
        })
        .onConflictDoNothing();
      session = await getSession(quiz.id, req.userId!);
      if (quiz.timeLimitMinutes) {
        void logActivity({
          user: req.localUser!,
          action: "quiz.started",
          message: `${req.localUser!.email} started timed quiz "${quiz.title}"`,
          metadata: { quizId: quiz.id, deadlineAt: session?.deadlineAt?.toISOString() ?? null },
        });
      }
    }

    const questions = await getQuizQuestions(quiz.id);
    res.json(StartQuizSessionResponse.parse(sessionView(quiz, session!, questions)));
  },
);

// Autosave. Called every few seconds while the student works, and again as
// soon as the browser reconnects after a drop.
router.put(
  "/quizzes/:quizId/session",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = SaveQuizSessionParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = SaveQuizSessionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const loaded = await loadOpenQuizForStudent(params.data.quizId, req.userId!);
    if (loaded.error) {
      res.status(loaded.error.status).json({ error: loaded.error.message });
      return;
    }
    const quiz = loaded.quiz;
    const session = await getSession(quiz.id, req.userId!);
    if (!session) {
      // No session: either never started, or already submitted.
      res.status(409).json({ error: "This attempt is no longer open." });
      return;
    }
    if (isPastDeadline(session.deadlineAt)) {
      await finalizeExpiredSessions(quiz, req.userId!);
      res.status(409).json({ error: "Time is up. Your last saved answers have been submitted." });
      return;
    }

    const questions = await getQuizQuestions(quiz.id);
    const answers = cleanDraftAnswers(
      parsed.data.answers as DraftAnswer[],
      new Set(questions.map((q) => q.id)),
    );
    const [saved] = await db
      .update(quizAttemptSessionsTable)
      .set({ answers, lastSavedAt: new Date(), saveCount: session.saveCount + 1 })
      .where(eq(quizAttemptSessionsTable.id, session.id))
      .returning();
    res.json(SaveQuizSessionResponse.parse(sessionView(quiz, saved, questions)));
  },
);

router.patch(
  "/quiz-attempts/:attemptId/grade",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = GradeQuizAttemptParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = GradeQuizAttemptBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [attempt] = await db
      .select()
      .from(quizAttemptsTable)
      .where(eq(quizAttemptsTable.id, params.data.attemptId));
    if (!attempt) {
      res.status(404).json({ error: "Attempt not found" });
      return;
    }
    const { quiz, course } = await loadQuizWithCourse(attempt.quizId);
    if (!quiz || !course || !isCourseTeacher(course, req.localUser!)) {
      res.status(403).json({ error: "Only the course teacher can grade" });
      return;
    }

    const questions = await getQuizQuestions(quiz.id);
    const pointsById = new Map(questions.map((q) => [q.id, q.points]));
    const overrides = new Map<number, number>();
    for (const s of parsed.data.scores) {
      const max = pointsById.get(s.questionId);
      if (max == null) {
        res.status(400).json({ error: "Score references an unknown question" });
        return;
      }
      overrides.set(s.questionId, Math.max(0, Math.min(max, s.score)));
    }

    // Answers the teacher did not touch keep their current mark. A short
    // answer nobody has marked stays unmarked (null) rather than becoming 0,
    // so the teacher's screen can still show it as "to mark"; publishing
    // results counts it as 0. The AI suggestion is never used here.
    const answers = attempt.answers.map((a) => {
      const override = overrides.get(a.questionId);
      const score =
        override != null ? override : a.score ?? a.autoScore ?? null;
      return { ...a, score };
    });
    const total = answers.reduce((sum, a) => sum + (a.score ?? 0), 0);

    const [updated] = await db
      .update(quizAttemptsTable)
      .set({
        answers,
        score: total,
        status: "graded",
        gradedAt: new Date(),
      })
      .where(eq(quizAttemptsTable.id, attempt.id))
      .returning();

    void logActivity({
      user: req.localUser!,
      action: "quiz.attempt_graded",
      message: `${req.localUser!.email} adjusted a quiz attempt for "${quiz.title}" (${total}/${updated.maxScore})`,
      metadata: { quizId: quiz.id, attemptId: attempt.id, score: total },
    });

    res.json(GradeQuizAttemptResponse.parse(updated));
  },
);

export default router;
