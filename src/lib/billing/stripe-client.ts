import type Stripe from "stripe";

/**
 * Provider-abstracted billing client (DailyPlan Day 71 — Stripe scaffold, Week
 * 11). Mirrors the AI model client (`src/lib/ai/client.ts`): all billing call
 * sites depend on this interface only, so Stripe stays behind one seam.
 *
 * If `STRIPE_SECRET_KEY` is unset, the client runs in deterministic MOCK mode so
 * tests and local dev work OFFLINE with no Stripe account and no network — the
 * same offline-first contract the model client uses (absent key ⇒ mock). The
 * mock returns Stripe-shaped ids and a local placeholder checkout URL so the
 * downstream flow (Day 73–76) can be built and tested without a key.
 *
 * SERVER ONLY. This module reads `STRIPE_SECRET_KEY`; never import it into a
 * client component (it is listed in the Day-46 secrets audit's secret modules,
 * so the bundle leak scan fails if it ever becomes client-reachable).
 *
 * NO LIVE CHARGES. The scaffold refuses a live secret key (`sk_live_…`): only a
 * test-mode key (`sk_test_…`) — or the mock — is allowed, so Day 71 can never
 * move real money. The live/prod wiring is a later, deliberate step.
 */

function env(key: string, fallback = ""): string {
  return process.env[key]?.trim() || fallback;
}

/** A Stripe customer linkage result. */
export interface EnsureCustomerResult {
  /** The Stripe Customer id (`cus_…`). */
  customerId: string;
  /** Whether this call created the customer (vs. reused the passed id). */
  created: boolean;
}

export interface EnsureCustomerParams {
  /** An existing Stripe customer id to reuse, or null to create a new one. */
  existingCustomerId?: string | null;
  /** The company's id — stored as customer metadata for traceability. */
  companyId: string;
  /** The admin's email for the Stripe customer (optional). */
  email?: string | null;
  /** A human label for the customer (e.g. the company name). */
  name?: string | null;
}

/** A created Checkout Session (the subset the app needs). */
export interface CheckoutSession {
  /** The Checkout Session id (`cs_…`). */
  id: string;
  /** The hosted Checkout URL to redirect the customer to. */
  url: string;
}

export interface CreateCheckoutParams {
  /** The Stripe customer to attach the subscription to. */
  customerId: string;
  /** The Stripe Price id (`price_…`) to subscribe to. */
  priceId: string;
  /** Trial length in days (0 = no trial). Applied as a Stripe trial period. */
  trialDays: number;
  /** Where Stripe returns the customer on success / cancel. */
  successUrl: string;
  cancelUrl: string;
  /** The company's id — stored as session/subscription metadata. */
  companyId: string;
}

export interface BillingClient {
  readonly isMock: boolean;
  /**
   * Ensure a Stripe customer exists for the company. Reuses `existingCustomerId`
   * when provided (idempotent — never forks a company's billing across two
   * customers), otherwise creates one tagged with the company id.
   */
  ensureCustomer(params: EnsureCustomerParams): Promise<EnsureCustomerResult>;
  /**
   * Create a **subscription-mode** Checkout Session for a plan, with the
   * configured trial period. In test mode this starts a test subscription; it
   * never charges a live card (the scaffold refuses a live key).
   */
  createCheckoutSession(params: CreateCheckoutParams): Promise<CheckoutSession>;
}

/**
 * A live Stripe secret key is a test key iff it starts with `sk_test_`. A
 * `sk_live_` key is rejected in the scaffold so Day 71 can never move real money.
 * Any other shape is rejected too (fail closed, Rules.md §6) rather than handed
 * to the SDK. Exported for the test that pins the "no live charges" guard.
 */
export function assertTestModeKey(key: string): void {
  if (key.startsWith("sk_live_")) {
    throw new Error(
      "Refusing a live Stripe key (sk_live_…) — the billing scaffold is test-mode only (no live charges).",
    );
  }
  if (!key.startsWith("sk_test_")) {
    throw new Error(
      "STRIPE_SECRET_KEY must be a Stripe test-mode secret key (sk_test_…).",
    );
  }
}

/** Build the billing client from the environment: Stripe when a key is present, else mock. */
export function getBillingClient(): BillingClient {
  const key = env("STRIPE_SECRET_KEY");
  if (key) {
    assertTestModeKey(key);
    return new StripeBillingClient(key);
  }
  return new MockBillingClient();
}

class StripeBillingClient implements BillingClient {
  readonly isMock = false;
  constructor(private apiKey: string) {}

  /** Lazily construct the SDK so the mock path needs no Stripe import/network. */
  private async sdk(): Promise<Stripe> {
    const { default: StripeCtor } = await import("stripe");
    return new StripeCtor(this.apiKey);
  }

  async ensureCustomer(
    params: EnsureCustomerParams,
  ): Promise<EnsureCustomerResult> {
    if (params.existingCustomerId) {
      return { customerId: params.existingCustomerId, created: false };
    }
    const stripe = await this.sdk();
    const customer = await stripe.customers.create({
      email: params.email ?? undefined,
      name: params.name ?? undefined,
      metadata: { company_id: params.companyId },
    });
    return { customerId: customer.id, created: true };
  }

  async createCheckoutSession(
    params: CreateCheckoutParams,
  ): Promise<CheckoutSession> {
    const stripe = await this.sdk();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: params.customerId,
      line_items: [{ price: params.priceId, quantity: 1 }],
      subscription_data:
        params.trialDays > 0
          ? {
              trial_period_days: params.trialDays,
              metadata: { company_id: params.companyId },
            }
          : { metadata: { company_id: params.companyId } },
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: { company_id: params.companyId },
    });
    if (!session.url) {
      // A subscription Checkout Session should always return a hosted URL; treat
      // its absence as a provider error rather than redirecting nowhere.
      throw new Error("Stripe Checkout Session has no URL.");
    }
    return { id: session.id, url: session.url };
  }
}

/**
 * Deterministic offline stand-in. Produces Stripe-shaped ids and a local
 * placeholder checkout URL so the whole billing flow can be built and tested
 * without a Stripe key or network. It performs NO I/O and moves no money.
 */
export class MockBillingClient implements BillingClient {
  readonly isMock = true;

  async ensureCustomer(
    params: EnsureCustomerParams,
  ): Promise<EnsureCustomerResult> {
    if (params.existingCustomerId) {
      return { customerId: params.existingCustomerId, created: false };
    }
    return { customerId: `cus_mock_${shortHash(params.companyId)}`, created: true };
  }

  async createCheckoutSession(
    params: CreateCheckoutParams,
  ): Promise<CheckoutSession> {
    const id = `cs_test_mock_${shortHash(params.companyId + params.priceId)}`;
    // A clearly-local, non-Stripe URL so a mock session is never mistaken for a
    // real hosted checkout. Day 74 replaces this with the real session URL.
    const url = `${params.successUrl.split("?")[0].replace(/\/[^/]*$/, "")}/mock-checkout?session=${id}`;
    return { id, url };
  }
}

/** Small, stable, non-cryptographic hash → hex, for deterministic mock ids. */
function shortHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
