import Link from "next/link";
import type { Metadata } from "next";
import { getSessionContext, type SessionContext } from "@/lib/auth/session";
import { getTrialDays } from "@/lib/billing/plans";
import { PRICING_INTRO, pricingNotes } from "@/lib/marketing/pricing";
import { FINAL_CTA, heroCtasFor, type HeroCta } from "@/lib/marketing/landing";
import { PricingTable } from "@/components/marketing/pricing-table";
import { LandingFooter } from "@/components/marketing/landing-footer";
import { MAIN_CONTENT_ID } from "@/lib/ui/a11y";

/**
 * Public pricing page (DailyPlan Day 73). Renders the plan catalog, per-tier
 * review limits, and the feature ladder from the pure `lib/marketing/pricing.ts`
 * model — which derives everything from the billing cores, so the page "matches
 * config" by construction (the DoD). Session-aware like the landing page: the
 * CTAs route to sign-up when signed-out and back into the product when signed-in
 * (live test-mode checkout is Day 74; manage-plan is Day 76).
 *
 * Structure mirrors the landing page (Day 57–59): its own lightweight header, a
 * `<main>` carrying the shared `#main-content` landmark id (so the skip link
 * works here too — Day 55) with exactly one `<h1>`, and the shared
 * `LandingFooter` as the closing landmark.
 */
export const metadata: Metadata = {
  title: "Pricing — AdJury",
  description:
    "AdJury pricing — start free, upgrade when your team ships more. Every plan " +
    "runs the full jury on each submission.",
};

export default async function PricingPage() {
  let session: SessionContext | null = null;
  try {
    session = await getSessionContext();
  } catch {
    session = null;
  }
  const isAuthenticated = Boolean(session);
  const notes = pricingNotes(getTrialDays());

  return (
    <>
      <main id={MAIN_CONTENT_ID}>
        <header className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 pt-8">
          <Link
            href="/"
            className="rounded-sm text-sm font-semibold uppercase tracking-wide text-royal hover:text-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
          >
            AdJury
          </Link>
          <HeaderNav session={session} />
        </header>

        {/* Intro -------------------------------------------------------------- */}
        <section className="mx-auto max-w-5xl px-6 pb-12 pt-12 sm:pt-16">
          <p className="text-sm font-semibold uppercase tracking-wide text-royal">
            {PRICING_INTRO.eyebrow}
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl font-bold leading-tight tracking-tight text-ink">
            {PRICING_INTRO.heading}
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-body">
            {PRICING_INTRO.intro}
          </p>
        </section>

        {/* Plans -------------------------------------------------------------- */}
        <PricingTable isAuthenticated={isAuthenticated} />

        {/* Notes -------------------------------------------------------------- */}
        <section
          aria-labelledby="pricing-notes-heading"
          className="mx-auto max-w-5xl px-6 py-10"
        >
          <h2 id="pricing-notes-heading" className="sr-only">
            Billing notes
          </h2>
          <ul className="space-y-2 text-sm leading-relaxed text-muted">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>

        {/* Final CTA band ----------------------------------------------------- */}
        <section
          aria-labelledby="pricing-cta-heading"
          className="mx-auto max-w-5xl px-6 py-16"
        >
          <div className="rounded-lg bg-navy px-6 py-12 text-center sm:px-12">
            <p className="text-sm font-semibold uppercase tracking-wide text-royal-bright">
              {FINAL_CTA.eyebrow}
            </p>
            <h2
              id="pricing-cta-heading"
              className="mx-auto mt-3 max-w-2xl text-2xl font-bold tracking-tight text-white sm:text-3xl"
            >
              {FINAL_CTA.heading}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-white/80">
              {FINAL_CTA.subhead}
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              {heroCtasFor(isAuthenticated).map((cta) => (
                <CtaButton key={cta.key} cta={cta} />
              ))}
            </div>
          </div>
        </section>
      </main>

      <LandingFooter />
    </>
  );
}

/** Lightweight auth-aware nav for the pricing page header. */
function HeaderNav({ session }: { session: SessionContext | null }) {
  if (!session) {
    return (
      <nav className="flex items-center gap-4 text-sm">
        <Link
          href="/login"
          className="rounded-sm font-semibold text-royal hover:text-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
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
    <nav className="flex items-center gap-4 text-sm">
      <Link
        href="/dashboard"
        className="rounded-sm bg-royal px-3 py-1.5 font-semibold text-white hover:bg-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
      >
        Dashboard
      </Link>
    </nav>
  );
}

/** A CTA button styled for the dark Navy band (mirrors the landing closing band). */
function CtaButton({ cta }: { cta: HeroCta }) {
  const base =
    "inline-flex items-center justify-center rounded-sm px-5 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-navy";
  const variant =
    cta.variant === "primary"
      ? "bg-white text-navy hover:bg-white/90"
      : "border border-white/60 text-white hover:bg-white/10";

  return (
    <Link href={cta.href} className={`${base} ${variant}`}>
      {cta.label}
    </Link>
  );
}
