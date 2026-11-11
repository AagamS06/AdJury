import { NextResponse } from "next/server";
import { getBillingClient } from "@/lib/billing/stripe-client";
import { interpretWebhookEvent } from "@/lib/billing/webhook";
import { updateCompanyBilling } from "@/lib/db/queries";
import { serverClient } from "@/lib/db/supabase";
import { errorContext, logError, logInfo } from "@/lib/observability/logger";

/**
 * POST /api/billing/webhook (DailyPlan Day 74 — checkout test, Week 11).
 *
 * Receives Stripe subscription-lifecycle events and mirrors them onto the
 * `companies` billing columns so entitlement reads cost nothing per request
 * (Day 71 design — the webhook is the source of truth for subscription state).
 *
 * Trust & tenancy (Rules.md §5/§6): the raw body is verified against the Stripe
 * signing secret (the billing client's `constructWebhookEvent`) BEFORE anything
 * is read from it — an unsigned/forged event is rejected with a 400 and mutates
 * nothing. The `company_id` comes from the event metadata AdJury itself stamped
 * at checkout, never from an unauthenticated caller. Verified-but-unhandled
 * events are acknowledged (2xx) so Stripe stops retrying without us acting on
 * them. The write runs under the service-role client (companies has no client
 * write policy) with the mapping decided by the pure `interpretWebhookEvent`.
 *
 * Offline-first: with no `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` the mock
 * client parses the JSON body directly, so the whole flow is exercisable with no
 * Stripe account (a developer simulating events locally).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  // Verify + normalize. A verification/parse failure is a 400 and writes nothing.
  let event;
  try {
    const client = getBillingClient();
    event = await client.constructWebhookEvent(rawBody, signature);
  } catch (err) {
    logError("billing webhook verification failed", { ...errorContext(err) });
    return NextResponse.json(
      { error: "Invalid webhook signature or payload." },
      { status: 400 },
    );
  }

  const outcome = interpretWebhookEvent(event);
  if (!outcome.handled) {
    // Acknowledge so Stripe stops retrying; we deliberately did nothing.
    logInfo("billing webhook ignored", {
      eventType: event.type,
      reason: outcome.reason,
    });
    return NextResponse.json({ received: true, handled: false }, { status: 200 });
  }

  try {
    await updateCompanyBilling(serverClient(), outcome.companyId, outcome.update);
  } catch (err) {
    // A failed mirror write should NOT 2xx — let Stripe retry the delivery.
    logError("billing webhook mirror write failed", {
      op: "updateCompanyBilling",
      companyId: outcome.companyId,
      eventType: event.type,
      ...errorContext(err),
    });
    return NextResponse.json(
      { error: "Failed to record the billing update." },
      { status: 500 },
    );
  }

  logInfo("billing webhook applied", {
    eventType: event.type,
    companyId: outcome.companyId,
  });
  return NextResponse.json({ received: true, handled: true }, { status: 200 });
}
