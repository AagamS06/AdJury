import Link from "next/link";
import {
  FINAL_CTA,
  PROOF_POINTS,
  SOCIAL_PROOF_INTRO,
  TESTIMONIAL_PLACEHOLDER,
  heroCtasFor,
  type HeroCta,
  type SectionIntro,
} from "@/lib/marketing/landing";

/**
 * Landing closing sections (DailyPlan Day 59): the social-proof placeholder and
 * the final call-to-action band. A thin, presentational server component — all
 * copy and the session-aware CTA routing live in `lib/marketing/landing.ts`
 * (owned + tested there); this file only lays them out on brand (Design.md:
 * Navy/white, Royal-Blue accent, borders over heavy shadows, the H2/H3 scale).
 *
 * Accessibility (Design.md §6): each block is an `aria-labelledby` region with a
 * single `<h2>`, the proof points are a semantic list, the CTAs are real links
 * with the app's standard focus ring, and the dark CTA band keeps white-on-navy
 * (and white-on-royal button) contrast well above AA — nothing colour-only.
 *
 * The footer landmark below this is `LandingFooter`.
 */
export function LandingClosing({ isAuthenticated }: { isAuthenticated: boolean }) {
  return (
    <>
      {/* Social proof (placeholder) ---------------------------------------- */}
      <section
        aria-labelledby="landing-proof-heading"
        className="border-t border-border bg-canvas"
      >
        <div className="mx-auto max-w-5xl px-6 py-16">
          <SectionHeader
            intro={SOCIAL_PROOF_INTRO}
            headingId="landing-proof-heading"
          />
          <ul className="mt-10 grid gap-4 sm:grid-cols-3">
            {PROOF_POINTS.map((point) => (
              <li
                key={point.key}
                className="rounded-md border border-border bg-surface p-5"
              >
                <h3 className="text-base font-semibold text-navy">
                  {point.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-body">
                  {point.body}
                </p>
              </li>
            ))}
          </ul>

          {/* An explicit, honest placeholder — no fabricated testimonials. */}
          <div className="mt-6 rounded-md border border-dashed border-border bg-surface p-5">
            <p className="text-sm font-semibold uppercase tracking-wide text-muted">
              {TESTIMONIAL_PLACEHOLDER.label}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {TESTIMONIAL_PLACEHOLDER.body}
            </p>
          </div>
        </div>
      </section>

      {/* Final CTA band ---------------------------------------------------- */}
      <section
        aria-labelledby="landing-cta-heading"
        className="mx-auto max-w-5xl px-6 py-16"
      >
        <div className="rounded-lg bg-navy px-6 py-12 text-center sm:px-12">
          <p className="text-sm font-semibold uppercase tracking-wide text-royal-bright">
            {FINAL_CTA.eyebrow}
          </p>
          <h2
            id="landing-cta-heading"
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
    </>
  );
}

/**
 * A single CTA button styled for the dark Navy band: primary = solid white with
 * Navy text (maximum pop against Navy), secondary = white outline. Both keep the
 * app's visible focus ring (lightened to stay visible on the dark surface).
 */
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

/** A section's eyebrow + H2 heading + one-line intro, laid out consistently. */
function SectionHeader({
  intro,
  headingId,
}: {
  intro: SectionIntro;
  headingId: string;
}) {
  return (
    <div className="max-w-2xl">
      <p className="text-sm font-semibold uppercase tracking-wide text-royal">
        {intro.eyebrow}
      </p>
      <h2
        id={headingId}
        className="mt-3 text-2xl font-bold tracking-tight text-ink"
      >
        {intro.heading}
      </h2>
      <p className="mt-3 text-base leading-relaxed text-body">{intro.intro}</p>
    </div>
  );
}
