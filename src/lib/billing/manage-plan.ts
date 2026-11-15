/**
 * Manage-plan view model (DailyPlan Day 76 — Billing settings, Week 11:
 * "Manage-plan UI (test mode). DoD: user can view/change plan (test)").
 *
 * Pure and node-testable, continuing the Week 9–11 "pure core + thin component"
 * pattern (cf. `lib/marketing/pricing.ts`, `lib/ui/nav.ts`): this module turns a
 * company's mirrored billing fields (migration 0012) plus the plan catalog
 * (Day 71) and the trial config into a display-ready view model for the
 * manage-plan panel on `/settings`. It owns no I/O — no Stripe call, no DB, no
 * network — so what the panel shows is provable offline.
 *
 * The subscription status mirror (`deriveBillingState`, Day 71) is the source of
 * truth for "is this company entitled", and the catalog (`plans.ts`) is the
 * single source for plan name/price (so the panel can never drift from the
 * pricing page — Rules.md §7). Starting a (test-mode) subscription is the
 * `POST /api/billing/checkout` flow (Day 74); this module decides when to offer
 * that upgrade and with what copy, in the constructive Design.md §7 voice.
 */
import type { CompanyRow, PlanTier } from "@/types/db";
import {
  formatPlanPriceWithInterval,
  isCheckoutReady,
  type BillingPlan,
} from "./plans";
import { deriveBillingState, type BillingState } from "./subscription";

/** Visual tone for the status line (paired with the text label — never colour alone). */
export type ManagePlanTone = "neutral" | "success" | "warning" | "danger";

/** The display-ready manage-plan view model. Plain data so a server component can
 * compute it and hand it to the client island as a serializable prop. */
export interface ManagePlanView {
  /** The company's current effective plan tier (`companies.plan_tier`). */
  planTier: PlanTier;
  /** Current plan display name (from the catalog). */
  planName: string;
  /** Current plan price label, e.g. `A$20.00 / month`, `Free`, `Custom`. */
  priceLabel: string;
  /** Whether the company currently has paid access (active/trialing). */
  entitled: boolean;
  /** Short status headline, e.g. `Active`, `Free trial`, `No subscription`. */
  statusLabel: string;
  /** Status tone (always paired with `statusLabel` text — Design.md §6). */
  statusTone: ManagePlanTone;
  /** Plain-language description of the current billing state (Rules.md §6). */
  statusDescription: string;
  /** Trial-ends / renews line, or null when neither applies. */
  periodNote: string | null;
  /** Whether to show the upgrade (start-checkout) affordance. */
  showUpgrade: boolean;
  /** Label for the upgrade button, e.g. `Start your free trial`. */
  upgradeLabel: string;
  /** The paid plan the upgrade targets (display name, e.g. `Pro`). */
  upgradePlanName: string;
  /** Whether checkout is actually configured (purchasable + a Stripe price id). */
  checkoutReady: boolean;
  /** Note shown when the upgrade is offered but checkout isn't configured yet. */
  configNote: string | null;
  /** Free-trial note shown under a configured, genuinely-new upgrade; else null. */
  trialNote: string | null;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * Format an ISO date for the billing panel, built from UTC parts (not
 * `toLocaleDateString`) so it is deterministic across test/runtime locales and
 * timezones — mirroring `formatHistoryDate`. An unparseable value degrades to a
 * neutral label rather than "Invalid Date".
 */
export function formatBillingDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "an unknown date";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** Statuses that mean a subscription existed before (so the upgrade is a *restart*). */
function isLapsed(state: BillingState): boolean {
  return (
    state.status === "canceled" ||
    state.status === "unpaid" ||
    state.status === "past_due" ||
    state.status === "incomplete" ||
    state.status === "incomplete_expired" ||
    state.status === "paused"
  );
}

/** Map a billing state to the status label/tone/description shown in the panel. */
function describeStatus(
  state: BillingState,
  planName: string,
): { label: string; tone: ManagePlanTone; description: string } {
  switch (state.status) {
    case "trialing":
      return state.trialExpired
        ? {
            label: "Trial ended",
            tone: "warning",
            description:
              "Your free trial has ended. Add a payment method to stay on Pro.",
          }
        : {
            label: "Free trial",
            tone: "success",
            description: "You're in your free trial of Pro.",
          };
    case "active":
      return {
        label: "Active",
        tone: "success",
        description: "Your Pro subscription is active.",
      };
    case "past_due":
      return {
        label: "Payment past due",
        tone: "warning",
        description:
          "Your last payment didn't go through. Update your payment method to keep Pro.",
      };
    case "unpaid":
      return {
        label: "Unpaid",
        tone: "danger",
        description:
          "Your subscription is unpaid. Update billing to restore Pro access.",
      };
    case "canceled":
      return {
        label: "Canceled",
        tone: "neutral",
        description:
          "Your subscription was canceled. You can resubscribe anytime to return to Pro.",
      };
    case "paused":
      return {
        label: "Paused",
        tone: "warning",
        description: "Your subscription is paused.",
      };
    case "incomplete":
    case "incomplete_expired":
      return {
        label: "Incomplete",
        tone: "warning",
        description:
          "Your subscription setup didn't finish. Start checkout again to complete it.",
      };
    default:
      // No subscription (null/unknown) — fail closed to the not-entitled view.
      return {
        label: "No subscription",
        tone: "neutral",
        description: `You're on the ${planName} plan.`,
      };
  }
}

/** The trial-ends / renews line, or null when neither applies. */
function periodNote(state: BillingState): string | null {
  if (state.status === "trialing" && state.trialEndsAt) {
    const when = formatBillingDate(state.trialEndsAt);
    return state.trialExpired
      ? `Your trial ended on ${when}.`
      : `Your free trial ends on ${when}.`;
  }
  if (state.status === "active" && state.currentPeriodEnd) {
    return `Renews on ${formatBillingDate(state.currentPeriodEnd)}.`;
  }
  return null;
}

/**
 * Build the manage-plan view model. `catalog` and `trialDays` come from the
 * billing config (the server page resolves them from env); `now` is injected so
 * the trial-expiry comparison is deterministic and testable. Pure.
 *
 * The upgrade affordance targets the paid entry plan (`pro`). It is offered only
 * to companies that aren't already entitled (active/trialing) — a free, lapsed,
 * or never-subscribed company — and its copy reflects whether this is a first
 * subscription (start trial / upgrade) or a restart of a lapsed one. The button
 * is only *enabled* when checkout is actually configured (`checkoutReady`);
 * otherwise a plain note explains it isn't set up in this environment, so the UI
 * never sends a half-configured plan to the 409-returning checkout route.
 */
export function buildManagePlanView(
  company: Pick<
    CompanyRow,
    | "plan_tier"
    | "stripe_customer_id"
    | "stripe_subscription_id"
    | "subscription_status"
    | "trial_ends_at"
    | "current_period_end"
  >,
  catalog: Record<PlanTier, BillingPlan>,
  trialDays: number,
  now: Date,
): ManagePlanView {
  const state = deriveBillingState(company, now);
  const planTier = company.plan_tier;
  const plan = catalog[planTier];
  const entry = catalog.pro;
  const checkoutReady = isCheckoutReady(entry);

  const status = describeStatus(state, plan.name);

  const showUpgrade = !state.entitled;
  const lapsed = isLapsed(state);
  const upgradeLabel = lapsed
    ? "Restart subscription"
    : trialDays > 0
      ? "Start your free trial"
      : `Upgrade to ${entry.name}`;

  // The free-trial note is honest: only shown when checkout is configured, the
  // trial is on, and this is a genuinely new subscription (not a restart of one
  // that already used its trial).
  const trialNote =
    showUpgrade && checkoutReady && trialDays > 0 && !state.hasSubscription && !lapsed
      ? `Includes a ${trialDays}-day free trial. Cancel anytime.`
      : null;

  const configNote =
    showUpgrade && !checkoutReady
      ? "Online checkout isn't configured in this environment yet."
      : null;

  return {
    planTier,
    planName: plan.name,
    priceLabel: formatPlanPriceWithInterval(plan),
    entitled: state.entitled,
    statusLabel: status.label,
    statusTone: status.tone,
    statusDescription: status.description,
    periodNote: periodNote(state),
    showUpgrade,
    upgradeLabel,
    upgradePlanName: entry.name,
    checkoutReady,
    configNote,
    trialNote,
  };
}

/** The two outcomes Stripe (or the mock) can return the user to `/settings` with. */
export type CheckoutOutcome = "success" | "canceled";

/**
 * Parse the `?checkout=` return param the checkout success/cancel URLs carry
 * (`/settings?checkout=success|canceled`, see `startCheckout`). Returns null for
 * anything else (including an absent or array-valued param), so a stray query
 * never raises a spurious notice.
 */
export function parseCheckoutParam(
  value: string | string[] | undefined,
): CheckoutOutcome | null {
  if (value === "success" || value === "canceled") return value;
  return null;
}

/** A notice to surface after returning from checkout (maps to a toast). */
export interface CheckoutNotice {
  /** Toast tone vocabulary (`success` | `info` — never an error for a cancel). */
  tone: "success" | "info";
  title: string;
  message: string;
}

/**
 * The confirmation/notice to show after the user returns from (test-mode)
 * checkout. Success is a success toast (the subscription state arrives via the
 * webhook moments later, so the copy says "being set up"); a cancel is a neutral
 * info toast that makes clear nothing changed. Returns null when there's no
 * checkout return to acknowledge.
 */
export function checkoutReturnNotice(
  outcome: CheckoutOutcome | null,
): CheckoutNotice | null {
  switch (outcome) {
    case "success":
      return {
        tone: "success",
        title: "Checkout complete",
        message:
          "Thanks! Your Pro plan is being set up — it'll appear here in a moment.",
      };
    case "canceled":
      return {
        tone: "info",
        title: "Checkout canceled",
        message: "No changes were made to your plan.",
      };
    default:
      return null;
  }
}
