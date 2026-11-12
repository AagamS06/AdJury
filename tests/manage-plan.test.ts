import { describe, it, expect } from "vitest";
import {
  buildManagePlanView,
  checkoutReturnNotice,
  formatBillingDate,
  parseCheckoutParam,
} from "@/lib/billing/manage-plan";
import { buildBillingCatalog } from "@/lib/billing/plans";
import type { CompanyRow, SubscriptionStatus } from "@/types/db";

/**
 * Manage-plan view model (DailyPlan Day 76 — Billing settings, Week 11). Pure:
 * the panel's state is derived from the company's mirrored Stripe fields + the
 * catalog/trial config with no Stripe call, so what the UI shows is provable
 * offline. These pin the status mapping, the upgrade affordance + its honest
 * copy, the checkout-configured gating, and the checkout-return notice.
 */

const NOW = new Date("2026-11-12T12:00:00.000Z");

/** A catalog with the entry plan's Stripe price configured (checkout-ready). */
const CONFIGURED = buildBillingCatalog("price_test_entry");
/** A catalog with no entry price id (purchasable but not checkout-ready). */
const UNCONFIGURED = buildBillingCatalog(null);

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

describe("buildManagePlanView — current plan + price", () => {
  it("reads the plan name and price from the catalog (no drift)", () => {
    const view = buildManagePlanView(company(), CONFIGURED, 30, NOW);
    expect(view.planTier).toBe("free");
    expect(view.planName).toBe("Free");
    expect(view.priceLabel).toBe("Free");
    expect(view.upgradePlanName).toBe("Pro");
  });

  it("shows the Pro price with interval for a pro-tier company", () => {
    const view = buildManagePlanView(
      company({ plan_tier: "pro" }),
      CONFIGURED,
      30,
      NOW,
    );
    expect(view.planName).toBe("Pro");
    expect(view.priceLabel).toBe("A$20.00 / month");
  });
});

describe("buildManagePlanView — no subscription (free)", () => {
  it("offers a configured upgrade with the start-trial label + trial note", () => {
    const view = buildManagePlanView(company(), CONFIGURED, 30, NOW);
    expect(view.entitled).toBe(false);
    expect(view.statusLabel).toBe("No subscription");
    expect(view.statusTone).toBe("neutral");
    expect(view.statusDescription).toContain("Free");
    expect(view.showUpgrade).toBe(true);
    expect(view.checkoutReady).toBe(true);
    expect(view.upgradeLabel).toBe("Start your free trial");
    expect(view.trialNote).toBe("Includes a 30-day free trial. Cancel anytime.");
    expect(view.configNote).toBeNull();
    expect(view.periodNote).toBeNull();
  });

  it("uses 'Upgrade to Pro' and no trial note when the trial is disabled", () => {
    const view = buildManagePlanView(company(), CONFIGURED, 0, NOW);
    expect(view.upgradeLabel).toBe("Upgrade to Pro");
    expect(view.trialNote).toBeNull();
  });

  it("disables checkout and explains it when no Stripe price is configured", () => {
    const view = buildManagePlanView(company(), UNCONFIGURED, 30, NOW);
    expect(view.showUpgrade).toBe(true);
    expect(view.checkoutReady).toBe(false);
    expect(view.configNote).toContain("isn't configured");
    // The trial note requires a configured checkout — it's not shown here.
    expect(view.trialNote).toBeNull();
  });
});

describe("buildManagePlanView — entitled states hide the upgrade", () => {
  it("trialing (not expired): success, entitled, no upgrade, trial-end note", () => {
    const view = buildManagePlanView(
      company({
        subscription_status: "trialing",
        stripe_subscription_id: "sub_1",
        trial_ends_at: "2026-12-01T00:00:00.000Z",
      }),
      CONFIGURED,
      30,
      NOW,
    );
    expect(view.entitled).toBe(true);
    expect(view.showUpgrade).toBe(false);
    expect(view.statusLabel).toBe("Free trial");
    expect(view.statusTone).toBe("success");
    expect(view.periodNote).toBe("Your free trial ends on Dec 1, 2026.");
  });

  it("trialing (expired relative to now): warning + 'Trial ended' + past note", () => {
    const view = buildManagePlanView(
      company({
        subscription_status: "trialing",
        stripe_subscription_id: "sub_1",
        trial_ends_at: "2026-11-01T00:00:00.000Z",
      }),
      CONFIGURED,
      30,
      NOW,
    );
    expect(view.entitled).toBe(true);
    expect(view.showUpgrade).toBe(false);
    expect(view.statusLabel).toBe("Trial ended");
    expect(view.statusTone).toBe("warning");
    expect(view.periodNote).toBe("Your trial ended on Nov 1, 2026.");
  });

  it("active: success + renews note, no upgrade", () => {
    const view = buildManagePlanView(
      company({
        plan_tier: "pro",
        subscription_status: "active",
        stripe_subscription_id: "sub_1",
        current_period_end: "2026-12-12T00:00:00.000Z",
      }),
      CONFIGURED,
      30,
      NOW,
    );
    expect(view.entitled).toBe(true);
    expect(view.showUpgrade).toBe(false);
    expect(view.statusLabel).toBe("Active");
    expect(view.statusTone).toBe("success");
    expect(view.periodNote).toBe("Renews on Dec 12, 2026.");
  });
});

describe("buildManagePlanView — lapsed states offer a restart", () => {
  const lapsed: { status: SubscriptionStatus; label: string; tone: string }[] = [
    { status: "past_due", label: "Payment past due", tone: "warning" },
    { status: "unpaid", label: "Unpaid", tone: "danger" },
    { status: "canceled", label: "Canceled", tone: "neutral" },
    { status: "paused", label: "Paused", tone: "warning" },
    { status: "incomplete", label: "Incomplete", tone: "warning" },
    { status: "incomplete_expired", label: "Incomplete", tone: "warning" },
  ];

  for (const { status, label, tone } of lapsed) {
    it(`${status}: not entitled, shows a restart upgrade, no trial note`, () => {
      const view = buildManagePlanView(
        company({
          plan_tier: "pro",
          subscription_status: status,
          stripe_subscription_id: "sub_1",
          stripe_customer_id: "cus_1",
        }),
        CONFIGURED,
        30,
        NOW,
      );
      expect(view.entitled).toBe(false);
      expect(view.showUpgrade).toBe(true);
      expect(view.statusLabel).toBe(label);
      expect(view.statusTone).toBe(tone);
      expect(view.upgradeLabel).toBe("Restart subscription");
      // A lapsed subscription already used its trial — never advertise a new one.
      expect(view.trialNote).toBeNull();
    });
  }
});

describe("buildManagePlanView — fail closed on a bad mirror", () => {
  it("treats an unknown status string as no subscription (not entitled)", () => {
    const view = buildManagePlanView(
      company({
        // deriveBillingState parses this to null (unknown vocabulary).
        subscription_status: "bogus" as SubscriptionStatus,
      }),
      CONFIGURED,
      30,
      NOW,
    );
    expect(view.entitled).toBe(false);
    expect(view.showUpgrade).toBe(true);
    expect(view.statusLabel).toBe("No subscription");
  });
});

describe("formatBillingDate", () => {
  it("formats from UTC parts, deterministically", () => {
    expect(formatBillingDate("2026-11-12T23:30:00.000Z")).toBe("Nov 12, 2026");
    expect(formatBillingDate("2026-01-01T00:00:00.000Z")).toBe("Jan 1, 2026");
  });

  it("degrades an unparseable value to a neutral label", () => {
    expect(formatBillingDate("not-a-date")).toBe("an unknown date");
  });
});

describe("parseCheckoutParam", () => {
  it("accepts only the two known outcomes", () => {
    expect(parseCheckoutParam("success")).toBe("success");
    expect(parseCheckoutParam("canceled")).toBe("canceled");
  });

  it("returns null for anything else (missing, array, unknown)", () => {
    expect(parseCheckoutParam(undefined)).toBeNull();
    expect(parseCheckoutParam("other")).toBeNull();
    expect(parseCheckoutParam(["success"])).toBeNull();
  });
});

describe("checkoutReturnNotice", () => {
  it("success → a success toast", () => {
    const notice = checkoutReturnNotice("success");
    expect(notice?.tone).toBe("success");
    expect(notice?.title).toBe("Checkout complete");
    expect(notice?.message).toMatch(/being set up/i);
  });

  it("canceled → a neutral info toast that says nothing changed", () => {
    const notice = checkoutReturnNotice("canceled");
    expect(notice?.tone).toBe("info");
    expect(notice?.title).toBe("Checkout canceled");
    expect(notice?.message).toMatch(/no changes/i);
  });

  it("null → no notice", () => {
    expect(checkoutReturnNotice(null)).toBeNull();
  });
});
