import { describe, it, expect } from "vitest";
import {
  ENTITLED_STATUSES,
  SUBSCRIPTION_STATUSES,
  deriveBillingState,
  isEntitled,
  parseSubscriptionStatus,
} from "@/lib/billing/subscription";
import type { CompanyRow, SubscriptionStatus } from "@/types/db";

/**
 * Subscription / entitlement derivation (DailyPlan Day 71). Pure: entitlement is
 * read from the mirrored Stripe status with no Stripe call, and fails CLOSED on a
 * null/unknown status so a bad mirror never grants paid access.
 */

const NOW = new Date("2026-11-07T12:00:00.000Z");

function company(over: Partial<CompanyRow> = {}): CompanyRow {
  return {
    id: "c1",
    name: "Acme",
    industry: null,
    plan_tier: "free",
    juror_weights: null,
    onboarded_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("subscription status vocabulary", () => {
  it("mirrors Stripe's status set and marks only active/trialing as entitled", () => {
    expect([...SUBSCRIPTION_STATUSES].sort()).toEqual(
      [
        "active",
        "canceled",
        "incomplete",
        "incomplete_expired",
        "past_due",
        "paused",
        "trialing",
        "unpaid",
      ].sort(),
    );
    expect([...ENTITLED_STATUSES].sort()).toEqual(["active", "trialing"]);
  });

  it("parseSubscriptionStatus narrows known values and rejects others", () => {
    expect(parseSubscriptionStatus("active")).toBe("active");
    expect(parseSubscriptionStatus("trialing")).toBe("trialing");
    expect(parseSubscriptionStatus(null)).toBeNull();
    expect(parseSubscriptionStatus(undefined)).toBeNull();
    expect(parseSubscriptionStatus("")).toBeNull();
    expect(parseSubscriptionStatus("gibberish")).toBeNull();
  });

  it("isEntitled: active/trialing yes, everything else no (fails closed)", () => {
    expect(isEntitled("active")).toBe(true);
    expect(isEntitled("trialing")).toBe(true);
    for (const s of ["past_due", "canceled", "incomplete", "incomplete_expired", "unpaid", "paused"] as SubscriptionStatus[]) {
      expect(isEntitled(s), `${s} is not entitled`).toBe(false);
    }
    expect(isEntitled(null)).toBe(false);
    expect(isEntitled(undefined)).toBe(false);
  });
});

describe("deriveBillingState", () => {
  it("reads a company with no Stripe linkage as a not-entitled free company", () => {
    const state = deriveBillingState(company(), NOW);
    expect(state).toEqual({
      status: null,
      entitled: false,
      trialing: false,
      hasCustomer: false,
      hasSubscription: false,
      trialEndsAt: null,
      currentPeriodEnd: null,
      trialExpired: false,
    });
  });

  it("reads an active subscription as entitled, not trialing", () => {
    const state = deriveBillingState(
      company({
        stripe_customer_id: "cus_1",
        stripe_subscription_id: "sub_1",
        subscription_status: "active",
        current_period_end: "2026-12-07T12:00:00.000Z",
      }),
      NOW,
    );
    expect(state.entitled).toBe(true);
    expect(state.trialing).toBe(false);
    expect(state.hasCustomer).toBe(true);
    expect(state.hasSubscription).toBe(true);
    expect(state.currentPeriodEnd).toBe("2026-12-07T12:00:00.000Z");
  });

  it("flags a trial as entitled and detects whether it has expired relative to now", () => {
    const future = deriveBillingState(
      company({
        stripe_customer_id: "cus_1",
        stripe_subscription_id: "sub_1",
        subscription_status: "trialing",
        trial_ends_at: "2026-11-20T12:00:00.000Z",
      }),
      NOW,
    );
    expect(future.entitled).toBe(true);
    expect(future.trialing).toBe(true);
    expect(future.trialExpired).toBe(false);

    const past = deriveBillingState(
      company({
        stripe_customer_id: "cus_1",
        stripe_subscription_id: "sub_1",
        subscription_status: "trialing",
        trial_ends_at: "2026-11-01T12:00:00.000Z",
      }),
      NOW,
    );
    expect(past.trialExpired).toBe(true);
  });

  it("treats a past_due/canceled subscription as not entitled (fails closed)", () => {
    for (const status of ["past_due", "canceled", "unpaid"] as SubscriptionStatus[]) {
      const state = deriveBillingState(
        company({ stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1", subscription_status: status }),
        NOW,
      );
      expect(state.entitled, `${status} not entitled`).toBe(false);
      expect(state.hasSubscription).toBe(true);
    }
  });
});
