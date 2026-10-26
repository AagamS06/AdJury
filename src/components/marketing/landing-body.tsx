import {
  FEATURES,
  FEATURES_INTRO,
  HOW_IT_WORKS,
  HOW_IT_WORKS_INTRO,
  JURY_INTRO,
  jurySummaries,
  type SectionIntro,
} from "@/lib/marketing/landing";

/**
 * Landing body (DailyPlan Day 58). A thin, presentational server component that
 * renders the pure body content from `lib/marketing/landing.ts` — the features,
 * the jury (derived from the real `PERSONAS` roster), and the how-it-works steps
 * are owned and tested there; this file only lays them out on brand (Design.md:
 * Navy/white, Royal-Blue accent, generous whitespace, borders over heavy
 * shadows, the H2/H3 type scale).
 *
 * Accessibility (Design.md §6): each section is a labelled region with a single
 * `<h2>`; card titles and juror names are `<h3>`; every grouping is a semantic
 * list; the step numbers are decorative (`aria-hidden`) because the ordered list
 * already conveys sequence — nothing relies on colour alone.
 *
 * Scope: the social proof / CTA / footer below this is Day 59.
 */
export function LandingBody() {
  const jurors = jurySummaries();

  return (
    <>
      {/* Features ----------------------------------------------------------- */}
      <section
        aria-labelledby="landing-features-heading"
        className="mx-auto max-w-5xl px-6 py-16"
      >
        <SectionHeader intro={FEATURES_INTRO} headingId="landing-features-heading" />
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <li
              key={feature.key}
              className="rounded-md border border-border bg-surface p-5"
            >
              <h3 className="text-lg font-semibold text-navy">{feature.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-body">
                {feature.body}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* The jury ----------------------------------------------------------- */}
      <section
        aria-labelledby="landing-jury-heading"
        className="border-y border-border bg-canvas"
      >
        <div className="mx-auto max-w-5xl px-6 py-16">
          <SectionHeader intro={JURY_INTRO} headingId="landing-jury-heading" />
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {jurors.map((juror) => (
              <li
                key={juror.name}
                className="rounded-md border border-border bg-surface p-5"
              >
                <h3 className="text-base font-semibold text-navy">
                  {juror.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-body">
                  {juror.lens}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* How it works ------------------------------------------------------- */}
      <section
        aria-labelledby="landing-how-heading"
        className="mx-auto max-w-5xl px-6 py-16"
      >
        <SectionHeader intro={HOW_IT_WORKS_INTRO} headingId="landing-how-heading" />
        <ol className="mt-10 grid gap-4 sm:grid-cols-3">
          {HOW_IT_WORKS.map((step) => (
            <li
              key={step.key}
              className="rounded-md border border-border bg-surface p-5"
            >
              <span
                aria-hidden="true"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-royal text-sm font-bold tabular-nums text-white"
              >
                {step.step}
              </span>
              <h3 className="mt-4 text-base font-semibold text-navy">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-body">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </>
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
