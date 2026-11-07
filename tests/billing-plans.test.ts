import { describe, it, expect } from "vitest";
import {
  BILLING_CURRENCY,
  DEFAULT_TRIAL_DAYS,
  ENTRY_PLAN_AMOUNT_CENTS,
  MAX_TRIAL_DAYS,
  MIN_TRIAL_DAYS,
  buildBillingCatalog,
  entryPlan,
  formatPlanPrice,
  formatPlanPriceWithInterval,
  isCheckoutReady,
  resolveTrialDays,
} from "@/lib/billing/plans";

/**
 * Billing plan catalog + pricing config (DailyPlan Day 71 — Stripe scaffold).
 * The catalog is pure (price id injected), so the pricing model is provable
 * offline: the entry plan is AUD $20/mo, free/enterprise carry no Stripe price,
 * and the trial length is a clamped config value.
 */

describe("billing catalog", () => {
  const catalog = buildBillingCatalog("price_test_123");

  it("has exactly the three plan tiers", () => {
    expect(Object.keys(catalog).sort()).toEqual(["enterprise", "free", "pro"]);
    for (const key of ["free", "pro", "enterprise"] as const) {
      expect(catalog[key].key).toBe(key);
    }
  });

  it("prices the entry (pro) plan at AUD $20.00 / month", () => {
    const pro = entryPlan(catalog);
    expect(pro.key).toBe("pro");
    expect(pro.amountCents).toBe(ENTRY_PLAN_AMOUNT_CENTS);
    expect(ENTRY_PLAN_AMOUNT_CENTS).toBe(2000);
    expect(pro.currency).toBe(BILLING_CURRENCY);
    expect(pro.interval).toBe("month");
    expect(pro.purchasable).toBe(true);
    expect(formatPlanPriceWithInterval(pro)).toBe("A$20.00 / month");
  });

  it("injects the entry plan's Stripe price id and only the entry plan carries one", () => {
    expect(catalog.pro.priceId).toBe("price_test_123");
    expect(catalog.free.priceId).toBeNull();
    expect(catalog.enterprise.priceId).toBeNull();
  });

  it("marks free as $0 and enterprise as custom, neither purchasable", () => {
    expect(catalog.free.amountCents).toBe(0);
    expect(catalog.free.purchasable).toBe(false);
    expect(formatPlanPrice(catalog.free)).toBe("Free");
    expect(catalog.enterprise.amountCents).toBeNull();
    expect(catalog.enterprise.purchasable).toBe(false);
    expect(formatPlanPrice(catalog.enterprise)).toBe("Custom");
    // No interval ⇒ bare label, not "… / month".
    expect(formatPlanPriceWithInterval(catalog.free)).toBe("Free");
    expect(formatPlanPriceWithInterval(catalog.enterprise)).toBe("Custom");
  });

  it("is checkout-ready only when the entry plan has a configured price id", () => {
    expect(isCheckoutReady(catalog.pro)).toBe(true);
    // Free/enterprise are never checkout-ready (not purchasable).
    expect(isCheckoutReady(catalog.free)).toBe(false);
    expect(isCheckoutReady(catalog.enterprise)).toBe(false);
    // A purchasable plan with no configured price id renders but is NOT ready.
    const unconfigured = buildBillingCatalog(null);
    expect(unconfigured.pro.purchasable).toBe(true);
    expect(unconfigured.pro.priceId).toBeNull();
    expect(isCheckoutReady(unconfigured.pro)).toBe(false);
  });

  it("formats cents to a fixed A$ price with two decimals", () => {
    expect(formatPlanPrice(buildBillingCatalog(null).pro)).toBe("A$20.00");
    // A non-round amount still renders two decimals.
    expect(
      formatPlanPrice({ ...catalog.pro, amountCents: 1999 }),
    ).toBe("A$19.99");
  });
});

describe("resolveTrialDays", () => {
  it("defaults when unset or non-numeric", () => {
    expect(resolveTrialDays(undefined)).toBe(DEFAULT_TRIAL_DAYS);
    expect(resolveTrialDays(null)).toBe(DEFAULT_TRIAL_DAYS);
    expect(resolveTrialDays("")).toBe(DEFAULT_TRIAL_DAYS);
    expect(resolveTrialDays("  ")).toBe(DEFAULT_TRIAL_DAYS);
    expect(resolveTrialDays("not-a-number")).toBe(DEFAULT_TRIAL_DAYS);
    expect(DEFAULT_TRIAL_DAYS).toBe(30);
  });

  it("accepts the advertised trial lengths (1-month and 3-month promo)", () => {
    expect(resolveTrialDays("30")).toBe(30);
    expect(resolveTrialDays("90")).toBe(90);
    expect(resolveTrialDays("0")).toBe(0); // trial disabled
  });

  it("clamps out-of-range and truncates fractional values", () => {
    expect(resolveTrialDays("-5")).toBe(MIN_TRIAL_DAYS);
    expect(resolveTrialDays("9999")).toBe(MAX_TRIAL_DAYS);
    expect(MIN_TRIAL_DAYS).toBe(0);
    expect(MAX_TRIAL_DAYS).toBe(90);
    expect(resolveTrialDays("14.9")).toBe(14);
  });
});
