import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/session";
import { startCheckout } from "@/lib/billing/checkout";
import { updateCompanyBilling } from "@/lib/db/queries";
import { serverClient } from "@/lib/db/supabase";

/**
 * POST /api/billing/checkout (DailyPlan Day 74 — checkout test, Week 11).
 *
 * Starts a test-mode Stripe Checkout Session for the paid entry plan and returns
 * its URL for the browser to redirect to. Identity + tenancy come from the
 * server session (admin-only; `company_id` is never trusted from the client —
 * Rules.md §5). The orchestration and error mapping live in `startCheckout`;
 * this handler only wires the real dependencies and translates the outcome.
 *
 * Offline-first: with no `STRIPE_SECRET_KEY` the billing client is the mock, so
 * this endpoint returns a local placeholder checkout URL and moves no money.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  // Fail closed on any session-resolution failure (e.g. missing Supabase env).
  const session = await getSessionContext().catch(() => null);

  // Absolute base URL for Stripe's return URLs: prefer the configured public URL,
  // else the request origin.
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin;

  const result = await startCheckout({
    session,
    baseUrl,
    // Persist the ensured customer id via the service-role client (companies has
    // no client write policy); companyId is session-derived inside the core.
    saveCustomerId: async (companyId, customerId) => {
      await updateCompanyBilling(serverClient(), companyId, {
        stripe_customer_id: customerId,
      });
    },
  });

  if (result.ok) {
    return NextResponse.json(
      { url: result.url, sessionId: result.sessionId, isMock: result.isMock },
      { status: result.status },
    );
  }
  return NextResponse.json({ error: result.error }, { status: result.status });
}
