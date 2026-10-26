import Link from "next/link";
import { signOutAction } from "@/lib/auth/actions";
import { getSessionContext, type SessionContext } from "@/lib/auth/session";
import { LandingHero } from "@/components/marketing/landing-hero";
import { LandingBody } from "@/components/marketing/landing-body";
import { MAIN_CONTENT_ID } from "@/lib/ui/a11y";

/**
 * Landing page. Reads the server session so it reflects a persisted login and
 * offers a sign-out (DailyPlan Day 3). Session resolution is wrapped so a
 * missing-credentials cloud build still renders the logged-out view rather than
 * crashing.
 *
 * Day 57 (landing hero) replaces the Phase-1 scaffold top with a real,
 * session-aware hero + value proposition (`LandingHero`). Day 58 adds the
 * detailed body — features, the six jurors, and how-it-works (`LandingBody`).
 * The social proof / CTA / footer is Day 59.
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

      <LandingBody />
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
