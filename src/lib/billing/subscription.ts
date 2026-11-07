/**
 * Subscription / entitlement derivation (DailyPlan Day 71 — Stripe scaffold,
 * Week 11). Pure and node-testable: given a company's mirrored Stripe fields
 * (migration 0012) it derives whether the company is *entitled* (may use paid
 * features) and a small, display-ready billing state for the manage-plan UI
 * (Day 76). No Stripe SDK, no network, no DB — the mirrored status on the
 * company row is the source of truth, so entitlement reads cost nothing per
 * request (that mirror is kept fresh by the Stripe webhook, Day 74).
 *
 * The tier→feature/limit mapping (which features a plan unlocks) is Day 72 and
 * deliberately lives elsewhere; this module answers only "is this subscription
 * in a state that grants access", which every tier gate will build on.
 */
import type { CompanyRow, SubscriptionStatus } from "@/types/db";

/** The full Stripe subscription-status vocabulary we mirror (migration 0012). */
export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "unpaid",
  "paused",
];

/**
 * Statuses that grant access to paid features. `active` (paying) and `trialing`
 * (in the free trial) are entitled; everything else — `past_due`, `canceled`,
 * `unpaid`, the `incomplete*` states, `paused` — is not. We fail CLOSED: an
 * unknown/missing status is treated as not entitled (Rules.md §6 — fail closed on
 * anything touching plan access), so a bad mirror never silently grants access.
 */
export const ENTITLED_STATUSES: ReadonlySet<SubscriptionStatus> = new Set<
  SubscriptionStatus
>(["active", "trialing"]);

/** Narrow an arbitrary string to a known subscription status (else null). */
export function parseSubscriptionStatus(
  value: string | null | undefined,
): SubscriptionStatus | null {
  if (!value) return null;
  return (SUBSCRIPTION_STATUSES as readonly string[]).includes(value)
    ? (value as SubscriptionStatus)
    : null;
}

/**
 * Whether a subscription status grants paid access. Fails closed: a null or
 * unrecognized status is not entitled.
 */
export function isEntitled(
  status: SubscriptionStatus | null | undefined,
): boolean {
  return status != null && ENTITLED_STATUSES.has(status);
}

/** The display-ready billing state for a company. */
export interface BillingState {
  /** Mirrored Stripe status, or null when the company has no subscription. */
  status: SubscriptionStatus | null;
  /** Whether the company currently has access to paid features. */
  entitled: boolean;
  /** Whether the company is in its free trial right now. */
  trialing: boolean;
  /** Whether a Stripe customer has ever been created for the company. */
  hasCustomer: boolean;
  /** Whether a subscription record exists (any status). */
  hasSubscription: boolean;
  /** When the trial ends (ISO), or null. */
  trialEndsAt: string | null;
  /** When the current paid period ends (ISO), or null. */
  currentPeriodEnd: string | null;
  /**
   * Whether the trial has elapsed relative to `now` (its end is in the past).
   * Only meaningful while `trialing`; false otherwise. Lets the UI warn "trial
   * ending soon / ended" without a second Stripe call.
   */
  trialExpired: boolean;
}

/**
 * Derive a company's billing state from its mirrored Stripe fields. `now` is
 * injected so the trial-expiry comparison is deterministic and testable. Pure:
 * reads only the row, computes no side effects. A company with no linkage reads
 * as a not-entitled free company (status null, no customer/subscription).
 */
export function deriveBillingState(
  company: Pick<
    CompanyRow,
    | "stripe_customer_id"
    | "stripe_subscription_id"
    | "subscription_status"
    | "trial_ends_at"
    | "current_period_end"
  >,
  now: Date,
): BillingState {
  const status = parseSubscriptionStatus(company.subscription_status ?? null);
  const trialing = status === "trialing";
  const trialEndsAt = company.trial_ends_at ?? null;

  let trialExpired = false;
  if (trialing && trialEndsAt) {
    const endMs = Date.parse(trialEndsAt);
    if (Number.isFinite(endMs)) trialExpired = endMs <= now.getTime();
  }

  return {
    status,
    entitled: isEntitled(status),
    trialing,
    hasCustomer: Boolean(company.stripe_customer_id),
    hasSubscription: Boolean(company.stripe_subscription_id),
    trialEndsAt,
    currentPeriodEnd: company.current_period_end ?? null,
    trialExpired,
  };
}
