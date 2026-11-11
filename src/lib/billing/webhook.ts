/**
 * Webhook policy — interpret a normalized Stripe event into a billing-mirror
 * update (DailyPlan Day 74 — checkout + webhook stub, Week 11). PURE and
 * node-testable: it takes the provider-agnostic {@link NormalizedWebhookEvent}
 * the billing client produces (signature already verified by the route) and
 * decides which `companies` billing columns to write. No Stripe SDK, no network,
 * no DB — the route owns verification and persistence; this owns the mapping, so
 * "which event changes what" is provable offline (the same seam split the
 * checkout core and the model orchestrator use).
 *
 * Tenancy (Rules.md §5): the `company_id` comes from the event object's metadata
 * — which AdJury itself stamped at checkout (`createCheckoutSession`) — never
 * from a client request. An event we can't attribute to a company is a no-op
 * (fail closed: we never guess which tenant to mutate).
 *
 * Partial-update discipline (mirrors `updateCompanyBilling`): we write ONLY the
 * keys the event actually carries, so a `checkout.session.completed` (which has
 * no status yet) never clobbers a status a later subscription event set.
 */
import type { NormalizedWebhookEvent } from "./stripe-client";
import { parseSubscriptionStatus } from "./subscription";
import type { UpdateCompanyBillingParams } from "@/lib/db/queries";

/**
 * The event types the mirror reacts to. Everything else is acknowledged (2xx)
 * but ignored, so Stripe stops retrying without us acting on noise.
 *  - `checkout.session.completed` — the test subscription was created; link the
 *    customer + subscription ids to the company.
 *  - `customer.subscription.created|updated` — the subscription's status / trial
 *    / period changed; mirror them so entitlement reads stay correct.
 *  - `customer.subscription.deleted` — the subscription ended; mark it canceled
 *    so the company falls back to not-entitled (fail closed).
 */
export const HANDLED_WEBHOOK_TYPES: ReadonlySet<string> = new Set<string>([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

/** The outcome of interpreting one event. */
export type WebhookOutcome =
  | {
      handled: true;
      companyId: string;
      update: UpdateCompanyBillingParams;
    }
  | { handled: false; reason: string };

/** Whether this event type is one the billing mirror acts on. */
export function isHandledWebhookType(type: string): boolean {
  return HANDLED_WEBHOOK_TYPES.has(type);
}

/**
 * Decide the billing-mirror update for a normalized event. Returns a
 * `handled: false` no-op (with a reason, for logging) when the type is one we
 * ignore, when the event can't be attributed to a company, or when a handled
 * event carries nothing worth writing — so the route can always 2xx without
 * ever mutating the wrong tenant or writing an empty update.
 */
export function interpretWebhookEvent(
  event: NormalizedWebhookEvent,
): WebhookOutcome {
  if (!isHandledWebhookType(event.type)) {
    return { handled: false, reason: `unhandled event type: ${event.type}` };
  }
  if (!event.companyId) {
    // Fail closed: no metadata company id ⇒ we don't know whose billing to touch.
    return { handled: false, reason: "event has no company_id metadata" };
  }

  const update: UpdateCompanyBillingParams = {};

  if (event.type === "customer.subscription.deleted") {
    // The subscription ended — pin the terminal status so the company falls back
    // to not-entitled regardless of what the raw status string says.
    update.subscription_status = "canceled";
    if (event.subscriptionId) update.stripe_subscription_id = event.subscriptionId;
    if (event.customerId) update.stripe_customer_id = event.customerId;
    return { handled: true, companyId: event.companyId, update };
  }

  // checkout.session.completed + subscription.created/updated: mirror whatever
  // identifying + state fields the event carries, writing only present keys.
  if (event.customerId) update.stripe_customer_id = event.customerId;
  if (event.subscriptionId) update.stripe_subscription_id = event.subscriptionId;

  // Only store a status from Stripe's known vocabulary (the `companies` CHECK
  // constraint matches it); an unrecognized/missing status is simply not written
  // rather than poisoning the mirror.
  const status = parseSubscriptionStatus(event.subscriptionStatus);
  if (status) update.subscription_status = status;

  if (event.trialEndsAt) update.trial_ends_at = event.trialEndsAt;
  if (event.currentPeriodEnd) update.current_period_end = event.currentPeriodEnd;

  if (Object.keys(update).length === 0) {
    // A handled type that carried nothing actionable (e.g. a checkout with no
    // subscription id yet) — acknowledge without an empty DB write.
    return { handled: false, reason: "event carried no billing fields to write" };
  }

  return { handled: true, companyId: event.companyId, update };
}
