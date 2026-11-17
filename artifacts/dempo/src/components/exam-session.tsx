import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  startQuizSession,
  saveQuizSession,
  createQuizAttempt,
  ApiError,
  type QuizSession,
  type QuizAnswerInput,
} from "@workspace/api-client-react";

/**
 * Exam-session engine for a student taking a quiz.
 *
 * - Answers are mirrored to localStorage on every change (survives a reload
 *   even while offline) and autosaved to the server shortly after each change,
 *   every 15 s while anything is unsaved, on reconnect, and when the tab hides.
 * - The countdown is computed from the server's deadline, corrected for the
 *   device's clock skew using the server time in each response.
 * - At zero it submits automatically. If the network is down at that moment
 *   it keeps retrying — and the server will submit the last saved answers on
 *   its own regardless, so nothing is lost either way.
 */

export type Answers = Record<number, { selectedOption?: number; textAnswer?: string }>;
export type SaveState = "idle" | "saving" | "saved" | "offline" | "error";

const AUTOSAVE_DEBOUNCE_MS = 1200;
const AUTOSAVE_INTERVAL_MS = 15_000;
const SUBMIT_RETRY_MS = 5_000;

function toInput(answers: Answers): QuizAnswerInput[] {
  return Object.entries(answers).map(([qid, a]) => ({
    questionId: Number(qid),
    ...(a.selectedOption != null ? { selectedOption: a.selectedOption } : {}),
    ...(a.textAnswer != null ? { textAnswer: a.textAnswer } : {}),
  }));
}

function fromInput(list: QuizAnswerInput[] | undefined): Answers {
  const out: Answers = {};
  for (const a of list ?? []) {
    out[a.questionId] = {
      ...(a.selectedOption != null ? { selectedOption: a.selectedOption } : {}),
      ...(a.textAnswer != null ? { textAnswer: a.textAnswer } : {}),
    };
  }
  return out;
}

type Backup = { answers: Answers; updatedAt: number };

function readBackup(key: string): Backup | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Backup) : null;
  } catch {
    return null;
  }
}
function writeBackup(key: string, answers: Answers) {
  try {
    localStorage.setItem(key, JSON.stringify({ answers, updatedAt: Date.now() } satisfies Backup));
  } catch {
    /* storage full or blocked: the server copy still applies */
  }
}
function clearBackup(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

const isNetworkError = (e: unknown) => !(e instanceof ApiError);

export function useExamSession(quizId: number, userId: string | undefined, onFinished: () => void) {
  const backupKey = `lms.quiz.${quizId}.${userId ?? "anon"}`;
  const [session, setSession] = useState<QuizSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [submitting, setSubmitting] = useState(false);
  const [submitProblem, setSubmitProblem] = useState<string | null>(null);
  const [closedMessage, setClosedMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const skewMs = useRef(0); // serverTime - deviceTime
  const dirty = useRef(false);
  const answersRef = useRef<Answers>({});
  const inFlight = useRef(false);
  const finished = useRef(false);
  answersRef.current = answers;

  const applyServer = useCallback((s: QuizSession) => {
    skewMs.current = new Date(s.serverNow).getTime() - Date.now();
    setSession((prev) => ({ ...s, questions: s.questions?.length ? s.questions : prev?.questions }));
    if (s.lastSavedAt) setLastSavedAt(new Date(s.lastSavedAt));
  }, []);

  const finish = useCallback(
    (message?: string) => {
      if (finished.current) return;
      finished.current = true;
      clearBackup(backupKey);
      if (message) setClosedMessage(message);
      onFinished();
    },
    [backupKey, onFinished],
  );

  // --- start / resume -----------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    startQuizSession(quizId)
      .then((s) => {
        if (cancelled) return;
        applyServer(s);
        const server = fromInput(s.answers);
        const backup = readBackup(backupKey);
        const serverSavedAt = s.lastSavedAt ? new Date(s.lastSavedAt).getTime() : 0;
        if (backup && backup.updatedAt > serverSavedAt && Object.keys(backup.answers).length) {
          // Work done while offline (or just before a crash) is newer than the
          // server copy: keep it and push it up straight away.
          setAnswers(backup.answers);
          dirty.current = true;
        } else {
          setAnswers(server);
        }
        setSaveState(s.lastSavedAt ? "saved" : "idle");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 409) {
          finish((e.data as { error?: string } | null)?.error ?? "This quiz is closed.");
          return;
        }
        setLoadError(
          isNetworkError(e)
            ? "We can't reach the server right now. Check your connection — your quiz will open as soon as you're back online."
            : (e as Error).message,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [quizId, backupKey, applyServer, finish]);

  // --- autosave -----------------------------------------------------------
  const save = useCallback(
    async (opts: { keepalive?: boolean } = {}) => {
      if (!dirty.current || inFlight.current || finished.current || !session) return;
      inFlight.current = true;
      const snapshot = answersRef.current;
      setSaveState("saving");
      try {
        const s = await saveQuizSession(
          quizId,
          { answers: toInput(snapshot) },
          opts.keepalive ? { keepalive: true } : undefined,
        );
        if (answersRef.current === snapshot) dirty.current = false;
        applyServer(s);
        setSaveState("saved");
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          finish((e.data as { error?: string } | null)?.error ?? "Time is up. Your last saved answers have been submitted.");
          return;
        }
        setSaveState(isNetworkError(e) ? "offline" : "error");
      } finally {
        inFlight.current = false;
      }
    },
    [quizId, session, applyServer, finish],
  );

  const setAnswer = useCallback(
    (questionId: number, value: { selectedOption?: number; textAnswer?: string }) => {
      setAnswers((prev) => {
        const next = { ...prev, [questionId]: value };
        writeBackup(backupKey, next);
        return next;
      });
      dirty.current = true;
    },
    [backupKey],
  );

  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => void save(), AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [answers, save]);

  useEffect(() => {
    const t = setInterval(() => void save(), AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(t);
  }, [save]);

  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      void save();
    };
    const goOffline = () => {
      setOnline(false);
      setSaveState((s) => (dirty.current ? "offline" : s));
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") void save({ keepalive: true });
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [save]);

  // --- submit -------------------------------------------------------------
  const submit = useCallback(
    async (reason: "student" | "timeout") => {
      if (finished.current) return;
      setSubmitting(true);
      setSubmitProblem(null);
      try {
        await createQuizAttempt(quizId, { answers: toInput(answersRef.current) });
        finish(reason === "timeout" ? "Time is up — your answers were submitted." : undefined);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          finish((e.data as { error?: string } | null)?.error ?? "This quiz has already been submitted.");
          return;
        }
        if (isNetworkError(e)) {
          setSubmitProblem(
            "You're offline, so we couldn't submit yet. Your answers are safe on this device and on the server up to your last save. We'll keep trying — you don't need to do anything.",
          );
          setTimeout(() => void submit(reason), SUBMIT_RETRY_MS);
          return;
        }
        setSubmitProblem((e as Error).message || "Something went wrong submitting. Please try again.");
        setSubmitting(false);
      }
    },
    [quizId, finish],
  );

  // --- clock --------------------------------------------------------------
  const deadline = session?.deadlineAt ? new Date(session.deadlineAt).getTime() : null;
  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [deadline]);
  const startedAt = session ? new Date(session.startedAt).getTime() : null;
  // Never show more than the full time limit (request latency can make the
  // skew estimate a few hundred ms generous, which would display "20:01").
  const remainingMs =
    deadline == null
      ? null
      : Math.max(0, Math.min(deadline - (startedAt ?? deadline), deadline - (now + skewMs.current)));

  useEffect(() => {
    if (remainingMs === 0 && !finished.current && !submitting) void submit("timeout");
  }, [remainingMs, submitting, submit]);

  const questions = useMemo(() => session?.questions ?? [], [session]);

  return {
    session,
    questions,
    loadError,
    answers,
    setAnswer,
    saveState,
    lastSavedAt,
    online,
    remainingMs,
    submit,
    submitting,
    submitProblem,
    closedMessage,
    saveNow: () => void save(),
  };
}

export function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
