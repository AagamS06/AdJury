import { describe, it, expect, vi } from "vitest";
import type { SessionContext } from "@/lib/auth/session";
import { startCheckout } from "@/lib/billing/checkout";
import {
  MockBillingClient,
  type BillingClient,
  type CheckoutSession,
  type CreateCheckoutParams,
  type EnsureCustomerParams,
  type EnsureCustomerResult,
  type NormalizedWebhookEvent,
} from "@/lib/billing/stripe-client";
import { buildBillingCatalog } from "@/lib/billing/plans";
import type { CompanyRow, PlanTier } from "@/types/db";

/**
 * Checkout core (DailyPlan Day 74 — checkout test, Week 11). Proves the day's
 * fences and the DoD precondition (a test Checkout Session is created offline):
 * admin-only (401/403), refuses an unconfigured plan (409), ensures + persists
 * the Stripe customer exactly once (idempotent, never forks billing), and builds
 * the subscription session from the server-derived company + the configured base
 * URL/trial — never from client input. Runs fully offline (MockBillingClient).
 */

const COMPANY_ID = "22222222-2222-2222-2222-222222222222";
const ENTRY_PRICE = "price_entry_test_123";

function company(overrides: Partial<CompanyRow> = {}): CompanyRow {
  return {
    id: COMPANY_ID,
    name: "Acme",
    industry: "saas",
    plan_tier: "free",
    juror_weights: null,
    onboarded_at: "2026-09-18T00:00:00.000Z",
    created_at: "2026-08-31T00:00:00.000Z",
    ...overrides,
  };
}

function session(
  role: "admin" | "member" = "admin",
  companyOverrides: Partial<CompanyRow> = {},
): SessionContext {
  return {
    authUserId: "11111111-1111-1111-1111-111111111111",
    email: role === "admin" ? "admin@acme.test" : "member@acme.test",
    companyId: COMPANY_ID,
    role,
    company: company(companyOverrides),
  };
}

/** Catalog with the entry plan's Stripe price configured (checkout-ready). */
function configuredCatalog(): Record<PlanTier, ReturnType<typeof buildBillingCatalog>["pro"]> {
  return buildBillingCatalog(ENTRY_PRICE);
}

/** A recording BillingClient so call params can be asserted. */
function recordingClient(overrides: Partial<BillingClient> = {}): {
  client: BillingClient;
  ensureCalls: EnsureCustomerParams[];
  checkoutCalls: CreateCheckoutParams[];
} {
  const ensureCalls: EnsureCustomerParams[] = [];
  const checkoutCalls: CreateCheckoutParams[] = [];
  const client: BillingClient = {
    isMock: true,
    async ensureCustomer(p: EnsureCustomerParams): Promise<EnsureCustomerResult> {
      ensureCalls.push(p);
      if (p.existingCustomerId) return { customerId: p.existingCustomerId, created: false };
      return { customerId: "cus_new_abc", created: true };
    },
    async createCheckoutSession(p: CreateCheckoutParams): Promise<CheckoutSession> {
      checkoutCalls.push(p);
      return { id: "cs_test_rec", url: "https://app.example/mock-checkout?session=cs_test_rec" };
    },
    async constructWebhookEvent(): Promise<NormalizedWebhookEvent> {
      throw new Error("not used");
    },
    ...overrides,
  };
  return { client, ensureCalls, checkoutCalls };
}

describe("startCheckout — authz fences (fail closed)", () => {
  it("401s an unauthenticated caller", async () => {
    const r = await startCheckout({
      session: null,
      baseUrl: "https://app.example",
      saveCustomerId: vi.fn(),
      client: new MockBillingClient(),
      catalog: configuredCatalog(),
    });
    expect(r).toMatchObject({ ok: false, status: 401 });
  });

  it("403s a non-admin member (billing is an admin action)", async () => {
    const save = vi.fn();
    const r = await startCheckout({
      session: session("member"),
      baseUrl: "https://app.example",
      saveCustomerId: save,
      client: new MockBillingClient(),
      catalog: configuredCatalog(),
    });
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect(save).not.toHaveBeenCalled();
  });
});

describe("startCheckout — plan configuration", () => {
  it("409s when the entry plan has no configured Stripe price", async () => {
    const r = await startCheckout({
      session: session("admin"),
      baseUrl: "https://app.example",
      saveCustomerId: vi.fn(),
      client: new MockBillingClient(),
      catalog: buildBillingCatalog(null), // no price id ⇒ not checkout-ready
    });
    expect(r).toMatchObject({ ok: false, status: 409 });
    if (!r.ok) expect(r.error).toMatch(/STRIPE_PRICE_ENTRY_MONTHLY/);
  });
});

describe("startCheckout — happy path (offline)", () => {
  it("creates a session and persists a freshly-created customer id once", async () => {
    const save = vi.fn(async () => {});
    const { client, ensureCalls, checkoutCalls } = recordingClient();
    const r = await startCheckout({
      session: session("admin"),
      baseUrl: "https://app.example/",
      saveCustomerId: save,
      client,
      catalog: configuredCatalog(),
      trialDays: 30,
    });

    expect(r).toMatchObject({ ok: true, status: 200, isMock: true });
    if (r.ok) {
      expect(r.customerId).toBe("cus_new_abc");
      expect(r.url).toContain("/mock-checkout?session=");
      expect(r.sessionId).toBe("cs_test_rec");
    }

    // ensureCustomer was handed the server-derived identity, not client input.
    expect(ensureCalls).toHaveLength(1);
    expect(ensureCalls[0]).toMatchObject({ companyId: COMPANY_ID, email: "admin@acme.test", name: "Acme" });

    // The new customer id was persisted exactly once.
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(COMPANY_ID, "cus_new_abc");

    // The checkout used the configured price, trial, company, and base URL
    // (trailing slash trimmed) for the return URLs.
    expect(checkoutCalls).toHaveLength(1);
    expect(checkoutCalls[0]).toMatchObject({
      customerId: "cus_new_abc",
      priceId: ENTRY_PRICE,
      trialDays: 30,
      companyId: COMPANY_ID,
      successUrl: "https://app.example/settings?checkout=success",
      cancelUrl: "https://app.example/settings?checkout=canceled",
    });
  });

  it("reuses an already-linked customer id and does NOT persist again", async () => {
    const save = vi.fn(async () => {});
    const { client, ensureCalls } = recordingClient();
    const r = await startCheckout({
      session: session("admin", { stripe_customer_id: "cus_existing" }),
      baseUrl: "https://app.example",
      saveCustomerId: save,
      client,
      catalog: configuredCatalog(),
    });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.customerId).toBe("cus_existing");
    expect(ensureCalls[0].existingCustomerId).toBe("cus_existing");
    // Reused ⇒ created:false ⇒ no write (no fork, no redundant persist).
    expect(save).not.toHaveBeenCalled();
  });
});

describe("startCheckout — failures fail closed (500, no success)", () => {
  it("500s and does not create a session when the customer persist fails", async () => {
    const { client, checkoutCalls } = recordingClient();
    const r = await startCheckout({
      session: session("admin"),
      baseUrl: "https://app.example",
      saveCustomerId: vi.fn(async () => {
        throw new Error("db down");
      }),
      client,
      catalog: configuredCatalog(),
    });
    expect(r).toMatchObject({ ok: false, status: 500 });
    if (!r.ok) expect(r.error).not.toMatch(/db down/); // internal detail not leaked
    // We must not have handed out a checkout whose customer we couldn't record.
    expect(checkoutCalls).toHaveLength(0);
  });

  it("500s when the provider throws creating the session", async () => {
    const { client } = recordingClient({
      async createCheckoutSession(): Promise<CheckoutSession> {
        throw new Error("stripe boom");
      },
    });
    const r = await startCheckout({
      session: session("admin"),
      baseUrl: "https://app.example",
      saveCustomerId: vi.fn(async () => {}),
      client,
      catalog: configuredCatalog(),
    });
    expect(r).toMatchObject({ ok: false, status: 500 });
  });
});
