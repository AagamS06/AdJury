import Link from "next/link";
import { PERSONAS } from "@/lib/ai/personas";
import { signOutAction } from "@/lib/auth/actions";
import { getSessionContext, type SessionContext } from "@/lib/auth/session";

/**
 * Landing page. Reads the server session so it reflects a persisted login and
 * offers a sign-out (DailyPlan Day 3). Session resolution is wrapped so a
 * missing-credentials cloud build still renders the logged-out view rather than
 * crashing.
 */
export default async function Home() {
  let session: SessionContext | null = null;
  try {
    session = await getSessionContext();
  } catch {
    session = null;
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <div className="mb-10 flex items-center justify-between gap-4">
        <p className="text-sm font-semibold uppercase tracking-wide text-royal">
          AdJury
        </p>
        <AuthNav session={session} />
      </div>

      <h1 className="text-4xl font-bold text-ink">
        Five jurors review your content before you publish.
      </h1>
      <p className="mt-4 text-lg text-body">
        AdJury is a review &amp; QA layer for marketing content. Paste your ad
        copy, social post, or email and get scored, flagged, and rewritten from
        five distinct professional angles.
      </p>

      <ul className="mt-10 grid gap-3">
        {PERSONAS.map((p) => (
          <li
            key={p.name}
            className="rounded-md border border-border bg-surface px-4 py-3"
          >
            <span className="font-semibold text-navy">{p.title}</span>
            <span className="text-muted"> — {p.lens}</span>
          </li>
        ))}
      </ul>

      <p className="mt-10 text-sm text-muted">
        🚧 Phase 1 scaffold. The review engine runs today via{" "}
        <code className="font-mono">npm run demo</code>.
      </p>
    </main>
  );
}

function AuthNav({ session }: { session: SessionContext | null }) {
  if (!session) {
    return (
      <nav className="flex items-center gap-4 text-sm">
        <Link
          href="/login"
          className="font-semibold text-royal hover:text-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
        >
          Log in
        </Link>
        <Link
          href="/signup"
          className="rounded-sm bg-royal px-3 py-1.5 font-semibold text-white hover:bg-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
        >
          Sign up
        </Link>
      </nav>
    );
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-muted">
        Signed in as{" "}
        <span className="font-medium text-body">{session.email}</span>
      </span>
      <Link
        href="/dashboard"
        className="rounded-sm bg-royal px-3 py-1.5 font-semibold text-white hover:bg-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
      >
        Dashboard
      </Link>
      <form action={signOutAction}>
        <button
          type="submit"
          className="rounded-sm border border-border px-3 py-1.5 font-semibold text-navy hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
