/**
 * Plan-tier entitlements — the tier → limits/features map (DailyPlan Day 72 —
 * "Tier mapping": map subscription tiers to rate limits/features. DoD: plan tier
 * drives limits).
 *
 * Day 71 built the Stripe scaffold and deliberately left "which features/limits a
 * plan unlocks" to this day. This module is that single source of truth. It is
 * pure and node-testable (no Stripe SDK, no DB, no network): the `companies`
 * `plan_tier` string is the input and a complete, display-ready `PlanEntitlements`
 * is the output, so what a tier grants is provable offline (mirrors `plans.ts`,
 * which owns the pricing catalog separately).
 *
 * Two things a tier maps to:
 *
 *  1. **Limits.** AdJury already enforces three per-plan rate limits — reviews
 *     (`rate-limit.ts`, per day), exports (`export-access.ts`, per hour), and
 *     reads (`read-access.ts`, per minute). Rather than restate those numbers
 *     here (which would drift — Rules.md §7), `resolveTierLimits` **composes the
 *     very resolvers the routes call**, so the unified "what are this tier's
 *     limits" view and what the limiters actually enforce are provably the same
 *     objects (the reconcile check pins reference-equality). "Plan tier drives
 *     limits" is literally this resolver plus the three limiters it wraps.
 *
 *  2. **Features.** A small, documented capability ladder (`PLAN_FEATURE_META`),
 *     each feature unlocked at a lowest tier (`unlockedBy`). The per-tier feature
 *     set is **derived** from that ladder (a tier has a feature iff its rank ≥ the
 *     feature's `unlockedBy` rank), so the mapping is monotonic by construction —
 *     a higher tier always includes everything a lower one does, with no chance of
 *     a non-monotonic typo — and adding a feature is a one-line declaration.
 *
 * This module owns the *policy* only. **Applying** the feature flags as gates
 * across the app is Day 75 (plan gating), the pricing page is Day 73, and the
 * manage-plan UI is Day 76 — so nothing here changes runtime behaviour today; it
 * is the map those days read. Entitlement to paid features at all (is the
 * subscription in a paying/trialing state) is a separate axis owned by
 * `subscription.ts`; this module answers "what does tier X grant" independent of
 * billing state, exactly as the rate limiters already key off `plan_tier` today.
 */
import {
  PLAN_RATE_LIMITS,
  resolveRateLimitPolicy,
  type RateLimitPolicy,
} from "@/lib/rate-limit";
import {
  EXPORT_RATE_LIMITS,
  resolveExportRateLimitPolicy,
} from "@/lib/reviews/export-access";
import {
  READ_RATE_LIMITS,
  resolveReadRateLimitPolicy,
} from "@/lib/reviews/read-access";
import { buildBillingCatalog } from "@/lib/billing/plans";
import type { PlanTier } from "@/types/db";

/**
 * Plan tiers ordered low → high. The index is a tier's **rank**, used for the
 * monotonic feature ladder and the non-decreasing-allowance invariant. Kept as
 * the single ordering so "higher tier" has one meaning across the module.
 */
export const PLAN_TIER_ORDER: readonly PlanTier[] = ["free", "pro", "enterprise"];

/** A tier's rank (0 = free). Unknown tiers are not ranked (see `isPlanTier`). */
export function tierRank(tier: PlanTier): number {
  return PLAN_TIER_ORDER.indexOf(tier);
}

/** Type guard: is `value` one of the known plan tiers? */
export function isPlanTier(value: unknown): value is PlanTier {
  return typeof value === "string" && (PLAN_TIER_ORDER as readonly string[]).includes(value);
}

/**
 * The feature vocabulary — the gateable capabilities a plan can unlock. Kept
 * deliberately small and grounded in capabilities AdJury actually ships:
 *
 *  - `image_ad_review`      — review an image ad, not just text copy (Day 15a).
 *  - `csv_export`           — export a review / history to CSV (Day 36/37).
 *  - `pdf_export`           — export a branded PDF report (Day 38/39).
 *  - `analytics_dashboard`  — score/verdict trends over time (Day 32–34).
 *  - `custom_juror_weights` — per-company juror weighting (Day 16; PRD v2).
 *  - `priority_support`     — a positioning/support entitlement (no code gate).
 */
export const PLAN_FEATURES = [
  "image_ad_review",
  "csv_export",
  "pdf_export",
  "analytics_dashboard",
  "custom_juror_weights",
  "priority_support",
] as const;

export type PlanFeature = (typeof PLAN_FEATURES)[number];

/** Display + ladder metadata for one feature. */
export interface PlanFeatureMeta {
  key: PlanFeature;
  /** Short human label (pricing page / manage-plan UI — Day 73/76). */
  label: string;
  /** One-line description of what the feature gives the user. */
  description: string;
  /**
   * The LOWEST tier that unlocks this feature. The per-tier feature set is
   * derived from this, so the ladder is monotonic by construction: every tier at
   * or above `unlockedBy` has the feature. Changing a tier's offering is a
   * one-line edit here — this is the mapping Day 73/75/76 read.
   */
  unlockedBy: PlanTier;
}

/**
 * The feature ladder — the single declaration the per-tier matrix is derived
 * from. Ordered for display (pricing page). A conservative, clearly-documented
 * monetization ladder a human reviewer can retune by editing `unlockedBy`:
 *
 *   free        → text + image review, CSV export (the core review loop).
 *   pro    (+)  → branded PDF reports, the analytics dashboard.
 *   enterprise (+) → custom juror weights, priority support.
 */
export const PLAN_FEATURE_META: readonly PlanFeatureMeta[] = [
  {
    key: "image_ad_review",
    label: "Image ad review",
    description: "Submit an image ad creative for review, not just text copy.",
    unlockedBy: "free",
  },
  {
    key: "csv_export",
    label: "CSV export",
    description: "Export a review or your history as a spreadsheet-ready CSV.",
    unlockedBy: "free",
  },
  {
    key: "pdf_export",
    label: "Branded PDF reports",
    description: "Export a review as a polished, on-brand PDF report.",
    unlockedBy: "pro",
  },
  {
    key: "analytics_dashboard",
    label: "Analytics dashboard",
    description: "Track score and verdict trends over time, per juror.",
    unlockedBy: "pro",
  },
  {
    key: "custom_juror_weights",
    label: "Custom juror weights",
    description: "Tune how much each juror counts toward the aggregate score.",
    unlockedBy: "enterprise",
  },
  {
    key: "priority_support",
    label: "Priority support",
    description: "Priority response from the AdJury team.",
    unlockedBy: "enterprise",
  },
] as const;

/** Look up a feature's metadata (or null for an unknown key). */
export function featureMeta(feature: PlanFeature): PlanFeatureMeta | null {
  return PLAN_FEATURE_META.find((m) => m.key === feature) ?? null;
}

/**
 * Whether a tier unlocks a feature: its rank is at or above the feature's
 * `unlockedBy` rank. Fails closed — an unknown tier (not a real `PlanTier`) is
 * treated as `free`, and an unknown feature grants nothing (Rules.md §6).
 */
export function planHasFeature(
  tier: PlanTier | null | undefined,
  feature: PlanFeature,
): boolean {
  const meta = featureMeta(feature);
  if (!meta) return false;
  const resolved: PlanTier = isPlanTier(tier) ? tier : "free";
  return tierRank(resolved) >= tierRank(meta.unlockedBy);
}

/** The ordered set of features a tier unlocks (derived from the ladder). */
export function featuresForTier(tier: PlanTier): ReadonlySet<PlanFeature> {
  return new Set(
    PLAN_FEATURE_META.filter((m) => tierRank(tier) >= tierRank(m.unlockedBy)).map(
      (m) => m.key,
    ),
  );
}

/**
 * The per-tier feature matrix, derived once from the ladder. A convenience view
 * for display (Day 73/76); `planHasFeature` is the cheaper check for a gate.
 */
export const PLAN_FEATURE_MATRIX: Record<PlanTier, ReadonlySet<PlanFeature>> = {
  free: featuresForTier("free"),
  pro: featuresForTier("pro"),
  enterprise: featuresForTier("enterprise"),
};

/**
 * The three per-plan limits a tier drives, in one place. Each is the SAME policy
 * object the corresponding limiter resolves, so this unified view can never drift
 * from what the routes enforce (the reconcile check pins reference-equality).
 */
export interface TierLimits {
  /** Reviews per rolling day (`rate-limit.ts`). */
  review: RateLimitPolicy;
  /** Exports per rolling hour (`export-access.ts`). */
  export: RateLimitPolicy;
  /** Read API calls per rolling minute (`read-access.ts`). */
  read: RateLimitPolicy;
}

/**
 * Resolve a tier's limits by composing the limiters' own resolvers — each fails
 * closed to `free` for an unknown/missing tier, so this inherits that posture.
 */
export function resolveTierLimits(
  tier: PlanTier | null | undefined,
): TierLimits {
  return {
    review: resolveRateLimitPolicy(tier),
    export: resolveExportRateLimitPolicy(tier),
    read: resolveReadRateLimitPolicy(tier),
  };
}

/** A tier's complete, resolved entitlements: its limits and its feature set. */
export interface PlanEntitlements {
  /** The resolved tier (`free` when the input was unknown — fail closed). */
  tier: PlanTier;
  /** The three per-plan rate limits this tier drives. */
  limits: TierLimits;
  /** The features this tier unlocks. */
  features: ReadonlySet<PlanFeature>;
}

/**
 * Resolve everything a plan tier grants. Fails closed: an unknown/missing tier
 * resolves to `free` (the most restrictive), so a bad `plan_tier` never widens
 * access (Rules.md §6) — the same posture the rate limiters already take.
 */
export function resolveEntitlements(
  tier: PlanTier | null | undefined,
): PlanEntitlements {
  const resolved: PlanTier = isPlanTier(tier) ? tier : "free";
  return {
    tier: resolved,
    limits: resolveTierLimits(resolved),
    features: featuresForTier(resolved),
  };
}

/**
 * Reconcile the tier mapping — a pure drift guard proving the map is complete and
 * self-consistent (the Day 43–70 "inventory + drift guard" pattern, applied to
 * data rather than source text). Returns a list of problems; empty means clean.
 * This is the executable form of the DoD: every tier is covered everywhere, the
 * unified limits ARE the limiters' own, allowances rise with tier, and the
 * feature ladder is monotonic. TypeScript's `Record<PlanTier, …>` already forces
 * every tier into each table at compile time; this adds the value-level checks a
 * type can't make.
 */
export function reconcileTierMapping(): string[] {
  const problems: string[] = [];

  // 1. The billing catalog (Day 71) covers exactly the known tiers, keyed right.
  const catalog = buildBillingCatalog(null);
  for (const tier of PLAN_TIER_ORDER) {
    const plan = catalog[tier];
    if (!plan) {
      problems.push(`billing catalog missing tier "${tier}"`);
    } else if (plan.key !== tier) {
      problems.push(`billing catalog tier "${tier}" has mismatched key "${plan.key}"`);
    }
  }

  // 2. The unified limits ARE the limiters' own policy objects (no drift).
  for (const tier of PLAN_TIER_ORDER) {
    const limits = resolveTierLimits(tier);
    if (limits.review !== PLAN_RATE_LIMITS[tier]) {
      problems.push(`review limit for "${tier}" is not the PLAN_RATE_LIMITS policy`);
    }
    if (limits.export !== EXPORT_RATE_LIMITS[tier]) {
      problems.push(`export limit for "${tier}" is not the EXPORT_RATE_LIMITS policy`);
    }
    if (limits.read !== READ_RATE_LIMITS[tier]) {
      problems.push(`read limit for "${tier}" is not the READ_RATE_LIMITS policy`);
    }
    // Every limit must be a positive, finite ceiling (never 0/unlimited).
    for (const [kind, policy] of [
      ["review", limits.review],
      ["export", limits.export],
      ["read", limits.read],
    ] as const) {
      if (!(policy.limit > 0) || !Number.isFinite(policy.limit)) {
        problems.push(`${kind} limit for "${tier}" is not a positive finite number`);
      }
      if (!(policy.windowMs > 0)) {
        problems.push(`${kind} window for "${tier}" is not positive`);
      }
    }
  }

  // 3. Allowances are non-decreasing with tier (a higher tier never gets less).
  for (let i = 1; i < PLAN_TIER_ORDER.length; i++) {
    const lower = PLAN_TIER_ORDER[i - 1];
    const higher = PLAN_TIER_ORDER[i];
    const lo = resolveTierLimits(lower);
    const hi = resolveTierLimits(higher);
    for (const kind of ["review", "export", "read"] as const) {
      if (hi[kind].limit < lo[kind].limit) {
        problems.push(
          `${kind} limit regresses: "${higher}" (${hi[kind].limit}) < "${lower}" (${lo[kind].limit})`,
        );
      }
    }
  }

  // 4. Every feature's `unlockedBy` is a real tier; keys are unique.
  const seen = new Set<string>();
  for (const meta of PLAN_FEATURE_META) {
    if (!isPlanTier(meta.unlockedBy)) {
      problems.push(`feature "${meta.key}" unlockedBy unknown tier "${meta.unlockedBy}"`);
    }
    if (seen.has(meta.key)) problems.push(`duplicate feature key "${meta.key}"`);
    seen.add(meta.key);
  }
  for (const key of PLAN_FEATURES) {
    if (!seen.has(key)) problems.push(`feature "${key}" has no metadata entry`);
  }

  // 5. The feature ladder is monotonic: free ⊆ pro ⊆ enterprise.
  for (let i = 1; i < PLAN_TIER_ORDER.length; i++) {
    const lower = PLAN_FEATURE_MATRIX[PLAN_TIER_ORDER[i - 1]];
    const higher = PLAN_FEATURE_MATRIX[PLAN_TIER_ORDER[i]];
    for (const feature of lower) {
      if (!higher.has(feature)) {
        problems.push(
          `feature ladder non-monotonic: "${PLAN_TIER_ORDER[i]}" is missing "${feature}" that a lower tier has`,
        );
      }
    }
  }

  return problems;
}
