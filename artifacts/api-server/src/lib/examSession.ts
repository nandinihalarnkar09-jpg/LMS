/**
 * Exam mode: server-authoritative timing for quizzes.
 *
 * The browser shows a countdown, but the server owns the clock. A student who
 * loses WiFi, closes the tab or whose phone dies keeps their saved answers and
 * the same deadline when they come back. When the deadline passes, the server
 * submits whatever was last saved — the student's work is never thrown away,
 * and nobody gets extra time by going offline.
 */

/**
 * Network grace after the deadline. A save or submit that left the student's
 * device on time but arrived a few seconds late (slow campus WiFi) is accepted.
 */
export const DEADLINE_GRACE_MS = 30_000;

/** Start + time limit, capped at the due date. Null for an untimed quiz. */
export function computeDeadline(
  startedAt: Date,
  timeLimitMinutes: number | null,
  dueDate: Date | null,
): Date | null {
  if (!timeLimitMinutes) return null;
  const byLimit = new Date(startedAt.getTime() + timeLimitMinutes * 60_000);
  if (dueDate && dueDate.getTime() < byLimit.getTime()) return dueDate;
  return byLimit;
}

/** True once the deadline plus the network grace has passed. */
export function isPastDeadline(deadlineAt: Date | null, now: Date = new Date()): boolean {
  if (!deadlineAt) return false;
  return now.getTime() > deadlineAt.getTime() + DEADLINE_GRACE_MS;
}

export type DraftAnswer = { questionId: number; selectedOption?: number; textAnswer?: string };

/**
 * Keep only answers to questions that belong to this quiz, one per question,
 * with bounded text (an autosave payload must not become a storage abuse path).
 */
export function cleanDraftAnswers(
  answers: DraftAnswer[],
  validQuestionIds: Set<number>,
  maxTextLength = 20_000,
): DraftAnswer[] {
  const byQuestion = new Map<number, DraftAnswer>();
  for (const a of answers) {
    if (!validQuestionIds.has(a.questionId)) continue;
    const clean: DraftAnswer = { questionId: a.questionId };
    if (typeof a.selectedOption === "number" && Number.isInteger(a.selectedOption) && a.selectedOption >= 0) {
      clean.selectedOption = a.selectedOption;
    }
    if (typeof a.textAnswer === "string") clean.textAnswer = a.textAnswer.slice(0, maxTextLength);
    byQuestion.set(a.questionId, clean);
  }
  return [...byQuestion.values()];
}
