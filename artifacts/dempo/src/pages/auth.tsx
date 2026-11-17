import { Clock, GraduationCap, BookOpen, Loader2 } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useLocation, Link } from "wouter";
import { SignIn, SignUp, useAuth } from "@/lib/auth";
import { useGetMe, useUpdateMe } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BrandMark } from "@/components/brand-mark";
import { BRAND } from "@/lib/brand";

/* ---------------- Auth shell (sign in / sign up) ---------------- */

function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col justify-center bg-background py-12 px-4 sm:px-6">
      <div className="mx-auto w-full max-w-md flex flex-col items-center">
        <Link href="/" className="flex flex-col items-center mb-6" aria-label={`${BRAND.name} home`}>
          <BrandMark size="lg" />
        </Link>
        <h1 className="text-center text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {subtitle && <p className="mt-1.5 text-center text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="mt-8 mx-auto w-full max-w-md flex justify-center">
        {children}
      </div>
      <p className="mt-6 mx-auto w-full max-w-md text-center text-xs text-muted-foreground px-4">
        By continuing you agree to our{" "}
        <Link href="/legal/terms" className="text-info hover:underline">Terms</Link>{" "}and{" "}
        <Link href="/legal/privacy" className="text-info hover:underline">Privacy Policy</Link>.
      </p>
    </div>
  );
}

export function SignInPage() {
  return (
    <AuthShell title="Sign in" subtitle={BRAND.copy.signInSubtitle}>
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" />
    </AuthShell>
  );
}

export function SignUpPage() {
  return (
    <AuthShell title="Create your account" subtitle={BRAND.copy.signUpSubtitle}>
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" />
    </AuthShell>
  );
}

/* ---------------- Role picker ---------------- */

export function RolePickerPage() {
  const [, setLocation] = useLocation();
  const { data: user, isLoading } = useGetMe();
  const updateMe = useUpdateMe();

  useEffect(() => {
    if (user && user.role !== "unassigned") setLocation("/dashboard");
  }, [user, setLocation]);

  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (user.role !== "unassigned") return null;

  const handleSelectRole = (role: "student") => {
    updateMe.mutate({ data: { role } }, { onSuccess: () => setLocation("/dashboard") });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center py-12 px-4">
      <div className="mx-auto w-full max-w-md flex flex-col items-center text-center">
        <BrandMark size="lg" className="mb-6" />
        <h1 className="text-3xl font-semibold tracking-tight text-foreground mb-2">Welcome to {BRAND.name}</h1>
        <p className="text-muted-foreground max-w-sm mb-10">
          Let's set you up as a student — join courses, submit work, and track your grades and feedback.
        </p>
        <Card className="w-full text-left">
          <CardHeader>
            <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mb-2">
              <BookOpen className="w-5 h-5 text-foreground" />
            </div>
            <CardTitle className="text-lg">Continue as student</CardTitle>
            <CardDescription>Join courses, submit assignments, and view grades and feedback.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button disabled={updateMe.isPending} className="w-full" onClick={() => handleSelectRole("student")}>
              {updateMe.isPending ? "Setting up…" : "Get started"}
            </Button>
          </CardContent>
        </Card>
        <p className="text-sm text-muted-foreground mt-6">
          Teaching at the college? The college office sets up faculty accounts.
        </p>
      </div>
    </div>
  );
}

/* ---------------- Landing ---------------- */

// Only claims that are true of the product today (no AI grading: it ships off).
const FACTS = [
  {
    icon: Clock,
    title: "Quiz answers save as you type",
    body: "Lose WiFi in the middle of a quiz and keep going. Answers sync when you reconnect, and timed quizzes keep the same clock on any device.",
  },
  {
    icon: GraduationCap,
    title: "Marks the way your course counts them",
    body: "Weighted components set by your teacher, attendance for every session, and a transcript you can download.",
  },
  {
    icon: BookOpen,
    title: "Set up by the college",
    body: "Accounts come from the college roster, so you land in the right sections. You can download a copy of your data at any time from Settings.",
  },
];

export function LandingPage() {
  const { isSignedIn, isLoaded } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isLoaded && isSignedIn) setLocation("/dashboard");
  }, [isLoaded, isSignedIn, setLocation]);

  if (!isLoaded || isSignedIn) return null;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b">
        <div className="mx-auto max-w-6xl px-5 md:px-8 h-16 flex items-center justify-between gap-4">
          <BrandMark />
          <Button asChild size="sm">
            <Link href="/sign-in">Sign in</Link>
          </Button>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-5 md:px-8 pt-14 pb-14 md:pt-24 md:pb-20 grid md:grid-cols-[1fr_auto] gap-12 items-center">
          <div className="max-w-xl">
            <h1 className="text-4xl sm:text-5xl font-bold leading-[1.05] text-foreground" style={{ fontStretch: "82%" }}>
              Your courses, quizzes and marks at Dempo College.
            </h1>
            <p className="mt-5 text-lg text-muted-foreground max-w-[34rem]">
              Assignments, timed quizzes, attendance and your gradebook in one place — built to keep your work safe on patchy campus WiFi.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row sm:items-center gap-3">
              <Button asChild size="lg">
                <Link href="/sign-in">Sign in with your college email</Link>
              </Button>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              No account yet? The college office adds students from the roster each term.
            </p>
          </div>
          <img
            src={import.meta.env.BASE_URL + BRAND.logo}
            alt="Crest of Srinivassa Sinai Dempo College, founded 1966"
            className="hidden md:block w-64 h-64 lg:w-72 lg:h-72"
          />
        </section>

        <section className="border-t bg-muted/50">
          <div className="mx-auto max-w-6xl px-5 md:px-8 py-14 grid gap-10 md:grid-cols-3">
            {FACTS.map((f) => (
              <div key={f.title} className="max-w-sm">
                <f.icon className="w-5 h-5 text-primary mb-3" aria-hidden />
                <h2 className="text-lg font-semibold mb-1.5">{f.title}</h2>
                <p className="text-[15px] text-muted-foreground leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto max-w-6xl px-5 md:px-8 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>© {new Date().getFullYear()} {BRAND.institutionFull}</span>
          <nav className="flex items-center gap-4" aria-label="Legal">
            <Link href="/legal/privacy" className="hover:text-foreground underline-offset-4 hover:underline">Privacy</Link>
            <Link href="/legal/terms" className="hover:text-foreground underline-offset-4 hover:underline">Terms</Link>
            <Link href="/legal/cookies" className="hover:text-foreground underline-offset-4 hover:underline">Cookies</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
