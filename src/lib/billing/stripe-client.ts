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

/**
 * A provider-agnostic, normalized webhook event (DailyPlan Day 74 — checkout +
 * webhook stub). The webhook route verifies the signature and asks the client to
 * `constructWebhookEvent`; the client returns THIS bounded shape, so the pure
 * policy (`interpretWebhookEvent`, `src/lib/billing/webhook.ts`) never touches a
 * Stripe type and is fully testable with plain objects. Only the fields the
 * billing mirror needs are extracted — never the raw event (no PII harvesting,
 * Rules.md §3). All ids are non-secret Stripe references (`cus_…`/`sub_…`), the
 * status is Stripe's own vocabulary, and the two timestamps are ISO strings.
 */
export interface NormalizedWebhookEvent {
  /** The Stripe event id (`evt_…`), for idempotency/logging. */
  id: string;
  /** The Stripe event type, e.g. `customer.subscription.updated`. */
  type: string;
  /** The company this event is attributed to (from object metadata), or null. */
  companyId: string | null;
  /** The Stripe customer id on the event object, or null. */
  customerId: string | null;
  /** The Stripe subscription id, or null. */
  subscriptionId: string | null;
  /** The subscription status string (unvalidated here), or null. */
  subscriptionStatus: string | null;
  /** Trial end as ISO, or null. */
  trialEndsAt: string | null;
  /** Current period end as ISO, or null. */
  currentPeriodEnd: string | null;
}

/** A minimal structural view of a Stripe event, so normalize is testable offline. */
interface RawStripeEvent {
  id?: unknown;
  type?: unknown;
  data?: { object?: Record<string, unknown> };
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** A Stripe unix timestamp (seconds) → ISO string, or null when absent/invalid. */
function isoFromUnixSeconds(v: unknown): string | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  return new Date(v * 1000).toISOString();
}

/**
 * Normalize a raw Stripe event into the bounded {@link NormalizedWebhookEvent}.
 * Structural (reads `data.object` defensively) so the SAME code path runs for a
 * verified live `Stripe.Event` and for the mock's parsed JSON — one place maps
 * Stripe's shape to the mirror, with no `any`. Unknown/irrelevant fields are
 * simply left null; the policy layer decides what to do with the result.
 */
export function normalizeStripeEvent(raw: RawStripeEvent): NormalizedWebhookEvent {
  const obj: Record<string, unknown> = raw.data?.object ?? {};
  const type = asString(raw.type) ?? "";
  const metadata = (obj.metadata as Record<string, unknown> | undefined) ?? {};
  const companyId = asString(metadata.company_id);
  const customerId = asString(obj.customer);

  let subscriptionId: string | null = null;
  let subscriptionStatus: string | null = null;
  let trialEndsAt: string | null = null;
  let currentPeriodEnd: string | null = null;

  if (type.startsWith("customer.subscription.")) {
    // The event object IS the subscription.
    subscriptionId = asString(obj.id);
    subscriptionStatus = asString(obj.status);
    trialEndsAt = isoFromUnixSeconds(obj.trial_end);
    currentPeriodEnd = isoFromUnixSeconds(obj.current_period_end);
  } else if (type === "checkout.session.completed") {
    // A completed checkout carries the new subscription id; its status/period
    // arrive on the following subscription events.
    subscriptionId = asString(obj.subscription);
  }

  return {
    id: asString(raw.id) ?? "",
    type,
    companyId,
    customerId,
    subscriptionId,
    subscriptionStatus,
    trialEndsAt,
    currentPeriodEnd,
  };
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
  /**
   * Verify an inbound webhook and return the normalized event. The live client
   * verifies the Stripe signature against `STRIPE_WEBHOOK_SECRET` (fails closed
   * if unverifiable — an unsigned/forged event must never mutate billing). The
   * mock parses the JSON body with NO signature check (offline: there is no
   * secret and no real Stripe to sign it), so the whole webhook path is testable
   * without a key. Throws when the payload can't be trusted/parsed.
   */
  constructWebhookEvent(
    rawBody: string,
    signature: string | null,
  ): Promise<NormalizedWebhookEvent>;
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

  async constructWebhookEvent(
    rawBody: string,
    signature: string | null,
  ): Promise<NormalizedWebhookEvent> {
    const secret = env("STRIPE_WEBHOOK_SECRET");
    if (!secret) {
      // Fail closed: without the signing secret we cannot verify authenticity, so
      // we refuse rather than trust an unverifiable event (Rules.md §6).
      throw new Error("STRIPE_WEBHOOK_SECRET is not configured.");
    }
    if (!signature) {
      throw new Error("Missing Stripe-Signature header.");
    }
    const stripe = await this.sdk();
    // Throws on a bad/forged signature — the route maps that to a 400.
    const event = stripe.webhooks.constructEvent(rawBody, signature, secret);
    return normalizeStripeEvent(event as unknown as RawStripeEvent);
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

  async constructWebhookEvent(
    rawBody: string,
    _signature: string | null,
  ): Promise<NormalizedWebhookEvent> {
    // Offline: there is no signing secret and no real Stripe to sign the event,
    // so we parse the JSON body directly (the signature is intentionally ignored)
    // and run the SAME normalize path as the live client. This lets the whole
    // checkout→webhook flow be exercised end-to-end with no Stripe key.
    void _signature;
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new Error("Webhook body is not valid JSON.");
    }
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("Webhook body is not a JSON object.");
    }
    return normalizeStripeEvent(parsed as RawStripeEvent);
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
