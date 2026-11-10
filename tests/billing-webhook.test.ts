import { describe, it, expect } from "vitest";
import {
  HANDLED_WEBHOOK_TYPES,
  interpretWebhookEvent,
  isHandledWebhookType,
} from "@/lib/billing/webhook";
import {
  MockBillingClient,
  normalizeStripeEvent,
  type NormalizedWebhookEvent,
} from "@/lib/billing/stripe-client";
import { startCheckout } from "@/lib/billing/checkout";
import { deriveBillingState } from "@/lib/billing/subscription";
import { buildBillingCatalog } from "@/lib/billing/plans";
import { updateCompanyBilling, type UpdateCompanyBillingParams } from "@/lib/db/queries";
import type { SessionContext } from "@/lib/auth/session";
import type { CompanyRow } from "@/types/db";

/**
 * Webhook policy + the end-to-end "a test subscription completes" DoD (DailyPlan
 * Day 74, Week 11). `interpretWebhookEvent` maps a normalized event to a billing
 * mirror update, writing only present keys, failing closed on an unattributable
 * event, and never storing an unknown status; `normalizeStripeEvent` extracts
 * the bounded fields from raw Stripe shapes. The integration test chains the
 * offline checkout → a mock-verified subscription event → the mirror write, and
 * proves the company becomes entitled.
 */

const COMPANY_ID = "22222222-2222-2222-2222-222222222222";

function normalized(overrides: Partial<NormalizedWebhookEvent> = {}): NormalizedWebhookEvent {
  return {
    id: "evt_1",
    type: "customer.subscription.updated",
    companyId: COMPANY_ID,
    customerId: "cus_1",
    subscriptionId: "sub_1",
    subscriptionStatus: "active",
    trialEndsAt: null,
    currentPeriodEnd: null,
    ...overrides,
  };
}

describe("interpretWebhookEvent — handled-type gate", () => {
  it("pins the handled set", () => {
    expect([...HANDLED_WEBHOOK_TYPES].sort()).toEqual([
      "checkout.session.completed",
      "customer.subscription.created",
      "customer.subscription.deleted",
      "customer.subscription.updated",
    ]);
  });

  it("ignores an unhandled type (acknowledged, no update)", () => {
    const r = interpretWebhookEvent(normalized({ type: "invoice.paid" }));
    expect(r.handled).toBe(false);
    expect(isHandledWebhookType("invoice.paid")).toBe(false);
  });
});

describe("interpretWebhookEvent — tenancy (fail closed)", () => {
  it("is a no-op when the event has no company_id (never guesses a tenant)", () => {
    const r = interpretWebhookEvent(normalized({ companyId: null }));
    expect(r).toEqual({ handled: false, reason: expect.stringMatching(/company_id/) });
  });
});

describe("interpretWebhookEvent — field mapping (partial writes)", () => {
  it("checkout.session.completed links customer + subscription, no status", () => {
    const r = interpretWebhookEvent(
      normalized({
        type: "checkout.session.completed",
        customerId: "cus_x",
        subscriptionId: "sub_x",
        subscriptionStatus: null,
      }),
    );
    expect(r.handled).toBe(true);
    if (r.handled) {
      expect(r.companyId).toBe(COMPANY_ID);
      expect(r.update).toEqual({ stripe_customer_id: "cus_x", stripe_subscription_id: "sub_x" });
      expect("subscription_status" in r.update).toBe(false);
    }
  });

  it("subscription.created (trialing) mirrors status + trial + period", () => {
    const r = interpretWebhookEvent(
      normalized({
        type: "customer.subscription.created",
        subscriptionStatus: "trialing",
        trialEndsAt: "2026-12-10T00:00:00.000Z",
        currentPeriodEnd: "2026-12-10T00:00:00.000Z",
      }),
    );
    expect(r.handled).toBe(true);
    if (r.handled) {
      expect(r.update).toMatchObject({
        subscription_status: "trialing",
        trial_ends_at: "2026-12-10T00:00:00.000Z",
        current_period_end: "2026-12-10T00:00:00.000Z",
      });
    }
  });

  it("subscription.deleted pins canceled regardless of the raw status", () => {
    const r = interpretWebhookEvent(
      normalized({ type: "customer.subscription.deleted", subscriptionStatus: "active" }),
    );
    expect(r.handled).toBe(true);
    if (r.handled) expect(r.update.subscription_status).toBe("canceled");
  });

  it("does NOT write an unknown status string (guards the CHECK vocabulary)", () => {
    const r = interpretWebhookEvent(
      normalized({ type: "customer.subscription.updated", subscriptionStatus: "bogus_status" }),
    );
    expect(r.handled).toBe(true);
    if (r.handled) expect("subscription_status" in r.update).toBe(false);
  });

  it("is a no-op for a handled type carrying nothing actionable", () => {
    const r = interpretWebhookEvent(
      normalized({
        type: "checkout.session.completed",
        customerId: null,
        subscriptionId: null,
        subscriptionStatus: null,
      }),
    );
    expect(r.handled).toBe(false);
  });
});

describe("normalizeStripeEvent — bounded extraction from raw shapes", () => {
  it("extracts a subscription event (unix seconds → ISO)", () => {
    const n = normalizeStripeEvent({
      id: "evt_sub",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_abc",
          customer: "cus_abc",
          status: "active",
          trial_end: 1765324800, // 2025-12-10T00:00:00Z
          current_period_end: 1767916800, // 2026-01-09T00:00:00Z
          metadata: { company_id: COMPANY_ID },
        },
      },
    });
    expect(n).toMatchObject({
      type: "customer.subscription.updated",
      companyId: COMPANY_ID,
      customerId: "cus_abc",
      subscriptionId: "sub_abc",
      subscriptionStatus: "active",
    });
    expect(n.trialEndsAt).toBe(new Date(1765324800 * 1000).toISOString());
    expect(n.currentPeriodEnd).toBe(new Date(1767916800 * 1000).toISOString());
  });

  it("extracts a checkout.session.completed (subscription id only)", () => {
    const n = normalizeStripeEvent({
      id: "evt_cs",
      type: "checkout.session.completed",
      data: {
        object: {
          customer: "cus_cs",
          subscription: "sub_cs",
          metadata: { company_id: COMPANY_ID },
        },
      },
    });
    expect(n).toMatchObject({
      type: "checkout.session.completed",
      companyId: COMPANY_ID,
      customerId: "cus_cs",
      subscriptionId: "sub_cs",
      subscriptionStatus: null,
    });
  });

  it("defaults missing fields to null (no throw on a sparse object)", () => {
    const n = normalizeStripeEvent({ type: "customer.subscription.created", data: {} });
    expect(n.companyId).toBeNull();
    expect(n.subscriptionId).toBeNull();
    expect(n.trialEndsAt).toBeNull();
  });
});

describe("DoD — a test subscription completes end-to-end (offline)", () => {
  it("checkout → mock-verified subscription event → mirror → entitled", async () => {
    // An in-memory company row that the webhook mirror writes to, mimicking the
    // service-role updateCompanyBilling against a fake Supabase client.
    let row: CompanyRow = {
      id: COMPANY_ID,
      name: "Acme",
      industry: "saas",
      plan_tier: "free",
      juror_weights: null,
      onboarded_at: "2026-09-18T00:00:00.000Z",
      created_at: "2026-08-31T00:00:00.000Z",
    };
    // Minimal fake matching the chainable supabase update().eq().select().single().
    const fakeDb = {
      from() {
        return {
          update(patch: Record<string, string | null>) {
            row = { ...row, ...patch } as CompanyRow;
            return {
              eq() {
                return {
                  select() {
                    return { single: async () => ({ data: row, error: null }) };
                  },
                };
              },
            };
          },
        };
      },
    };

    const session: SessionContext = {
      authUserId: "11111111-1111-1111-1111-111111111111",
      email: "admin@acme.test",
      companyId: COMPANY_ID,
      role: "admin",
      company: row,
    };
    const client = new MockBillingClient();

    // 1. Start checkout offline (links the customer id).
    const checkout = await startCheckout({
      session,
      baseUrl: "https://app.example",
      saveCustomerId: async (companyId, customerId) => {
        await updateCompanyBilling(fakeDb as never, companyId, {
          stripe_customer_id: customerId,
        });
      },
      client,
      catalog: buildBillingCatalog("price_entry_test"),
      trialDays: 30,
    });
    expect(checkout.ok).toBe(true);
    expect(row.stripe_customer_id).toMatch(/^cus_mock_/);

    // 2. Stripe would now POST a subscription.created event. Simulate it as the
    //    raw JSON the webhook route receives; the mock verifies (no-op) + normalizes.
    const trialEnd = Math.floor(Date.parse("2026-12-10T00:00:00.000Z") / 1000);
    const rawEvent = JSON.stringify({
      id: "evt_sub_created",
      type: "customer.subscription.created",
      data: {
        object: {
          id: "sub_mock_1",
          customer: row.stripe_customer_id,
          status: "trialing",
          trial_end: trialEnd,
          current_period_end: trialEnd,
          metadata: { company_id: COMPANY_ID },
        },
      },
    });
    const event = await client.constructWebhookEvent(rawEvent, null);

    // 3. Interpret + apply the mirror write (what the webhook route does).
    const outcome = interpretWebhookEvent(event);
    expect(outcome.handled).toBe(true);
    if (outcome.handled) {
      await updateCompanyBilling(
        fakeDb as never,
        outcome.companyId,
        outcome.update as UpdateCompanyBillingParams,
      );
    }

    // 4. The company's billing state now reads as entitled + trialing.
    expect(row.subscription_status).toBe("trialing");
    expect(row.stripe_subscription_id).toBe("sub_mock_1");
    const state = deriveBillingState(row, new Date("2026-11-20T00:00:00.000Z"));
    expect(state.entitled).toBe(true);
    expect(state.trialing).toBe(true);
    expect(state.trialExpired).toBe(false);
  });
});
