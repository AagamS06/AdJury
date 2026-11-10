import { describe, it, expect } from "vitest";
import {
  PRICING_INTRO,
  pricingNotes,
  buildPricingCards,
  getPricingCards,
  reviewLimitLabel,
  pricingCtaFor,
  reconcilePricing,
  reconcilePricingFromEnv,
  type PricingCta,
} from "@/lib/marketing/pricing";
import {
  buildBillingCatalog,
  formatPlanPriceWithInterval,
  ENTRY_PLAN_AMOUNT_CENTS,
  type BillingPlan,
} from "@/lib/billing/plans";
import {
  PLAN_TIER_ORDER,
  PLAN_FEATURE_META,
  featuresForTier,
} from "@/lib/billing/entitlements";
import { PLAN_RATE_LIMITS } from "@/lib/rate-limit";
import type { PlanTier } from "@/types/db";

/**
 * Pricing-page content model (DailyPlan Day 73 — "Pricing page reflecting the
 * tiers"; DoD: pricing renders and matches config). The thin server component
 * (`components/marketing/pricing-table.tsx`) and the page (`app/pricing/page.tsx`)
 * only render these pure values, so the DoD is proved here: every card is derived
 * from the billing cores (catalog, rate limiters, feature ladder) — it cannot
 * state a price, limit, or feature the config doesn't.
 *
 * A fixed catalog (entry price id injected) + a chosen trial length make the model
 * deterministic without env; the final block proves the ENV-resolved page is clean
 * too (the executable DoD).
 */

/** A real catalog with a configured entry price id (so the pro plan is "full"). */
const CATALOG = buildBillingCatalog("price_test_123");
const TRIAL_DAYS = 30;

/** Routes that actually exist under `src/app` — a CTA must never dangle. */
const REAL_ROUTES = new Set(["/signup", "/dashboard"]);

describe("PRICING_INTRO", () => {
  it("has non-empty eyebrow / heading / intro copy", () => {
    expect(PRICING_INTRO.eyebrow.trim().length).toBeGreaterThan(0);
    expect(PRICING_INTRO.heading.trim().length).toBeGreaterThan(0);
    expect(PRICING_INTRO.intro.trim().length).toBeGreaterThan(0);
  });
});

describe("pricingNotes", () => {
  it("always states AUD + cancel-anytime, in plain language", () => {
    const notes = pricingNotes(30).join(" ").toLowerCase();
    expect(notes).toContain("aud");
    expect(notes).toContain("cancel anytime");
  });

  it("mentions the trial only when a trial is configured", () => {
    expect(pricingNotes(30).join(" ")).toContain("30-day free trial");
    const noTrial = pricingNotes(0).join(" ");
    expect(noTrial.toLowerCase()).not.toContain("free trial");
  });
});

describe("reviewLimitLabel", () => {
  it("groups thousands and names the rolling-day unit", () => {
    expect(reviewLimitLabel(10)).toBe("10 reviews / day");
    expect(reviewLimitLabel(1000)).toBe("1,000 reviews / day");
  });
});

describe("buildPricingCards — shape and ordering", () => {
  const cards = buildPricingCards(CATALOG, TRIAL_DAYS);

  it("renders exactly one card per tier, in PLAN_TIER_ORDER", () => {
    expect(cards.map((c) => c.tier)).toEqual([...PLAN_TIER_ORDER]);
  });

  it("features exactly one plan — the paid entry plan (pro)", () => {
    const highlighted = cards.filter((c) => c.highlighted);
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0].tier).toBe("pro");
  });
});

describe("buildPricingCards — matches config (the DoD)", () => {
  const cards = buildPricingCards(CATALOG, TRIAL_DAYS);
  const byTier = new Map(cards.map((c) => [c.tier, c] as const));

  it("every card's price + name + tagline come from the billing catalog", () => {
    for (const tier of PLAN_TIER_ORDER) {
      const card = byTier.get(tier)!;
      const plan = CATALOG[tier];
      expect(card.name).toBe(plan.name);
      expect(card.tagline).toBe(plan.tagline);
      expect(card.amountCents).toBe(plan.amountCents);
      expect(card.priceLabel).toBe(formatPlanPriceWithInterval(plan));
    }
  });

  it("the entry (pro) plan shows AUD $20.00 / month", () => {
    const pro = byTier.get("pro")!;
    expect(pro.amountCents).toBe(ENTRY_PLAN_AMOUNT_CENTS);
    expect(pro.priceLabel).toBe("A$20.00 / month");
  });

  it("free is 'Free' and enterprise is 'Custom'", () => {
    expect(byTier.get("free")!.priceLabel).toBe("Free");
    expect(byTier.get("enterprise")!.priceLabel).toBe("Custom");
  });

  it("every card's review allowance IS the rate-limit policy's number", () => {
    for (const tier of PLAN_TIER_ORDER) {
      const card = byTier.get(tier)!;
      expect(card.reviewLimit).toBe(PLAN_RATE_LIMITS[tier].limit);
      expect(card.limitLabel).toBe(reviewLimitLabel(PLAN_RATE_LIMITS[tier].limit));
    }
  });

  it("every card lists the full feature ladder with the tier's included flags", () => {
    for (const tier of PLAN_TIER_ORDER) {
      const card = byTier.get(tier)!;
      // Full coverage — one row per ladder feature, in ladder order.
      expect(card.features.map((f) => f.key)).toEqual(
        PLAN_FEATURE_META.map((m) => m.key),
      );
      const included = featuresForTier(tier);
      for (const row of card.features) {
        expect(row.included).toBe(included.has(row.key));
        expect(row.label.trim().length).toBeGreaterThan(0);
        expect(row.description.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("feature inclusion is monotonic across the displayed cards (free ⊆ pro ⊆ enterprise)", () => {
    const includedKeys = (tier: PlanTier) =>
      new Set(byTier.get(tier)!.features.filter((f) => f.included).map((f) => f.key));
    const free = includedKeys("free");
    const pro = includedKeys("pro");
    const ent = includedKeys("enterprise");
    for (const k of free) expect(pro.has(k)).toBe(true);
    for (const k of pro) expect(ent.has(k)).toBe(true);
  });
});

describe("buildPricingCards — trial label", () => {
  it("advertises the trial only on the purchasable plan, only when one is on", () => {
    const withTrial = buildPricingCards(CATALOG, 30);
    const byTier = new Map(withTrial.map((c) => [c.tier, c] as const));
    expect(byTier.get("pro")!.trialLabel).toBe("Includes a 30-day free trial");
    expect(byTier.get("free")!.trialLabel).toBeNull();
    expect(byTier.get("enterprise")!.trialLabel).toBeNull();

    const noTrial = buildPricingCards(CATALOG, 0);
    for (const card of noTrial) expect(card.trialLabel).toBeNull();
  });
});

describe("pricingCtaFor — session-aware, no dangles", () => {
  function linkPrimaries(isAuth: boolean): PricingCta[] {
    return PLAN_TIER_ORDER.map((t) => pricingCtaFor(t, isAuth)).filter(
      (c): c is Extract<PricingCta, { kind: "link" }> =>
        c.kind === "link" && c.variant === "primary",
    );
  }

  it("marks enterprise as an inert 'contact sales' (both auth states)", () => {
    for (const isAuth of [false, true]) {
      const cta = pricingCtaFor("enterprise", isAuth);
      expect(cta.kind).toBe("inert");
      expect(cta.label.toLowerCase()).toContain("contact");
    }
  });

  it("has exactly one primary CTA per auth state — the paid pro plan", () => {
    for (const isAuth of [false, true]) {
      const primaries = linkPrimaries(isAuth);
      expect(primaries).toHaveLength(1);
      expect(primaries[0].key).toBe("pro");
    }
  });

  it("routes signed-out visitors to sign-up and signed-in users to the dashboard", () => {
    for (const tier of ["free", "pro"] as const) {
      const out = pricingCtaFor(tier, false);
      const inn = pricingCtaFor(tier, true);
      expect(out.kind).toBe("link");
      expect(inn.kind).toBe("link");
      if (out.kind === "link") expect(out.href).toBe("/signup");
      if (inn.kind === "link") expect(inn.href).toBe("/dashboard");
    }
  });

  it("every link CTA points at a real route (no dangles)", () => {
    for (const isAuth of [false, true]) {
      for (const tier of PLAN_TIER_ORDER) {
        const cta = pricingCtaFor(tier, isAuth);
        if (cta.kind === "link") {
          expect(cta.href.startsWith("/")).toBe(true);
          expect(REAL_ROUTES.has(cta.href)).toBe(true);
        }
      }
    }
  });
});

describe("reconcilePricing — drift guard", () => {
  it("is clean for a well-formed catalog + trial", () => {
    expect(reconcilePricing(CATALOG, TRIAL_DAYS)).toEqual([]);
    expect(reconcilePricing(CATALOG, 0)).toEqual([]);
  });

  it("is non-vacuous — it reports problems for a malformed catalog", () => {
    // A catalog whose `pro` entry is mis-keyed as "free" (a real inconsistency a
    // type can't catch): reconcile must notice via the per-card catalog checks.
    const broken: Record<PlanTier, BillingPlan> = {
      ...CATALOG,
      pro: { ...CATALOG.pro, key: "free" as PlanTier, name: "Wrong" },
    };
    const problems = reconcilePricing(broken, TRIAL_DAYS);
    expect(problems.length).toBeGreaterThan(0);
  });

  it("is clean as resolved from the environment (the executable DoD)", () => {
    expect(reconcilePricingFromEnv()).toEqual([]);
  });
});

describe("getPricingCards — env-resolved", () => {
  it("returns a card per tier with a rendered pro price", () => {
    const cards = getPricingCards();
    expect(cards.map((c) => c.tier)).toEqual([...PLAN_TIER_ORDER]);
    const pro = cards.find((c) => c.tier === "pro")!;
    // Price is config-sourced regardless of whether a Stripe price id is set.
    expect(pro.priceLabel).toBe("A$20.00 / month");
  });
});
