import Link from "next/link";
import {
  getPricingCards,
  pricingCtaFor,
  type PricingCard,
  type PricingCta,
} from "@/lib/marketing/pricing";

/**
 * Pricing table (DailyPlan Day 73). A thin, presentational server component that
 * renders the pure pricing model from `lib/marketing/pricing.ts` — the plans,
 * prices, review limits, feature ladder, and session-aware CTAs are owned (and
 * tested) there, derived from the billing cores so the page can't drift from
 * config. This file only lays them out on brand (Design.md: Navy/white, Royal
 * accent, borders over heavy shadows, the H2/H3 type scale).
 *
 * Accessibility (Design.md §6): the group is a labelled region, each plan is an
 * `<article>` with its name as an `<h3>`, the feature list is semantic, and the
 * included/not-included state carries a drawn SVG glyph PLUS visually-hidden text
 * ("Included"/"Not included") — never colour alone — so the Day-65 chrome-emoji
 * copy audit stays clean too (a drawn check, not a dingbat).
 */
export function PricingTable({ isAuthenticated }: { isAuthenticated: boolean }) {
  const cards = getPricingCards();

  return (
    <section
      aria-labelledby="pricing-plans-heading"
      className="mx-auto max-w-5xl px-6 pb-8"
    >
      <h2 id="pricing-plans-heading" className="sr-only">
        Plans and pricing
      </h2>
      <ul className="grid gap-6 lg:grid-cols-3">
        {cards.map((card) => (
          <li key={card.tier}>
            <PlanCard card={card} cta={pricingCtaFor(card.tier, isAuthenticated)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One plan card. The featured (paid) plan gets a Royal ring + "Most popular" tag. */
function PlanCard({ card, cta }: { card: PricingCard; cta: PricingCta }) {
  const containerClass = card.highlighted
    ? "relative flex h-full flex-col rounded-md border-2 border-royal bg-surface p-6 shadow-card"
    : "relative flex h-full flex-col rounded-md border border-border bg-surface p-6";

  return (
    <article className={containerClass} aria-labelledby={`plan-${card.tier}-name`}>
      {card.highlighted && (
        <span className="absolute -top-3 left-6 rounded-sm bg-royal px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-white">
          Most popular
        </span>
      )}

      <h3
        id={`plan-${card.tier}-name`}
        className="text-xl font-semibold text-navy"
      >
        {card.name}
      </h3>
      <p className="mt-2 min-h-[2.5rem] text-sm leading-relaxed text-body">
        {card.tagline}
      </p>

      <p className="mt-4 text-3xl font-bold tracking-tight tabular-nums text-ink">
        {card.priceLabel}
      </p>

      <p className="mt-3 text-sm font-medium text-body">{card.limitLabel}</p>
      {card.trialLabel && (
        <p className="mt-1 text-sm text-royal">{card.trialLabel}</p>
      )}

      <div className="mt-6">
        <CtaControl cta={cta} />
      </div>

      <h4 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted">
        What's included
      </h4>
      <ul className="mt-3 space-y-2.5">
        {card.features.map((feature) => (
          <li
            key={feature.key}
            className="flex items-start gap-2.5 text-sm"
          >
            <FeatureGlyph included={feature.included} />
            <span className={feature.included ? "text-body" : "text-muted"}>
              {feature.label}
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}

/** The plan's CTA: a real link, or an inert "contact sales" label with a note. */
function CtaControl({ cta }: { cta: PricingCta }) {
  if (cta.kind === "inert") {
    return (
      <div>
        <p className="inline-flex w-full items-center justify-center rounded-sm border border-navy px-5 py-2.5 text-sm font-semibold text-navy">
          {cta.label}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted">{cta.note}</p>
      </div>
    );
  }

  const base =
    "inline-flex w-full items-center justify-center rounded-sm px-5 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright";
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

/**
 * A drawn glyph for the included/not-included state. A check for included and a
 * minus for not — both `aria-hidden`, each paired with visually-hidden text so a
 * screen reader hears the state and nothing relies on colour (Design.md §6).
 */
function FeatureGlyph({ included }: { included: boolean }) {
  return (
    <>
      <span className="sr-only">{included ? "Included:" : "Not included:"}</span>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className={`mt-0.5 h-4 w-4 flex-none ${included ? "text-success-deep" : "text-muted"}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {included ? (
          <path d="M4 10.5l4 4 8-9" />
        ) : (
          <path d="M5 10h10" />
        )}
      </svg>
    </>
  );
}
