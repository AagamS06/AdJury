import { describe, it, expect } from "vitest";
import {
  FEATURE_GATE_STATUS,
  canUseFeature,
  checkFeatureAccess,
  featureGateMessage,
  planTierLabel,
} from "@/lib/billing/feature-gate";
import {
  PLAN_FEATURES,
  PLAN_TIER_ORDER,
  featureMeta,
  featuresForTier,
  planHasFeature,
  type PlanFeature,
} from "@/lib/billing/entitlements";
import { buildBillingCatalog } from "@/lib/billing/plans";
import type { PlanTier } from "@/types/db";

/**
 * Plan feature gating (DailyPlan Day 75 — "Plan gating": feature flags per tier
 * across the app. DoD: gated features respect the plan). This suite pins the
 * single gate every surface calls: that it mirrors the entitlement ladder
 * exactly, fails closed on a bad/missing tier, carries the 402 status + an
 * upgrade message naming the right plan, and never drifts from the billing
 * catalog's plan names or the feature ladder.
 */

const TIERS: PlanTier[] = ["free", "pro", "enterprise"];

describe("planTierLabel", () => {
  it("returns the billing catalog's display name for each tier (no drift)", () => {
    const catalog = buildBillingCatalog(null);
    for (const tier of TIERS) {
      expect(planTierLabel(tier)).toBe(catalog[tier].name);
    }
    expect(planTierLabel("pro")).toBe("Pro");
  });
});

describe("checkFeatureAccess", () => {
  it("allows exactly the features the entitlement ladder grants a tier", () => {
    for (const tier of TIERS) {
      const granted = featuresForTier(tier);
      for (const feature of PLAN_FEATURES) {
        const result = checkFeatureAccess(tier, feature);
        expect(result.ok).toBe(granted.has(feature));
        // Agreement with the underlying predicate the whole app shares.
        expect(result.ok).toBe(planHasFeature(tier, feature));
      }
    }
  });

  it("denies with the 402 status, the feature, and the upgrade-target tier", () => {
    // free lacks pdf_export (unlocked at pro).
    const result = checkFeatureAccess("free", "pdf_export");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a denial");
    expect(result.status).toBe(FEATURE_GATE_STATUS);
    expect(FEATURE_GATE_STATUS).toBe(402);
    expect(result.feature).toBe("pdf_export");
    expect(result.requiredTier).toBe("pro");
    expect(result.error).toBe(featureGateMessage("pdf_export"));
  });

  it("the upgrade-target tier is the feature's ladder unlock tier", () => {
    for (const feature of PLAN_FEATURES) {
      const meta = featureMeta(feature);
      // Check against the lowest tier that does NOT have the feature, if any.
      const lacking = TIERS.find((t) => !planHasFeature(t, feature));
      if (!lacking) continue; // a free feature is never denied
      const result = checkFeatureAccess(lacking, feature);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected a denial");
      expect(result.requiredTier).toBe(meta?.unlockedBy);
    }
  });

  it("fails closed for an unknown/missing tier (treated as free)", () => {
    // analytics_dashboard is a pro feature, so free/unknown are denied.
    for (const tier of [null, undefined, "legacy" as PlanTier]) {
      const result = checkFeatureAccess(tier, "analytics_dashboard");
      expect(result.ok).toBe(false);
    }
    // ...but a free feature is still allowed for an unknown tier (fail closed to
    // free, which does grant it) — the gate never under-grants free's own set.
    expect(checkFeatureAccess("legacy" as PlanTier, "csv_export").ok).toBe(true);
  });

  it("fails closed for an unknown feature key (denied, most-restrictive target)", () => {
    const result = checkFeatureAccess("enterprise", "teleport" as PlanFeature);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a denial");
    expect(result.requiredTier).toBe("enterprise");
  });
});

describe("canUseFeature", () => {
  it("is the boolean form of the gate and agrees with planHasFeature", () => {
    for (const tier of TIERS) {
      for (const feature of PLAN_FEATURES) {
        expect(canUseFeature(tier, feature)).toBe(planHasFeature(tier, feature));
        expect(canUseFeature(tier, feature)).toBe(
          checkFeatureAccess(tier, feature).ok,
        );
      }
    }
  });
});

describe("featureGateMessage", () => {
  it("names the feature label and the plan that unlocks it", () => {
    const msg = featureGateMessage("pdf_export");
    const meta = featureMeta("pdf_export");
    expect(msg).toContain(meta!.label); // "Branded PDF reports"
    expect(msg).toContain(planTierLabel("pro")); // "Pro"
    expect(msg.toLowerCase()).toContain("upgrade");
  });

  it("is non-empty for every real feature", () => {
    for (const feature of PLAN_FEATURES) {
      expect(featureGateMessage(feature).trim()).not.toBe("");
    }
  });

  it("falls back to a generic line for an unknown feature key", () => {
    const msg = featureGateMessage("teleport" as PlanFeature);
    expect(msg.trim()).not.toBe("");
    expect(msg.toLowerCase()).toContain("plan");
  });
});

describe("gate ↔ ladder consistency (monotonic across tiers)", () => {
  it("a feature allowed at a tier is allowed at every higher tier", () => {
    for (const feature of PLAN_FEATURES) {
      let seenAllowed = false;
      for (const tier of PLAN_TIER_ORDER) {
        const allowed = checkFeatureAccess(tier, feature).ok;
        if (allowed) seenAllowed = true;
        // Once allowed at a lower tier, it must stay allowed higher up.
        if (seenAllowed) expect(allowed).toBe(true);
      }
    }
  });
});
