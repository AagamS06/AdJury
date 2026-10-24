import Link from "next/link";
import { HERO, heroCtasFor, type HeroCta } from "@/lib/marketing/landing";

/**
 * Landing hero (DailyPlan Day 57). A thin, presentational server component that
 * renders the pure hero content from `lib/marketing/landing.ts` — the copy and
 * the session-aware CTA routing are owned (and tested) there; this file only
 * lays them out on brand (Design.md: Navy/white, Royal Blue accent, the Display
 * type scale, generous whitespace, borders over heavy shadows).
 *
 * Accessibility (Design.md §6): one `<h1>` carries the headline, CTAs are real
 * links with the app's standard visible focus ring, and the value pillars are a
 * semantic list — nothing relies on colour alone.
 */
export function LandingHero({ isAuthenticated }: { isAuthenticated: boolean }) {
  const ctas = heroCtasFor(isAuthenticated);

  return (
    <section className="mx-auto max-w-5xl px-6 pb-16 pt-12 sm:pt-16">
      <p className="text-sm font-semibold uppercase tracking-wide text-royal">
        {HERO.eyebrow}
      </p>

      <h1 className="mt-4 max-w-3xl text-4xl font-bold leading-tight tracking-tight text-ink sm:text-[2.5rem]">
        {HERO.headline}
      </h1>

      <p className="mt-5 max-w-2xl text-lg leading-relaxed text-body">
        {HERO.subhead}
      </p>

      <p className="mt-4 max-w-2xl text-sm text-muted">{HERO.audience}</p>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        {ctas.map((cta) => (
          <HeroButton key={cta.key} cta={cta} />
        ))}
      </div>

      <ul className="mt-14 grid gap-4 sm:grid-cols-3">
        {HERO.pillars.map((pillar) => (
          <li
            key={pillar.key}
            className="rounded-md border border-border bg-surface p-5"
          >
            <h2 className="text-base font-semibold text-navy">
              {pillar.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-body">
              {pillar.body}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A single hero CTA. Primary = Royal Blue solid, secondary = Navy outline
 * (Design.md §5); both share the Royal-bright focus ring.
 */
function HeroButton({ cta }: { cta: HeroCta }) {
  const base =
    "inline-flex items-center justify-center rounded-sm px-5 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright";
  const variant =
    cta.variant === "primary"
      ? "bg-royal text-white hover:bg-royal-bright"
      : "border border-navy text-navy hover:bg-canvas";

  return (
    <Link href={cta.href} className={`${base} ${variant}`}>
      {cta.label}
    </Link>
  );
}
