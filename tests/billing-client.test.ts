import { describe, it, expect, afterEach } from "vitest";
import {
  MockBillingClient,
  assertTestModeKey,
  getBillingClient,
} from "@/lib/billing/stripe-client";

/**
 * Provider-abstracted billing client (DailyPlan Day 71). The mock path is fully
 * offline (no Stripe import, no network, no money moved); `getBillingClient`
 * selects Stripe vs. mock from the env the same way the model client does; and
 * the scaffold refuses a live key so Day 71 can never move real money.
 *
 * The real Stripe path is intentionally NOT exercised here (it would need a live
 * account + network). We only assert the SELECTION + the no-live-charges guard —
 * constructing the live client lazily imports nothing, so no call reaches Stripe.
 */

const KEY = "STRIPE_SECRET_KEY";
const original = process.env[KEY];

afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

describe("assertTestModeKey — no live charges", () => {
  it("accepts a test-mode key", () => {
    expect(() => assertTestModeKey("sk_test_abc123")).not.toThrow();
  });

  it("refuses a live key (sk_live_…)", () => {
    expect(() => assertTestModeKey("sk_live_abc123")).toThrow(/live/i);
  });

  it("refuses any non-test key shape (fails closed)", () => {
    expect(() => assertTestModeKey("rk_test_abc")).toThrow(/sk_test_/);
    expect(() => assertTestModeKey("")).toThrow();
  });
});

describe("getBillingClient — env-driven selection", () => {
  it("returns the offline mock when STRIPE_SECRET_KEY is unset", () => {
    delete process.env[KEY];
    const client = getBillingClient();
    expect(client.isMock).toBe(true);
    expect(client).toBeInstanceOf(MockBillingClient);
  });

  it("returns a live (non-mock) client when a test key is present", () => {
    process.env[KEY] = "sk_test_scaffold";
    const client = getBillingClient();
    expect(client.isMock).toBe(false);
  });

  it("throws rather than build a client for a live key", () => {
    process.env[KEY] = "sk_live_danger";
    expect(() => getBillingClient()).toThrow(/live/i);
  });
});

describe("MockBillingClient — deterministic, offline", () => {
  const mock = new MockBillingClient();
  const companyId = "11111111-1111-1111-1111-111111111111";

  it("ensures a Stripe-shaped customer id, deterministically per company", async () => {
    const a = await mock.ensureCustomer({ companyId, email: "a@acme.test", name: "Acme" });
    const b = await mock.ensureCustomer({ companyId, email: "a@acme.test", name: "Acme" });
    expect(a.created).toBe(true);
    expect(a.customerId).toMatch(/^cus_mock_[0-9a-f]{8}$/);
    expect(a.customerId).toBe(b.customerId); // deterministic
  });

  it("reuses an existing customer id (idempotent, never forks billing)", async () => {
    const r = await mock.ensureCustomer({ companyId, existingCustomerId: "cus_existing" });
    expect(r).toEqual({ customerId: "cus_existing", created: false });
  });

  it("creates a test-shaped checkout session with a non-Stripe placeholder URL", async () => {
    const session = await mock.createCheckoutSession({
      customerId: "cus_existing",
      priceId: "price_123",
      trialDays: 30,
      successUrl: "https://app.example/billing/success",
      cancelUrl: "https://app.example/billing/cancel",
      companyId,
    });
    expect(session.id).toMatch(/^cs_test_mock_[0-9a-f]{8}$/);
    // A clearly-local placeholder, never a real Stripe hosted URL.
    expect(session.url).toContain("/mock-checkout?session=");
    expect(session.url).not.toContain("stripe.com");
  });

  it("constructs a webhook event from JSON offline (no signature needed)", async () => {
    // Day 74: the mock parses the body and runs the same normalize as the live
    // client — so the webhook flow is exercisable with no key/secret.
    const event = await mock.constructWebhookEvent(
      JSON.stringify({
        id: "evt_1",
        type: "customer.subscription.updated",
        data: { object: { id: "sub_1", customer: "cus_1", status: "active", metadata: { company_id: companyId } } },
      }),
      null,
    );
    expect(event).toMatchObject({
      type: "customer.subscription.updated",
      companyId,
      customerId: "cus_1",
      subscriptionId: "sub_1",
      subscriptionStatus: "active",
    });
  });

  it("throws on a non-JSON webhook body (never trusts garbage)", async () => {
    await expect(mock.constructWebhookEvent("not json", null)).rejects.toThrow();
  });
});
