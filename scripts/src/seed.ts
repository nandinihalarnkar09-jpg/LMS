/**
 * Demo data for local development and product demos.
 *
 *   pnpm run db:seed          # create demo data (refuses if it already exists)
 *   pnpm run db:seed --reset  # wipe previous demo data, then re-create it
 *
 * Every account it creates has an id starting with "demo_" — the only ids the
 * local dev sign-in (AUTH_MODE=dev) will accept. All names are fictional.
 * Never point this at a production database: it refuses when NODE_ENV=production.
 */
import { inArray, like, or } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  coursesTable,
  enrollmentsTable,
  invitesTable,
  courseMaterialsTable,
  assignmentsTable,
  submissionsTable,
  quizzesTable,
  quizQuestionsTable,
  quizAttemptsTable,
  messagesTable,
  discussionThreadsTable,
  discussionPostsTable,
  classSessionsTable,
  attendanceTable,
  cohortsTable,
  cohortMembersTable,
  notificationsTable,
  activityLogsTable,
  gradebookCategoriesTable,
  gradeItemCategoriesTable,
  appInvitesTable,
} from "@workspace/db";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed demo data with NODE_ENV=production.");
  process.exit(1);
}

const reset = process.argv.includes("--reset");
const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const at = (days: number, hour = 17) => {
  const d = new Date(now + days * DAY);
  d.setHours(hour, 0, 0, 0);
  return d;
};

const FACULTY = [
  { id: "demo_faculty_asha", name: "Dr. Asha Naik", email: "asha.naik@demo.college.test", role: "teacher", isAdmin: true, title: "Associate Professor, Business Analytics" },
  { id: "demo_faculty_rohan", name: "Prof. Rohan Kamat", email: "rohan.kamat@demo.college.test", role: "teacher", isAdmin: false, title: "Assistant Professor, HRM" },
];
const LEADERS = [
  { id: "demo_dean_meera", name: "Dr. Meera Sardesai", email: "dean@demo.college.test", role: "dean", isAdmin: false, title: "Dean of Studies" },
  { id: "demo_coord_vikas", name: "Vikas Prabhu", email: "coordinator@demo.college.test", role: "course_coordinator", isAdmin: false, title: "PGDM Course Coordinator" },
];
const STUDENTS = [
  "Aditi Shetty", "Rahul Gaonkar", "Sneha D'Souza", "Karan Naik", "Priya Fernandes",
  "Nikhil Desai", "Tanvi Kerkar", "Arjun Pai",
].map((name, i) => ({
  id: `demo_student_${String(i + 1).padStart(2, "0")}`,
  name,
  email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@students.demo.college.test`,
  role: "student",
  isAdmin: false,
  title: null as string | null,
}));
const ALL_USERS = [...FACULTY, ...LEADERS, ...STUDENTS];

async function wipe(): Promise<void> {
  const demoIds = ALL_USERS.map((u) => u.id);
  const courses = await db
    .select({ id: coursesTable.id })
    .from(coursesTable)
    .where(like(coursesTable.teacherId, "demo_%"));
  const courseIds = courses.map((c) => c.id);
  if (courseIds.length) {
    const assignments = await db.select({ id: assignmentsTable.id }).from(assignmentsTable).where(inArray(assignmentsTable.courseId, courseIds));
    const quizzes = await db.select({ id: quizzesTable.id }).from(quizzesTable).where(inArray(quizzesTable.courseId, courseIds));
    const sessions = await db.select({ id: classSessionsTable.id }).from(classSessionsTable).where(inArray(classSessionsTable.courseId, courseIds));
    if (assignments.length) await db.delete(submissionsTable).where(inArray(submissionsTable.assignmentId, assignments.map((a) => a.id)));
    if (quizzes.length) {
      const qids = quizzes.map((q) => q.id);
      await db.delete(quizQuestionsTable).where(inArray(quizQuestionsTable.quizId, qids));
      await db.delete(quizAttemptsTable).where(inArray(quizAttemptsTable.quizId, qids));
    }
    if (sessions.length) await db.delete(attendanceTable).where(inArray(attendanceTable.sessionId, sessions.map((s) => s.id)));
    await db.delete(assignmentsTable).where(inArray(assignmentsTable.courseId, courseIds));
    await db.delete(quizzesTable).where(inArray(quizzesTable.courseId, courseIds));
    await db.delete(classSessionsTable).where(inArray(classSessionsTable.courseId, courseIds));
    await db.delete(courseMaterialsTable).where(inArray(courseMaterialsTable.courseId, courseIds));
    await db.delete(enrollmentsTable).where(inArray(enrollmentsTable.courseId, courseIds));
    await db.delete(invitesTable).where(inArray(invitesTable.courseId, courseIds));
    await db.delete(messagesTable).where(inArray(messagesTable.courseId, courseIds));
    await db.delete(discussionPostsTable).where(inArray(discussionPostsTable.courseId, courseIds));
    await db.delete(discussionThreadsTable).where(inArray(discussionThreadsTable.courseId, courseIds));
    await db.delete(gradeItemCategoriesTable).where(inArray(gradeItemCategoriesTable.courseId, courseIds));
    await db.delete(gradebookCategoriesTable).where(inArray(gradebookCategoriesTable.courseId, courseIds));
    await db.delete(coursesTable).where(inArray(coursesTable.id, courseIds));
  }
  const cohorts = await db.select({ id: cohortsTable.id }).from(cohortsTable).where(like(cohortsTable.teacherId, "demo_%"));
  if (cohorts.length) {
    await db.delete(cohortMembersTable).where(inArray(cohortMembersTable.cohortId, cohorts.map((c) => c.id)));
    await db.delete(cohortsTable).where(inArray(cohortsTable.id, cohorts.map((c) => c.id)));
  }
  await db.delete(notificationsTable).where(inArray(notificationsTable.userId, demoIds));
  await db.delete(activityLogsTable).where(inArray(activityLogsTable.userId, demoIds));
  await db.delete(appInvitesTable).where(like(appInvitesTable.email, "%demo.college.test"));
  await db.delete(usersTable).where(or(like(usersTable.id, "demo_%")));
}

async function main(): Promise<void> {
  const existing = await db.select({ id: usersTable.id }).from(usersTable).where(like(usersTable.id, "demo_%"));
  if (existing.length && !reset) {
    console.log(`Demo data already exists (${existing.length} demo accounts). Re-run with --reset to recreate it.`);
    return;
  }
  if (existing.length) {
    console.log("Removing previous demo data…");
    await wipe();
  }

  await db.insert(usersTable).values(ALL_USERS);

  const [analytics, hr] = await db
    .insert(coursesTable)
    .values([
      {
        title: "Business Analytics for Managers",
        description: "Turning data into decisions: descriptive statistics, dashboards, forecasting and a live capstone with a Goa-based business.",
        teacherId: "demo_faculty_asha",
        inviteCode: "DEMOBA",
      },
      {
        title: "AI Applications in (New Age) HR",
        description: "A 30-hour studio course: research HR-tech tools, implement one on dummy data, and build an AI prototype.",
        teacherId: "demo_faculty_rohan",
        inviteCode: "DEMOHR",
      },
    ])
    .returning();

  await db.insert(enrollmentsTable).values([
    ...STUDENTS.map((s) => ({ courseId: analytics.id, studentId: s.id })),
    ...STUDENTS.slice(0, 6).map((s) => ({ courseId: hr.id, studentId: s.id })),
  ]);

  const [cohort] = await db
    .insert(cohortsTable)
    .values({ teacherId: "demo_faculty_asha", name: "PGDM 2025–27 · Section A", type: "class", description: "First-year PGDM, Section A" })
    .returning();
  await db.insert(cohortMembersTable).values(STUDENTS.map((s) => ({ cohortId: cohort.id, studentId: s.id })));

  await db.insert(courseMaterialsTable).values([
    { courseId: analytics.id, authorId: "demo_faculty_asha", title: "Week 1 reading: What is a KPI, really?", body: "Read before Monday's session. Come with one metric your family business tracks and one it should.", links: ["https://en.wikipedia.org/wiki/Performance_indicator"] },
    { courseId: analytics.id, authorId: "demo_faculty_asha", title: "Dataset: Panaji café footfall (anonymised)", body: "Twelve weeks of daily footfall and weather. Used in Assignments 1 and 2." },
    { courseId: hr.id, authorId: "demo_faculty_rohan", title: "Studio brief: choose your HR field", body: "Recruitment, performance, HRMS, engagement, surveys or payroll. You'll carry it through the whole course." },
  ]);

  const [a1, a2, a3] = await db
    .insert(assignmentsTable)
    .values([
      { courseId: analytics.id, title: "Assignment 1 — Describe the footfall data", description: "Summarise the dataset in under 500 words: central tendency, spread, and two charts that a café owner would understand.", dueDate: at(-5), allowedTypes: ["text", "file", "link"], maxScore: 20 },
      { courseId: analytics.id, title: "Assignment 2 — Forecast next month", description: "Build a simple forecast and explain your assumptions. Submit a link to your sheet plus a short note.", dueDate: at(3), allowedTypes: ["text", "link"], maxScore: 30 },
      { courseId: hr.id, title: "Studio 1 — Tool landscape map", description: "Map ten HR-tech tools in your chosen field on a 2×2 of your choosing. Explain the axes.", dueDate: at(6), allowedTypes: ["text", "file", "link"], maxScore: 25 },
    ])
    .returning();

  const graded = STUDENTS.slice(0, 5);
  await db.insert(submissionsTable).values([
    ...graded.map((s, i) => ({
      assignmentId: a1.id,
      studentId: s.id,
      textResponse: `Footfall averages about ${140 + i * 7} visitors a day, peaking on Saturdays. Rainy days cut footfall by roughly a fifth. My two charts: a weekly line chart and a rain-vs-dry box plot.`,
      status: "graded",
      score: 14 + i,
      feedback: i % 2 ? "Clear and well-structured. Label your chart axes next time." : "Good use of the box plot. Your summary could be shorter.",
      submittedAt: at(-6 - i * 0.1),
      gradedAt: at(-3),
    })),
    { assignmentId: a1.id, studentId: STUDENTS[5].id, textResponse: "Mean footfall is 151. Saturday is busiest. Monsoon weeks are slow.", status: "submitted", submittedAt: at(-4) },
    { assignmentId: a2.id, studentId: STUDENTS[0].id, linkUrl: "https://docs.google.com/spreadsheets/d/demo", textResponse: "Used a 4-week moving average with a rain adjustment.", status: "submitted", submittedAt: at(-1) },
  ]);

  const [quiz] = await db
    .insert(quizzesTable)
    .values({ courseId: analytics.id, title: "Quiz 1 — Descriptive statistics", description: "Five questions. You have one attempt.", dueDate: at(2), status: "published" })
    .returning();
  await db.insert(quizQuestionsTable).values([
    { quizId: quiz.id, position: 0, type: "multiple_choice", prompt: "Which measure is least affected by one very busy festival day?", options: ["Mean", "Median", "Range", "Total"], correctOption: 1, points: 2 },
    { quizId: quiz.id, position: 1, type: "multiple_choice", prompt: "A box plot's box spans…", options: ["Minimum to maximum", "Mean ± 1 SD", "First to third quartile", "Mode to median"], correctOption: 2, points: 2 },
    { quizId: quiz.id, position: 2, type: "multiple_choice", prompt: "Footfall of 120, 150, 150, 180. The mode is…", options: ["120", "150", "165", "180"], correctOption: 1, points: 1 },
    { quizId: quiz.id, position: 3, type: "short_answer", prompt: "In one or two sentences: why might a café owner care more about the median than the mean?", options: [], correctOption: null, points: 3 },
  ]);

  const [midterm] = await db
    .insert(quizzesTable)
    .values({
      courseId: analytics.id,
      title: "Midterm — Forecasting (exam mode)",
      description: "Timed: 20 minutes from when you press Start. Answers save automatically.",
      dueDate: at(4),
      timeLimitMinutes: 20,
      status: "published",
    })
    .returning();
  await db.insert(quizQuestionsTable).values([
    { quizId: midterm.id, position: 0, type: "multiple_choice", prompt: "A 4-week moving average is best at…", options: ["Predicting festival spikes", "Smoothing week-to-week noise", "Explaining causes", "Removing seasonality entirely"], correctOption: 1, points: 2 },
    { quizId: midterm.id, position: 1, type: "multiple_choice", prompt: "Forecast error is usually measured with…", options: ["MAPE", "GDP", "NPS", "ROI"], correctOption: 0, points: 2 },
    { quizId: midterm.id, position: 2, type: "short_answer", prompt: "The monsoon starts next week. How would you adjust a footfall forecast, and why?", options: [], correctOption: null, points: 4 },
  ]);

  await db.insert(messagesTable).values([
    { courseId: analytics.id, senderId: "demo_faculty_asha", body: "Welcome to Business Analytics! Monday's session is in Room 204. Bring a laptop — we start with the café dataset.", isAnnouncement: true, createdAt: at(-8, 9) },
    { courseId: analytics.id, senderId: "demo_faculty_asha", body: "Assignment 1 grades are out. Most of you nailed the box plot; watch your axis labels in Assignment 2.", isAnnouncement: true, createdAt: at(-3, 10) },
    { courseId: hr.id, senderId: "demo_faculty_rohan", body: "Studio teams are posted. Pick your HR field by Friday.", isAnnouncement: true, createdAt: at(-2, 11) },
  ]);

  const [thread] = await db
    .insert(discussionThreadsTable)
    .values({ courseId: analytics.id, authorId: STUDENTS[2].id, title: "Should we remove the festival week as an outlier?", body: "Week 7 has Carnival and footfall triples. Do we drop it for the forecast?", lastActivityAt: at(-1, 15) })
    .returning();
  await db.insert(discussionPostsTable).values([
    { threadId: thread.id, courseId: analytics.id, authorId: "demo_faculty_asha", body: "Don't drop it silently. Forecast with and without it, and tell the owner which one you'd plan staff around.", isAnswer: true, createdAt: at(-1, 16) },
  ]);

  const sessions = await db
    .insert(classSessionsTable)
    .values([
      { courseId: analytics.id, title: "Session 1 — KPIs and the café dataset", startsAt: at(-7, 10), endsAt: at(-7, 11), location: "Room 204" },
      { courseId: analytics.id, title: "Session 2 — Spread and outliers", startsAt: at(-4, 10), endsAt: at(-4, 11), location: "Room 204" },
      { courseId: analytics.id, title: "Session 3 — Forecasting basics", startsAt: at(1, 10), endsAt: at(1, 11), location: "Room 204" },
    ])
    .returning();
  await db.insert(attendanceTable).values(
    sessions.slice(0, 2).flatMap((sess, si) =>
      STUDENTS.map((s, i) => ({
        sessionId: sess.id,
        courseId: analytics.id,
        studentId: s.id,
        status: (i + si) % 7 === 3 ? "absent" : (i + si) % 5 === 4 ? "late" : "present",
        markedBy: "demo_faculty_asha",
      })),
    ),
  );

  const [catAssign, catQuiz] = await db
    .insert(gradebookCategoriesTable)
    .values([
      { courseId: analytics.id, name: "Assignments", weight: 60, position: 0 },
      { courseId: analytics.id, name: "Quizzes", weight: 40, position: 1 },
    ])
    .returning();
  await db.insert(gradeItemCategoriesTable).values([
    { courseId: analytics.id, itemType: "assignment", itemId: a1.id, categoryId: catAssign.id },
    { courseId: analytics.id, itemType: "assignment", itemId: a2.id, categoryId: catAssign.id },
    { courseId: analytics.id, itemType: "quiz", itemId: quiz.id, categoryId: catQuiz.id },
    { courseId: analytics.id, itemType: "quiz", itemId: midterm.id, categoryId: catQuiz.id },
  ]);

  console.log("Demo data created:");
  console.log(`  ${ALL_USERS.length} accounts (sign in as any of them on the local sign-in page)`);
  console.log(`  2 courses — "${analytics.title}" (code DEMOBA), "${hr.title}" (code DEMOHR)`);
  console.log(`  3 assignments, 2 quizzes (one timed, exam mode), 3 sessions with attendance, announcements, a discussion thread`);
  void a3;
}

main()
  .catch((err) => {
    console.error("Seeding failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
