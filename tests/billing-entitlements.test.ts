import { describe, it, expect } from "vitest";
import {
  PLAN_FEATURES,
  PLAN_FEATURE_MATRIX,
  PLAN_FEATURE_META,
  PLAN_TIER_ORDER,
  featureMeta,
  featuresForTier,
  isPlanTier,
  planHasFeature,
  reconcileTierMapping,
  resolveEntitlements,
  resolveTierLimits,
  tierRank,
  type PlanFeature,
} from "@/lib/billing/entitlements";
import { PLAN_RATE_LIMITS, resolveRateLimitPolicy } from "@/lib/rate-limit";
import {
  EXPORT_RATE_LIMITS,
  resolveExportRateLimitPolicy,
} from "@/lib/reviews/export-access";
import {
  READ_RATE_LIMITS,
  resolveReadRateLimitPolicy,
} from "@/lib/reviews/read-access";
import type { PlanTier } from "@/types/db";

/**
 * Plan-tier entitlements (DailyPlan Day 72 — "Tier mapping"). The mapping is the
 * single source of truth for what a tier grants; these tests pin that it drives
 * the SAME limits the routes enforce (no drift), that the feature ladder is
 * monotonic and fails closed, and that the whole map reconciles (the DoD "plan
 * tier drives limits" made executable).
 */

const TIERS: PlanTier[] = ["free", "pro", "enterprise"];

describe("tier ordering + guards", () => {
  it("orders the three known tiers low → high", () => {
    expect(PLAN_TIER_ORDER).toEqual(["free", "pro", "enterprise"]);
    expect(tierRank("free")).toBe(0);
    expect(tierRank("pro")).toBe(1);
    expect(tierRank("enterprise")).toBe(2);
  });

  it("isPlanTier narrows known values and rejects everything else", () => {
    for (const t of TIERS) expect(isPlanTier(t)).toBe(true);
    expect(isPlanTier("gold")).toBe(false);
    expect(isPlanTier("")).toBe(false);
    expect(isPlanTier(null)).toBe(false);
    expect(isPlanTier(undefined)).toBe(false);
    expect(isPlanTier(1)).toBe(false);
  });
});

describe("resolveTierLimits — plan tier drives the SAME limits the routes enforce", () => {
  it("composes the limiters' own policy objects by reference (no drift)", () => {
    for (const tier of TIERS) {
      const limits = resolveTierLimits(tier);
      // Reference equality: the unified view IS the limiter's policy, not a copy.
      expect(limits.review).toBe(PLAN_RATE_LIMITS[tier]);
      expect(limits.export).toBe(EXPORT_RATE_LIMITS[tier]);
      expect(limits.read).toBe(READ_RATE_LIMITS[tier]);
      // ...and equal to what each route's resolver returns.
      expect(limits.review).toBe(resolveRateLimitPolicy(tier));
      expect(limits.export).toBe(resolveExportRateLimitPolicy(tier));
      expect(limits.read).toBe(resolveReadRateLimitPolicy(tier));
    }
  });

  it("fails closed to free for an unknown/missing tier (inherits the resolvers)", () => {
    const unknown = resolveTierLimits("platinum" as unknown as PlanTier);
    expect(unknown.review).toBe(PLAN_RATE_LIMITS.free);
    expect(unknown.export).toBe(EXPORT_RATE_LIMITS.free);
    expect(unknown.read).toBe(READ_RATE_LIMITS.free);
    expect(resolveTierLimits(null).review).toBe(PLAN_RATE_LIMITS.free);
    expect(resolveTierLimits(undefined).read).toBe(READ_RATE_LIMITS.free);
  });

  it("every tier's limits are positive, finite ceilings over a positive window", () => {
    for (const tier of TIERS) {
      const limits = resolveTierLimits(tier);
      for (const policy of [limits.review, limits.export, limits.read]) {
        expect(policy.limit).toBeGreaterThan(0);
        expect(Number.isFinite(policy.limit)).toBe(true);
        expect(policy.windowMs).toBeGreaterThan(0);
      }
    }
  });
});

describe("feature ladder", () => {
  it("every feature has unique, well-formed metadata unlocked by a real tier", () => {
    expect(PLAN_FEATURE_META.map((m) => m.key).sort()).toEqual(
      [...PLAN_FEATURES].sort(),
    );
    const keys = new Set<string>();
    for (const meta of PLAN_FEATURE_META) {
      expect(isPlanTier(meta.unlockedBy), `${meta.key} unlockedBy valid`).toBe(true);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(0);
      expect(keys.has(meta.key)).toBe(false);
      keys.add(meta.key);
    }
    expect(featureMeta("pdf_export")?.unlockedBy).toBe("pro");
    expect(featureMeta("not_a_feature" as PlanFeature)).toBeNull();
  });

  it("derives the documented per-tier feature sets", () => {
    expect([...featuresForTier("free")].sort()).toEqual(
      ["csv_export", "image_ad_review"].sort(),
    );
    expect([...featuresForTier("pro")].sort()).toEqual(
      ["analytics_dashboard", "csv_export", "image_ad_review", "pdf_export"].sort(),
    );
    expect([...featuresForTier("enterprise")].sort()).toEqual(
      [...PLAN_FEATURES].sort(),
    );
  });

  it("PLAN_FEATURE_MATRIX agrees with featuresForTier", () => {
    for (const tier of TIERS) {
      expect([...PLAN_FEATURE_MATRIX[tier]].sort()).toEqual(
        [...featuresForTier(tier)].sort(),
      );
    }
  });

  it("the ladder is monotonic: every lower-tier feature is in the higher tier", () => {
    for (let i = 1; i < TIERS.length; i++) {
      const lower = PLAN_FEATURE_MATRIX[TIERS[i - 1]];
      const higher = PLAN_FEATURE_MATRIX[TIERS[i]];
      for (const feature of lower) {
        expect(higher.has(feature), `${TIERS[i]} has ${feature}`).toBe(true);
      }
    }
  });
});

describe("planHasFeature", () => {
  it("grants a feature at or above its unlock tier", () => {
    expect(planHasFeature("free", "image_ad_review")).toBe(true);
    expect(planHasFeature("free", "csv_export")).toBe(true);
    expect(planHasFeature("free", "pdf_export")).toBe(false);
    expect(planHasFeature("free", "analytics_dashboard")).toBe(false);
    expect(planHasFeature("free", "custom_juror_weights")).toBe(false);

    expect(planHasFeature("pro", "pdf_export")).toBe(true);
    expect(planHasFeature("pro", "analytics_dashboard")).toBe(true);
    expect(planHasFeature("pro", "custom_juror_weights")).toBe(false);
    expect(planHasFeature("pro", "priority_support")).toBe(false);

    expect(planHasFeature("enterprise", "custom_juror_weights")).toBe(true);
    expect(planHasFeature("enterprise", "priority_support")).toBe(true);
  });

  it("fails closed: unknown tier → free's grants, unknown feature → nothing", () => {
    // Unknown tier treated as free.
    expect(planHasFeature("vip" as unknown as PlanTier, "csv_export")).toBe(true);
    expect(planHasFeature("vip" as unknown as PlanTier, "pdf_export")).toBe(false);
    expect(planHasFeature(null, "pdf_export")).toBe(false);
    expect(planHasFeature(undefined, "image_ad_review")).toBe(true);
    // Unknown feature grants nothing even to the top tier.
    expect(planHasFeature("enterprise", "teleport" as PlanFeature)).toBe(false);
  });

  it("agrees with featuresForTier for every tier×feature pair", () => {
    for (const tier of TIERS) {
      const set = featuresForTier(tier);
      for (const feature of PLAN_FEATURES) {
        expect(planHasFeature(tier, feature)).toBe(set.has(feature));
      }
    }
  });
});

describe("resolveEntitlements", () => {
  it("returns the resolved tier, its limits, and its feature set", () => {
    const pro = resolveEntitlements("pro");
    expect(pro.tier).toBe("pro");
    expect(pro.limits.review).toBe(PLAN_RATE_LIMITS.pro);
    expect([...pro.features].sort()).toEqual([...featuresForTier("pro")].sort());
  });

  it("fails closed to free for an unknown/missing tier", () => {
    for (const bad of ["platinum" as unknown as PlanTier, null, undefined]) {
      const ent = resolveEntitlements(bad);
      expect(ent.tier).toBe("free");
      expect(ent.limits.review).toBe(PLAN_RATE_LIMITS.free);
      expect([...ent.features].sort()).toEqual([...featuresForTier("free")].sort());
    }
  });
});

describe("reconcileTierMapping — the DoD, executable", () => {
  it("reports no problems: the map is complete and self-consistent", () => {
    expect(reconcileTierMapping()).toEqual([]);
  });
});
