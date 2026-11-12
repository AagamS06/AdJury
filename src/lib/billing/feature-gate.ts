/**
 * Plan feature gating — the app-wide gate that makes a plan's feature flags
 * actually bind (DailyPlan Day 75 — "Plan gating": feature flags per tier across
 * the app. DoD: gated features respect the plan).
 *
 * Day 72 built the tier → feature map (`entitlements.ts`) and deliberately left
 * *applying* those flags as gates to this day. This module is the single place a
 * route, page, or UI asks "may this plan use feature X?" and gets back both a
 * yes/no and, on a no, a ready-to-serve HTTP status and a plain-language upgrade
 * message. It is pure and node-testable (no DB, no network, no Stripe): the
 * `companies.plan_tier` string plus a `PlanFeature` are the inputs.
 *
 * It is a thin, opinionated wrapper over `planHasFeature` so that:
 *  1. **Every gate fails closed the same way.** The decision is `planHasFeature`
 *     (unknown/missing tier ⇒ treated as `free`; unknown feature ⇒ denied —
 *     Rules.md §6), so a bad `plan_tier` never widens access.
 *  2. **Every gate speaks the same language.** The upgrade copy names the feature
 *     and the plan that unlocks it, derived from the feature ladder and the
 *     billing catalog (so the plan *name* can't drift from the pricing page —
 *     Rules.md §7), in the constructive Design.md §7 voice.
 *  3. **Server routes get a consistent status.** A gate denial is HTTP **402
 *     Payment Required** — semantically "a paid plan is required", distinct from
 *     401 (not signed in), 403 (authenticated but not your resource / not an
 *     admin), and 429 (rate limited). A route returns `{ error }` with this
 *     status; the client surfaces the message.
 *
 * Enforcement is always server-side (mirrors the Rules.md §5 rule for admin
 * actions: enforce on the server, not just hide in the UI). Hiding a gated
 * control in the UI is an *affordance*, never the gate — the route/page re-checks.
 */
import { buildBillingCatalog } from "@/lib/billing/plans";
import {
  featureMeta,
  planHasFeature,
  type PlanFeature,
} from "@/lib/billing/entitlements";
import type { PlanTier } from "@/types/db";

/**
 * HTTP status a server route returns when a plan-gated feature is denied: 402
 * Payment Required. Chosen so plan gating reads distinctly from the auth (401),
 * authz (403), and rate-limit (429) denials the API already uses.
 */
export const FEATURE_GATE_STATUS = 402 as const;

/** The outcome of a feature-gate check. */
export type FeatureGateResult =
  | { ok: true }
  | {
      ok: false;
      status: typeof FEATURE_GATE_STATUS;
      /** The feature that was denied. */
      feature: PlanFeature;
      /** The lowest plan tier that unlocks the feature (the upgrade target). */
      requiredTier: PlanTier;
      /** Plain-language, actionable upgrade message (Rules.md §6). */
      error: string;
    };

/**
 * A plan tier's display name, taken from the billing catalog so the gate copy and
 * the pricing page share one source for plan names (no drift — Rules.md §7). The
 * catalog is built with a null price id since only the *name* is needed here.
 */
export function planTierLabel(tier: PlanTier): string {
  return buildBillingCatalog(null)[tier].name;
}

/**
 * The upgrade message for a gated feature: names the feature and the plan that
 * unlocks it, in the constructive Design.md §7 voice (state the capability, then
 * the path to it). Falls back to a generic line for an unknown feature key
 * (which the type system already prevents, but fail safe anyway).
 */
export function featureGateMessage(feature: PlanFeature): string {
  const meta = featureMeta(feature);
  if (!meta) {
    return "That feature isn't available on your current plan.";
  }
  return `${meta.label} is available on the ${planTierLabel(meta.unlockedBy)} plan. Upgrade to unlock it.`;
}

/**
 * Decide whether a plan tier may use a feature. The single gate every surface
 * calls. Returns `{ ok: true }` when entitled, or a denial carrying the 402
 * status, the feature, the upgrade-target tier, and the upgrade message. Fails
 * closed via `planHasFeature` (unknown tier ⇒ free; unknown feature ⇒ denied).
 */
export function checkFeatureAccess(
  tier: PlanTier | null | undefined,
  feature: PlanFeature,
): FeatureGateResult {
  if (planHasFeature(tier, feature)) return { ok: true };
  const meta = featureMeta(feature);
  return {
    ok: false,
    status: FEATURE_GATE_STATUS,
    feature,
    // Unknown feature has no ladder entry; fail closed to the most restrictive
    // tier so the message never implies a lower plan would unlock it.
    requiredTier: meta?.unlockedBy ?? "enterprise",
    error: featureGateMessage(feature),
  };
}

/**
 * Convenience boolean for a UI affordance (hide/disable a gated control). Same
 * fail-closed decision as `checkFeatureAccess`; use the full check when you need
 * the status/message (e.g. a server route). This is only ever an affordance —
 * the server still re-checks (Rules.md §5).
 */
export function canUseFeature(
  tier: PlanTier | null | undefined,
  feature: PlanFeature,
): boolean {
  return planHasFeature(tier, feature);
}
