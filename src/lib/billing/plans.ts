/**
 * Billing plan catalog + pricing config (DailyPlan Day 71 — Stripe scaffold,
 * Week 11). Pure and node-testable: this module owns the *policy* (which plans
 * exist, their price, the trial length) with no Stripe SDK and no network, so
 * the pricing model is provable offline (mirrors `rate-limit.ts`, which owns the
 * rate-limit policy separately from any DB/HTTP).
 *
 * The monetization target (PRD §6.3 / DailyPlan Week 11): an entry plan at
 * **AUD $20/month**, a public free trial, cancel anytime. The trial length is a
 * *config value* (`STRIPE_TRIAL_DAYS`) applied as a Stripe trial period at
 * checkout, so the undecided "general 3-month promo vs 1-month one-per-business"
 * choice is a setting, not a code or schema change (Day 74 wires checkout).
 *
 * Products/prices live in Stripe (test mode); this catalog references a price by
 * id, resolved from env (`STRIPE_PRICE_ENTRY_MONTHLY`) so the same code points at
 * a developer's own test-mode price without a secret in the repo. Amounts are
 * carried here too (for display) as the source of truth the Stripe price must
 * match — never a second place charges are computed.
 */
import type { PlanTier } from "@/types/db";

function env(key: string, fallback = ""): string {
  return process.env[key]?.trim() || fallback;
}

/** Billing interval. Only monthly is offered in the scaffold (PRD AUD $20/mo). */
export type BillingInterval = "month";

/**
 * A plan in the catalog. `amountCents`/`currency` describe the price for display
 * and must match the Stripe price `priceId` points at. `priceId` is null for a
 * plan with no self-serve Stripe price: `free` (no charge) and `enterprise`
 * (custom/contact-sales), so only the paid entry plan carries a price.
 */
export interface BillingPlan {
  /** The plan tier this maps to (the `companies.plan_tier` value). */
  key: PlanTier;
  /** Display name. */
  name: string;
  /** One-line positioning for the pricing page (Day 73). */
  tagline: string;
  /** Price in the smallest currency unit (cents); 0 for free, null for custom. */
  amountCents: number | null;
  /** ISO-4217 currency, lower-case to match Stripe's convention. */
  currency: "aud";
  /** Billing interval, or null for a plan with no recurring charge. */
  interval: BillingInterval | null;
  /**
   * The Stripe Price id (`price_…`) this plan checks out against, or null for a
   * plan with no self-serve price. Resolved from env at build time (see
   * `getBillingCatalog`); a paid plan with no configured price id is still listed
   * (so the pricing page renders) but is not checkout-ready — `isCheckoutReady`.
   */
  priceId: string | null;
  /** Whether this plan is purchased via Stripe Checkout (the paid entry plan). */
  purchasable: boolean;
}

/** The entry plan's price: AUD $20.00 / month (PRD §6.3). The one paid plan. */
export const ENTRY_PLAN_AMOUNT_CENTS = 2000;
export const BILLING_CURRENCY = "aud" as const;

/** Default trial length (days) when `STRIPE_TRIAL_DAYS` is unset. */
export const DEFAULT_TRIAL_DAYS = 30;
/**
 * Bounds on the configured trial so a typo can't create a decade-long free
 * window that runs up model cost (Rules.md §1 — cost discipline). 0 disables the
 * trial; 90 covers the longest advertised option (the 3-month promo).
 */
export const MIN_TRIAL_DAYS = 0;
export const MAX_TRIAL_DAYS = 90;

/**
 * Resolve the configured trial length in days from `STRIPE_TRIAL_DAYS`, clamped
 * to `[MIN_TRIAL_DAYS, MAX_TRIAL_DAYS]` and defaulting to `DEFAULT_TRIAL_DAYS`
 * when unset or non-numeric. Pure given its input so the clamp is testable; the
 * env read is isolated here. This single value is what checkout passes to Stripe
 * as the trial period, so the monetization choice stays a one-line config edit.
 */
export function resolveTrialDays(raw: string | undefined | null): number {
  const trimmed = (raw ?? "").trim();
  // Blank/unset ⇒ the default. (Guard explicitly: `Number("")` is 0, not NaN,
  // so an empty env var would otherwise read as "trial disabled".)
  if (trimmed === "") return DEFAULT_TRIAL_DAYS;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return DEFAULT_TRIAL_DAYS;
  const whole = Math.floor(n);
  return Math.min(MAX_TRIAL_DAYS, Math.max(MIN_TRIAL_DAYS, whole));
}

/** The configured trial length (days), read from the environment. */
export function getTrialDays(): number {
  return resolveTrialDays(env("STRIPE_TRIAL_DAYS"));
}

/**
 * Build the plan catalog, injecting the entry plan's Stripe price id from env
 * (or an explicit override, for tests). Free and enterprise carry no price id by
 * design. Pure given `entryPriceId` so the catalog shape is testable without env.
 */
export function buildBillingCatalog(
  entryPriceId: string | null,
): Record<PlanTier, BillingPlan> {
  return {
    free: {
      key: "free",
      name: "Free",
      tagline: "Try AdJury with a low monthly review limit.",
      amountCents: 0,
      currency: BILLING_CURRENCY,
      interval: null,
      priceId: null,
      purchasable: false,
    },
    pro: {
      key: "pro",
      name: "Pro",
      tagline: "For marketing teams shipping content every week.",
      amountCents: ENTRY_PLAN_AMOUNT_CENTS,
      currency: BILLING_CURRENCY,
      interval: "month",
      priceId: entryPriceId,
      purchasable: true,
    },
    enterprise: {
      key: "enterprise",
      name: "Enterprise",
      tagline: "Custom limits and controls for larger organizations.",
      amountCents: null,
      currency: BILLING_CURRENCY,
      interval: null,
      priceId: null,
      purchasable: false,
    },
  };
}

/** The plan catalog resolved from the environment. */
export function getBillingCatalog(): Record<PlanTier, BillingPlan> {
  return buildBillingCatalog(env("STRIPE_PRICE_ENTRY_MONTHLY") || null);
}

/** The paid entry plan (`pro`) from a catalog. */
export function entryPlan(
  catalog: Record<PlanTier, BillingPlan>,
): BillingPlan {
  return catalog.pro;
}

/**
 * Whether a plan can actually be checked out: it is purchasable AND has a Stripe
 * price id configured. A purchasable plan with no configured price id renders on
 * the pricing page but its CTA is disabled until the deployer sets the env — the
 * scaffold never sends a half-configured plan to Stripe.
 */
export function isCheckoutReady(plan: BillingPlan): boolean {
  return plan.purchasable && typeof plan.priceId === "string" && plan.priceId.length > 0;
}

/**
 * Format a plan's price for display, e.g. `A$20.00`, `Free`, or `Custom`. Uses a
 * fixed `A$` prefix (AUD) and two decimals; kept dependency-free and locale-fixed
 * so the pricing page renders identically everywhere (no `Intl` surprises in SSR
 * vs. client). The interval, if any, is the caller's to append.
 */
export function formatPlanPrice(plan: BillingPlan): string {
  if (plan.amountCents === null) return "Custom";
  if (plan.amountCents === 0) return "Free";
  const dollars = (plan.amountCents / 100).toFixed(2);
  return `A$${dollars}`;
}

/**
 * Format a plan's price with its interval, e.g. `A$20.00 / month`. For a plan
 * with no interval (free/enterprise) it returns the bare price label.
 */
export function formatPlanPriceWithInterval(plan: BillingPlan): string {
  const price = formatPlanPrice(plan);
  return plan.interval ? `${price} / ${plan.interval}` : price;
}
