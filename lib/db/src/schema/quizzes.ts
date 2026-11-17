import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  jsonb,
  real,
  unique,
  boolean,
} from "drizzle-orm/pg-core";

export const quizzesTable = pgTable("quizzes", {
  id: serial("id").primaryKey(),
  courseId: integer("course_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  dueDate: timestamp("due_date", { withTimezone: true }),
  status: text("status").notNull().default("draft"), // draft | published
  // Exam mode: minutes each student gets from the moment they start. Null =
  // untimed (the original homework-style quiz).
  timeLimitMinutes: integer("time_limit_minutes"),
  resultsPublishedAt: timestamp("results_published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const quizQuestionsTable = pgTable("quiz_questions", {
  id: serial("id").primaryKey(),
  quizId: integer("quiz_id").notNull(),
  position: integer("position").notNull().default(0),
  type: text("type").notNull(), // multiple_choice | short_answer
  prompt: text("prompt").notNull(),
  options: jsonb("options").notNull().default([]).$type<string[]>(),
  correctOption: integer("correct_option"),
  points: integer("points").notNull().default(1),
});

export type QuizAnswer = {
  questionId: number;
  selectedOption?: number | null;
  textAnswer?: string | null;
  autoScore?: number | null;
  aiScore?: number | null;
  aiFeedback?: string | null;
  score?: number | null;
};

export const quizAttemptsTable = pgTable("quiz_attempts", {
  id: serial("id").primaryKey(),
  quizId: integer("quiz_id").notNull(),
  studentId: text("student_id").notNull(),
  answers: jsonb("answers").notNull().default([]).$type<QuizAnswer[]>(),
  score: real("score"),
  maxScore: integer("max_score").notNull().default(0),
  status: text("status").notNull().default("submitted"), // submitted | graded
  // When the student opened the attempt (exam mode), and whether the server
  // submitted their last saved answers because time ran out.
  startedAt: timestamp("started_at", { withTimezone: true }),
  autoSubmitted: boolean("auto_submitted").notNull().default(false),
  submittedAt: timestamp("submitted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  gradedAt: timestamp("graded_at", { withTimezone: true }),
}, (t) => [
  // Take-once enforcement, robust under concurrent submissions.
  unique("quiz_attempts_quiz_student_unique").on(t.quizId, t.studentId),
]);

/**
 * An in-progress attempt. Created when a student starts a quiz, updated by
 * autosave, deleted when the attempt is submitted. Holding answers on the
 * server is what lets a student survive a dropped connection, a closed tab or
 * a dead phone mid-exam: they reopen the quiz and carry on with the same clock.
 */
export const quizAttemptSessionsTable = pgTable("quiz_attempt_sessions", {
  id: serial("id").primaryKey(),
  quizId: integer("quiz_id").notNull(),
  studentId: text("student_id").notNull(),
  answers: jsonb("answers").notNull().default([]).$type<QuizSessionAnswer[]>(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  // Server-authoritative end: start + time limit, capped at the due date.
  deadlineAt: timestamp("deadline_at", { withTimezone: true }),
  lastSavedAt: timestamp("last_saved_at", { withTimezone: true }),
  saveCount: integer("save_count").notNull().default(0),
}, (t) => [
  unique("quiz_attempt_sessions_quiz_student_unique").on(t.quizId, t.studentId),
]);

export type QuizSessionAnswer = {
  questionId: number;
  selectedOption?: number;
  textAnswer?: string;
};

export type Quiz = typeof quizzesTable.$inferSelect;
export type QuizQuestion = typeof quizQuestionsTable.$inferSelect;
export type QuizAttempt = typeof quizAttemptsTable.$inferSelect;
export type QuizAttemptSession = typeof quizAttemptSessionsTable.$inferSelect;
