/**
 * Core logic for `POST /api/billing/checkout` (DailyPlan Day 74 — checkout
 * test, Week 11). Kept out of the route handler so it is unit-testable without
 * Next's request plumbing, a Stripe key, or a live database: the session,
 * billing client, catalog/trial config, and the customer-id persist are all
 * injected. The route wires the real dependencies; tests pass a fake session +
 * the offline MockBillingClient and assert the flow.
 *
 * What it does: start a subscription-mode Stripe Checkout Session for the paid
 * entry plan and return its URL for the browser to redirect to. The actual
 * subscription state is NOT set here — it is mirrored onto the company row by
 * the Stripe webhook (`interpretWebhookEvent`), which is the source of truth
 * (Day 71 design). Checkout only ensures the Stripe customer exists and links
 * its id to the company so a later retry never forks billing.
 *
 * Boundaries (Rules.md §3/§5/§6): billing is an ADMIN action, enforced on the
 * server (401 no session, 403 non-admin). `company_id` and the customer linkage
 * come from the server session, never the client. A plan with no configured
 * Stripe price is refused (409) rather than sent half-configured to Stripe.
 * Provider/DB failures fail closed to a 500 with a plain-language message; the
 * detail is logged with redacted context.
 */
import type { SessionContext } from "@/lib/auth/session";
import type { BillingClient } from "./stripe-client";
import { getBillingClient } from "./stripe-client";
import {
  buildBillingCatalog,
  entryPlan,
  getTrialDays,
  isCheckoutReady,
  type BillingPlan,
} from "./plans";
import type { PlanTier } from "@/types/db";
import { errorContext, logError } from "@/lib/observability/logger";

export type StartCheckoutResult =
  | {
      ok: true;
      status: 200;
      /** The hosted (or mock) Checkout URL to redirect the customer to. */
      url: string;
      /** The Checkout Session id (`cs_…`). */
      sessionId: string;
      /** The Stripe customer id linked to the company. */
      customerId: string;
      /** True when the offline mock produced the session (no real Stripe call). */
      isMock: boolean;
    }
  | { ok: false; status: 400 | 401 | 403 | 409 | 500; error: string };

export interface StartCheckoutDeps {
  /** Server-resolved session, or null when unauthenticated. */
  session: SessionContext | null;
  /**
   * Absolute base URL (scheme + host, no trailing slash) used to build Stripe's
   * success/cancel return URLs. The route derives it from `NEXT_PUBLIC_APP_URL`
   * or the request origin.
   */
  baseUrl: string;
  /**
   * Persist the ensured Stripe customer id onto the company (wired to
   * `updateCompanyBilling` via the service-role client — `companies` has no
   * client write policy). Called only when a new customer is created, so a retry
   * reuses the stored id. A failure here fails the request (we must not hand out
   * a checkout whose customer we couldn't record).
   */
  saveCustomerId: (companyId: string, customerId: string) => Promise<void>;
  /** Billing client; defaults to the env-selected client (offline mock, no key). */
  client?: BillingClient;
  /**
   * The plan catalog; defaults to the env-resolved catalog. Injectable so tests
   * can supply a configured (or unconfigured) entry price id.
   */
  catalog?: Record<PlanTier, BillingPlan>;
  /** Trial length in days; defaults to the configured `getTrialDays()`. */
  trialDays?: number;
}

export async function startCheckout(
  deps: StartCheckoutDeps,
): Promise<StartCheckoutResult> {
  if (!deps.session) {
    return { ok: false, status: 401, error: "You must be signed in." };
  }
  if (deps.session.role !== "admin") {
    // Only an admin manages the company's plan (Architecture §3, Rules.md §5).
    return {
      ok: false,
      status: 403,
      error: "Only an admin can change the company's plan.",
    };
  }

  const catalog = deps.catalog ?? buildBillingCatalog(
    process.env.STRIPE_PRICE_ENTRY_MONTHLY?.trim() || null,
  );
  const plan = entryPlan(catalog);
  if (!isCheckoutReady(plan)) {
    // Purchasable but no Stripe price id configured — refuse rather than send a
    // half-configured plan to Stripe (plans.ts contract). A clear operator hint.
    return {
      ok: false,
      status: 409,
      error:
        "Checkout isn't configured yet. Set STRIPE_PRICE_ENTRY_MONTHLY to the entry plan's Stripe price id.",
    };
  }
  // Narrow: isCheckoutReady guarantees a non-empty priceId.
  const priceId = plan.priceId as string;

  const companyId = deps.session.companyId;
  const trialDays = deps.trialDays ?? getTrialDays();

  let client: BillingClient;
  try {
    client = deps.client ?? getBillingClient();
  } catch (err) {
    // e.g. a live key is refused by the scaffold (assertTestModeKey).
    return failure("startCheckout/client", companyId, err);
  }

  // 1. Ensure the Stripe customer, reusing any already-linked id (idempotent —
  //    never forks a company's billing across two customers).
  let customerId: string;
  let created: boolean;
  try {
    const result = await client.ensureCustomer({
      existingCustomerId: deps.session.company.stripe_customer_id ?? null,
      companyId,
      email: deps.session.email,
      name: deps.session.company.name,
    });
    customerId = result.customerId;
    created = result.created;
  } catch (err) {
    return failure("startCheckout/ensureCustomer", companyId, err);
  }

  // 2. Persist a freshly-created customer id before handing out the checkout, so
  //    a bailed-then-retried checkout reuses it (no orphaned second customer).
  if (created) {
    try {
      await deps.saveCustomerId(companyId, customerId);
    } catch (err) {
      return failure("startCheckout/saveCustomerId", companyId, err);
    }
  }

  // 3. Create the subscription-mode Checkout Session (with the trial period).
  const base = deps.baseUrl.replace(/\/+$/, "");
  try {
    const session = await client.createCheckoutSession({
      customerId,
      priceId,
      trialDays,
      successUrl: `${base}/settings?checkout=success`,
      cancelUrl: `${base}/settings?checkout=canceled`,
      companyId,
    });
    return {
      ok: true,
      status: 200,
      url: session.url,
      sessionId: session.id,
      customerId,
      isMock: client.isMock,
    };
  } catch (err) {
    return failure("startCheckout/createCheckoutSession", companyId, err);
  }
}

function failure(
  op: string,
  companyId: string,
  err: unknown,
): StartCheckoutResult {
  // Redacted log; plain user message (Rules.md §6).
  logError("checkout start failed", { op, companyId, ...errorContext(err) });
  return {
    ok: false,
    status: 500,
    error: "We couldn't start checkout. Please try again.",
  };
}
