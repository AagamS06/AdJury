/**
 * Pricing-page content model — pure core (DailyPlan Day 73 — "Pricing page
 * reflecting the tiers"; DoD: pricing renders and matches config).
 *
 * This is the display model the public `/pricing` page renders. It is built
 * ENTIRELY by deriving from the two billing cores, never by re-typing numbers:
 *
 *   - `plans.ts`        — the plan catalog (name, tagline, price, interval, which
 *                         plan is purchasable) and the trial-length config.
 *   - `entitlements.ts` — the tier → limits/features map (the review allowance a
 *                         tier drives, and the monotonic feature ladder).
 *
 * Deriving the page from config is exactly what makes "pricing matches config"
 * true by construction: if the entry price, a plan's tagline, the review limit,
 * the trial length, or the feature ladder changes in the billing cores, this
 * model follows and the page follows it — there is no second place a price or a
 * limit is written (Rules.md §7 — one source of truth, no drift). `reconcilePricing`
 * is the executable form of the DoD and a drift guard (the Day 43–72 "inventory +
 * drift guard" pattern), proving the built cards still agree with the catalog, the
 * limiters, and the feature ladder.
 *
 * Pure and node-testable: no React, no DOM, no network, no Stripe SDK. The thin
 * server component `components/marketing/pricing-table.tsx` only lays these values
 * out on brand, mirroring the Day 57–59 landing pattern (`landing.ts` + thin
 * components). CTAs are resolved per auth state (`pricingCtaFor`), mirroring the
 * hero's `heroCtasFor`.
 *
 * Scope note: this is the pricing *page* (Day 73). Test-mode checkout is Day 74
 * and the manage-plan UI is Day 76, so a plan's CTA here routes to sign-up (or the
 * dashboard, when signed in) rather than straight into a Stripe Checkout Session —
 * the acquisition surface, not the payment flow. Enterprise is an inert
 * "contact sales" (no self-serve route exists, so nothing dangles — the Day 59
 * "omit links that don't exist yet" rule).
 */

import {
  buildBillingCatalog,
  getBillingCatalog,
  getTrialDays,
  formatPlanPriceWithInterval,
  type BillingPlan,
} from "@/lib/billing/plans";
import {
  PLAN_TIER_ORDER,
  PLAN_FEATURE_META,
  featuresForTier,
  resolveTierLimits,
  type PlanFeature,
} from "@/lib/billing/entitlements";
import type { PlanTier } from "@/types/db";

/* -------------------------------------------------------------------------- */
/* Page copy                                                                   */
/* -------------------------------------------------------------------------- */

/** The pricing page's hero copy. The `heading` becomes the page's single `<h1>`. */
export const PRICING_INTRO = {
  /** Small kicker above the headline. */
  eyebrow: "Pricing",
  /** The H1 headline. */
  heading: "Simple, predictable pricing",
  /** One or two sentences framing the plans. */
  intro:
    "Start free, upgrade when your team ships more. Every plan runs the full " +
    "jury on each submission — the difference is how much you review and the " +
    "reporting and controls you unlock.",
} as const;

/**
 * Honest, plain-language notes shown beneath the plans (Design.md §7 — concise,
 * no hype). Every line is a true property of how billing works (PRD §6.3 — AUD,
 * public trial, cancel anytime); the trial line is added only when a trial is
 * actually configured, so the page never promises a trial that isn't on.
 */
export function pricingNotes(trialDays: number): readonly string[] {
  const notes = [
    "Prices are in Australian dollars (AUD) and billed monthly.",
    "Cancel anytime — your plan runs until the end of the paid period.",
  ];
  if (trialDays > 0) {
    notes.push(
      `Your ${trialDays}-day free trial starts when you subscribe — you're not ` +
        "charged until it ends.",
    );
  }
  notes.push(
    "Review limits reset on a rolling window, so you're never locked out for a " +
      "full calendar day after a busy stretch.",
  );
  return notes;
}

/* -------------------------------------------------------------------------- */
/* The pricing cards                                                           */
/* -------------------------------------------------------------------------- */

/** One feature row on a pricing card: the ladder feature + whether this tier has it. */
export interface PricingFeatureRow {
  /** The feature key (matches `PlanFeature`). */
  key: PlanFeature;
  /** Short human label. */
  label: string;
  /** One-line description of what the feature gives. */
  description: string;
  /** Whether this card's tier unlocks the feature (derived from the ladder). */
  included: boolean;
}

/** A single plan card on the pricing page. */
export interface PricingCard {
  /** The plan tier (`companies.plan_tier`). */
  tier: PlanTier;
  /** Display name (from the catalog). */
  name: string;
  /** One-line positioning (from the catalog). */
  tagline: string;
  /** Price label, e.g. `A$20.00 / month`, `Free`, `Custom` (from the catalog). */
  priceLabel: string;
  /** Price in cents: 0 free, null custom (the number the Stripe price must match). */
  amountCents: number | null;
  /** Reviews per day this tier allows (from the rate-limit policy). */
  reviewLimit: number;
  /** Human review-allowance line, e.g. `100 reviews / day`. */
  limitLabel: string;
  /** Trial note for a purchasable plan with a configured trial, else null. */
  trialLabel: string | null;
  /** Whether to visually feature this plan (the paid entry plan — exactly one). */
  highlighted: boolean;
  /** The full feature ladder with this tier's included flags, for comparison. */
  features: readonly PricingFeatureRow[];
}

/** Group a non-negative integer into thousands with commas (locale-fixed, no Intl). */
function groupThousands(n: number): string {
  return Math.trunc(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** The review-allowance line for a tier's per-day review limit. */
export function reviewLimitLabel(limit: number): string {
  return `${groupThousands(limit)} reviews / day`;
}

/**
 * Build the pricing cards from an explicit catalog + trial length — pure given
 * its inputs so the whole model is testable with no env. One card per tier in
 * `PLAN_TIER_ORDER` (low → high, the display order). Each card's price comes from
 * the catalog, its review limit from the rate limiters (via `resolveTierLimits`),
 * and its feature flags from the entitlement ladder (`featuresForTier`), so the
 * card can't state anything the billing cores don't.
 */
export function buildPricingCards(
  catalog: Record<PlanTier, BillingPlan>,
  trialDays: number,
): readonly PricingCard[] {
  return PLAN_TIER_ORDER.map((tier): PricingCard => {
    const plan = catalog[tier];
    const reviewLimit = resolveTierLimits(tier).review.limit;
    const included = featuresForTier(tier);
    const features: PricingFeatureRow[] = PLAN_FEATURE_META.map((meta) => ({
      key: meta.key,
      label: meta.label,
      description: meta.description,
      included: included.has(meta.key),
    }));
    return {
      tier,
      name: plan.name,
      tagline: plan.tagline,
      priceLabel: formatPlanPriceWithInterval(plan),
      amountCents: plan.amountCents,
      reviewLimit,
      limitLabel: reviewLimitLabel(reviewLimit),
      // Only a purchasable plan advertises the trial, and only when one is on.
      trialLabel:
        plan.purchasable && trialDays > 0
          ? `Includes a ${trialDays}-day free trial`
          : null,
      highlighted: plan.key === "pro",
      features,
    };
  });
}

/** The pricing cards resolved from the environment (catalog + trial config). */
export function getPricingCards(): readonly PricingCard[] {
  return buildPricingCards(getBillingCatalog(), getTrialDays());
}

/* -------------------------------------------------------------------------- */
/* Call-to-action (session-aware)                                              */
/* -------------------------------------------------------------------------- */

/**
 * A plan's call-to-action. A `link` routes somewhere real (sign-up / dashboard);
 * an `inert` CTA is a non-link label (enterprise "contact sales") so nothing
 * dangles to a route that doesn't exist yet (Day 59 rule). Exactly one `link` is
 * `primary` across a card set per auth state (the paid entry plan), mirroring the
 * hero's one-primary invariant.
 */
export type PricingCta =
  | {
      kind: "link";
      /** Stable key for React lists and tests. */
      key: string;
      /** Visible, action-first label. */
      label: string;
      /** Destination — an existing in-app route (no trailing slash). */
      href: string;
      /** Visual emphasis; exactly one `primary` per card set per auth state. */
      variant: "primary" | "secondary";
    }
  | {
      kind: "inert";
      /** Stable key for React lists and tests. */
      key: string;
      /** Visible label (e.g. "Contact sales"). */
      label: string;
      /** Plain-language note explaining the non-self-serve path. */
      note: string;
    };

/**
 * Resolve a plan's CTA for the viewer's auth state.
 *
 * Day 73 is the pricing page, not checkout (Day 74) or manage-plan (Day 76), so
 * the acquisition CTAs route to sign-up (signed-out) or back into the product
 * (signed-in) — every `href` an existing route, so nothing dangles. The paid
 * `pro` plan is the single `primary`. Enterprise is inert "Contact sales": there
 * is no self-serve enterprise route, so it is a label, not a link.
 */
export function pricingCtaFor(
  tier: PlanTier,
  isAuthenticated: boolean,
): PricingCta {
  if (tier === "enterprise") {
    return {
      kind: "inert",
      key: "enterprise",
      label: "Contact sales",
      note: "Custom pricing — reach out to discuss volume, limits, and controls.",
    };
  }

  // Signed-in visitors are already in the product; point them back into it
  // rather than to sign-up. (Live checkout / manage-plan is Day 74 / Day 76.)
  const href = isAuthenticated ? "/dashboard" : "/signup";

  if (tier === "pro") {
    return {
      kind: "link",
      key: "pro",
      label: isAuthenticated ? "Go to your dashboard" : "Start your free trial",
      href,
      variant: "primary",
    };
  }
  // free
  return {
    kind: "link",
    key: "free",
    label: isAuthenticated ? "Go to your dashboard" : "Get started free",
    href,
    variant: "secondary",
  };
}

/* -------------------------------------------------------------------------- */
/* Drift guard                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Reconcile the pricing model against the billing cores — a pure drift guard
 * proving the page still "matches config" (the executable DoD). Returns a list of
 * problems; empty means clean. Builds its own cards from a given catalog + trial
 * length so the check is deterministic and env-free.
 */
export function reconcilePricing(
  catalog: Record<PlanTier, BillingPlan>,
  trialDays: number,
): string[] {
  const problems: string[] = [];
  const cards = buildPricingCards(catalog, trialDays);

  // 1. Exactly one card per known tier, in PLAN_TIER_ORDER.
  const cardTiers = cards.map((c) => c.tier);
  if (cardTiers.length !== PLAN_TIER_ORDER.length) {
    problems.push(
      `expected ${PLAN_TIER_ORDER.length} cards, got ${cardTiers.length}`,
    );
  }
  PLAN_TIER_ORDER.forEach((tier, i) => {
    if (cardTiers[i] !== tier) {
      problems.push(`card ${i} is "${cardTiers[i]}", expected "${tier}"`);
    }
  });

  for (const card of cards) {
    const plan = catalog[card.tier];

    // 2. Price + naming come straight from the catalog (no drift).
    if (card.name !== plan.name) {
      problems.push(`card "${card.tier}" name "${card.name}" ≠ catalog "${plan.name}"`);
    }
    if (card.tagline !== plan.tagline) {
      problems.push(`card "${card.tier}" tagline differs from the catalog`);
    }
    if (card.amountCents !== plan.amountCents) {
      problems.push(
        `card "${card.tier}" amountCents ${card.amountCents} ≠ catalog ${plan.amountCents}`,
      );
    }
    if (card.priceLabel !== formatPlanPriceWithInterval(plan)) {
      problems.push(`card "${card.tier}" priceLabel differs from the catalog format`);
    }

    // 3. The review allowance IS the limiter's own number.
    const limit = resolveTierLimits(card.tier).review.limit;
    if (card.reviewLimit !== limit) {
      problems.push(
        `card "${card.tier}" reviewLimit ${card.reviewLimit} ≠ limiter ${limit}`,
      );
    }
    if (card.limitLabel !== reviewLimitLabel(limit)) {
      problems.push(`card "${card.tier}" limitLabel differs from the limiter number`);
    }

    // 4. Feature flags match the entitlement ladder exactly (full coverage).
    const included = featuresForTier(card.tier);
    if (card.features.length !== PLAN_FEATURE_META.length) {
      problems.push(
        `card "${card.tier}" has ${card.features.length} feature rows, expected ${PLAN_FEATURE_META.length}`,
      );
    }
    for (const row of card.features) {
      if (row.included !== included.has(row.key)) {
        problems.push(
          `card "${card.tier}" feature "${row.key}" included=${row.included} ≠ ladder ${included.has(row.key)}`,
        );
      }
    }

    // 5. The trial label is present iff a trial is configured AND the plan is paid.
    const shouldTrial = plan.purchasable && trialDays > 0;
    if (shouldTrial !== (card.trialLabel !== null)) {
      problems.push(
        `card "${card.tier}" trialLabel presence (${card.trialLabel !== null}) ≠ expected ${shouldTrial}`,
      );
    }
  }

  // 6. Exactly one highlighted card (the paid entry plan).
  const highlighted = cards.filter((c) => c.highlighted);
  if (highlighted.length !== 1) {
    problems.push(`expected exactly 1 highlighted card, got ${highlighted.length}`);
  } else if (highlighted[0].tier !== "pro") {
    problems.push(`highlighted card is "${highlighted[0].tier}", expected "pro"`);
  }

  return problems;
}

/** Reconcile the pricing model as resolved from the environment. */
export function reconcilePricingFromEnv(): string[] {
  return reconcilePricing(buildBillingCatalog(null), getTrialDays());
}
