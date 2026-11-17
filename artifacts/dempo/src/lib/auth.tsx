import {
  ClerkProvider,
  useAuth as useClerkAuth,
  SignIn as ClerkSignIn,
  SignUp as ClerkSignUp,
  SignOutButton as ClerkSignOutButton,
} from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Children, cloneElement, isValidElement, useEffect, useState, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { BRAND } from "@/lib/brand";

/**
 * Auth adapter. Production uses Clerk. Local development can set
 * VITE_AUTH_MODE=dev (with AUTH_MODE=dev on the API) to sign in as one of the
 * seeded demo accounts instead — no Clerk account or keys needed.
 *
 * Every screen imports useAuth / SignIn / SignUp / SignOutButton from here,
 * never from @clerk/react directly, so the mode is decided in one place.
 */
export const DEV_AUTH = import.meta.env.VITE_AUTH_MODE === "dev";

/* ------------------------------------------------------------------ */
/* Clerk mode                                                          */
/* ------------------------------------------------------------------ */

// Resolves the key from window.location.hostname so the same build serves
// multiple Clerk custom domains.
const publishableKey = DEV_AUTH
  ? ""
  : publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

// Empty in dev (Clerk hits dev FAPI directly), auto-set in prod. Do NOT gate on
// PROD/NODE_ENV or add a fallback — the empty dev value is intentional.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

function MissingKeyNotice() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="max-w-lg text-center space-y-3">
        <h1 className="text-xl font-semibold text-foreground">Sign-in isn't configured</h1>
        <p className="text-muted-foreground text-sm">
          This build has no Clerk publishable key (<code>VITE_CLERK_PUBLISHABLE_KEY</code>). For local
          development, set <code>AUTH_MODE=dev</code> and <code>VITE_AUTH_MODE=dev</code> in the root{" "}
          <code>.env</code> and run <code>pnpm run db:seed</code> — see README.md.
        </p>
      </div>
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { sessionId } = useClerkAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    queryClient.invalidateQueries();
  }, [sessionId, queryClient]);

  return null;
}

function ClerkModeProvider({ children }: { children: ReactNode }) {
  if (!publishableKey) return <MissingKeyNotice />;
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      proxyUrl={clerkProxyUrl}
      appearance={{
        variables: {
          colorPrimary: BRAND.clerk.colorPrimary,
          colorBackground: BRAND.clerk.colorBackground,
          fontFamily: BRAND.clerk.fontFamily,
          borderRadius: "0.5rem",
        },
        elements: {
          card: "shadow-sm border border-border",
          headerTitle: "text-xl font-semibold text-foreground",
          headerSubtitle: "text-muted-foreground",
          formButtonPrimary:
            "bg-primary text-primary-foreground hover:bg-primary/90 font-medium border-0 shadow-none normal-case",
          footerActionLink: "text-info hover:text-info/80 font-medium",
        },
      }}
      localization={{
        signIn: {
          start: {
            title: `Sign in to ${BRAND.name}`,
            subtitle: BRAND.copy.signInSubtitle,
          },
        },
        signUp: {
          start: {
            title: `Create your ${BRAND.name} account`,
            subtitle: BRAND.copy.signUpSubtitle,
          },
        },
      }}
    >
      <ClerkQueryClientCacheInvalidator />
      {children}
    </ClerkProvider>
  );
}

/* ------------------------------------------------------------------ */
/* Dev mode                                                            */
/* ------------------------------------------------------------------ */

type DevUser = { id: string; name: string | null; email: string; role: string; isAdmin: boolean };
const DEV_SESSION_KEY = ["dev-session"];

async function devFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body as T;
}

function useDevAuth() {
  const { data, isLoading } = useQuery({
    queryKey: DEV_SESSION_KEY,
    queryFn: () => devFetch<{ userId: string | null }>("/dev/session"),
    staleTime: Infinity,
    retry: false,
  });
  const userId = data?.userId ?? null;
  return { isLoaded: !isLoading, isSignedIn: !!userId, sessionId: userId, userId };
}

const ROLE_LABEL: Record<string, string> = {
  teacher: "Faculty",
  student: "Student",
  dean: "Dean",
  course_coordinator: "Course coordinator",
};

function DevSignIn() {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: users, isLoading, isError } = useQuery({
    queryKey: ["dev-users"],
    queryFn: () => devFetch<DevUser[]>("/dev/users"),
    retry: false,
  });

  const signIn = async (userId: string) => {
    setPending(userId);
    setError(null);
    try {
      await devFetch("/dev/login", { method: "POST", body: JSON.stringify({ userId }) });
      queryClient.clear();
      window.location.assign(import.meta.env.BASE_URL + "dashboard");
    } catch (e) {
      setError((e as Error).message);
      setPending(null);
    }
  };

  return (
    <div className="w-full rounded-lg border bg-card p-5 shadow-sm">
      <p className="text-sm font-medium text-foreground">Local demo sign-in</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Development mode: choose a seeded account. Production uses your college email sign-in.
      </p>
      <div className="mt-4 space-y-2" role="list">
        {isLoading && <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading accounts" />}
        {isError && (
          <p className="text-sm text-danger" role="alert">
            Couldn't reach the API. Is it running on port 8080? Start everything with <code>pnpm run dev</code>.
          </p>
        )}
        {users && users.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No demo accounts yet. Run <code>pnpm run db:seed</code>, then refresh this page.
          </p>
        )}
        {users?.map((u) => (
          <button
            key={u.id}
            role="listitem"
            type="button"
            onClick={() => signIn(u.id)}
            disabled={!!pending}
            className="flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            <span className="min-w-0">
              <span className="block truncate font-medium text-foreground">{u.name ?? u.email}</span>
              <span className="block truncate text-xs text-muted-foreground">{u.email}</span>
            </span>
            <span className="shrink-0 text-xs font-medium text-muted-foreground">
              {pending === u.id ? <Loader2 className="h-4 w-4 animate-spin" /> : `${ROLE_LABEL[u.role] ?? u.role}${u.isAdmin ? " · Admin" : ""}`}
            </span>
          </button>
        ))}
      </div>
      {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
    </div>
  );
}

function DevSignOutButton({ children }: { children: ReactNode }) {
  const onClick = async () => {
    await devFetch("/dev/logout", { method: "POST" }).catch(() => undefined);
    window.location.assign(import.meta.env.BASE_URL);
  };
  const child = Children.only(children);
  if (isValidElement(child)) {
    return cloneElement(child as ReactElement<{ onClick?: () => void }>, { onClick });
  }
  return <button type="button" onClick={onClick}>{children}</button>;
}

/* ------------------------------------------------------------------ */
/* Public API — the only auth surface the rest of the app uses         */
/* ------------------------------------------------------------------ */

export function AuthProvider({ children }: { children: ReactNode }) {
  return DEV_AUTH ? <>{children}</> : <ClerkModeProvider>{children}</ClerkModeProvider>;
}

export function useAuth(): { isLoaded: boolean; isSignedIn: boolean | undefined; sessionId?: string | null } {
  // The mode is fixed per build, so the same hook runs on every render.
  return DEV_AUTH ? useDevAuth() : useClerkAuth();
}

export function SignIn(props: ComponentProps<typeof ClerkSignIn>) {
  return DEV_AUTH ? <DevSignIn /> : <ClerkSignIn {...props} />;
}

export function SignUp(props: ComponentProps<typeof ClerkSignUp>) {
  return DEV_AUTH ? <DevSignIn /> : <ClerkSignUp {...props} />;
}

export function SignOutButton({ children }: { children: ReactNode }) {
  return DEV_AUTH ? (
    <DevSignOutButton>{children}</DevSignOutButton>
  ) : (
    <ClerkSignOutButton>{children}</ClerkSignOutButton>
  );
}
