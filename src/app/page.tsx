import Link from "next/link";
import { PERSONAS } from "@/lib/ai/personas";
import { signOutAction } from "@/lib/auth/actions";
import { getSessionContext, type SessionContext } from "@/lib/auth/session";
import { LandingHero } from "@/components/marketing/landing-hero";
import { MAIN_CONTENT_ID } from "@/lib/ui/a11y";

/**
 * Landing page. Reads the server session so it reflects a persisted login and
 * offers a sign-out (DailyPlan Day 3). Session resolution is wrapped so a
 * missing-credentials cloud build still renders the logged-out view rather than
 * crashing.
 *
 * Day 57 (landing hero) replaces the Phase-1 scaffold top with a real,
 * session-aware hero + value proposition (`LandingHero`). The detailed body —
 * features, the six jurors, and how-it-works — is Day 58, and the social proof /
 * CTA / footer is Day 59; until then a light jury preview stands in below.
 */
export default async function Home() {
  let session: SessionContext | null = null;
  try {
    session = await getSessionContext();
  } catch {
    session = null;
  }

  return (
    <main id={MAIN_CONTENT_ID} className="pb-20">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 pt-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-royal">
          AdJury
        </p>
        <AuthNav session={session} />
      </header>

      <LandingHero isAuthenticated={Boolean(session)} />

      {/* Interim jury preview — the full "meet the six jurors" section is Day 58. */}
      <section className="mx-auto max-w-5xl px-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          The jury
        </h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
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
      </section>
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
