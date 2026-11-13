import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  buildBillingCatalog,
  formatPlanPriceWithInterval,
  isCheckoutReady,
  resolveTrialDays,
  MAX_TRIAL_DAYS,
  type BillingPlan,
} from "@/lib/billing/plans";
import {
  PLAN_TIER_ORDER,
  PLAN_FEATURES,
  featuresForTier,
  reconcileTierMapping,
  type PlanFeature,
} from "@/lib/billing/entitlements";
import {
  SUBSCRIPTION_STATUSES,
  ENTITLED_STATUSES,
  isEntitled,
  deriveBillingState,
} from "@/lib/billing/subscription";
import {
  checkFeatureAccess,
  canUseFeature,
  planTierLabel,
  FEATURE_GATE_STATUS,
} from "@/lib/billing/feature-gate";
import { getBillingClient } from "@/lib/billing/stripe-client";
import { startCheckout } from "@/lib/billing/checkout";
import { interpretWebhookEvent } from "@/lib/billing/webhook";
import {
  buildManagePlanView,
  type ManagePlanTone,
} from "@/lib/billing/manage-plan";
import {
  buildPricingCards,
  reconcilePricing,
} from "@/lib/marketing/pricing";
import type { SessionContext } from "@/lib/auth/session";
import type { CompanyRow, PlanTier, SubscriptionStatus } from "@/types/db";
import type { UpdateCompanyBillingParams } from "@/lib/db/queries";

/**
 * Week 11 hardening (DailyPlan Day 77) — billing-scaffold integration.
 *
 * Week 11 built the billing scaffold: Day 71 the plan catalog + trial config
 * (`plans.ts`), the entitlement mirror (`subscription.ts`), the provider-
 * abstracted Stripe client (`stripe-client.ts`) and the `companies` billing
 * columns (migration 0012); Day 72 the tier → limits/features ladder
 * (`entitlements.ts`); Day 73 the public pricing page model
 * (`marketing/pricing.ts`); Day 74 test-mode checkout + the webhook policy
 * (`checkout.ts` / `webhook.ts`); Day 75 the app-wide feature gate
 * (`feature-gate.ts`) and its live gates; Day 76 the manage-plan view model
 * (`manage-plan.ts`). Each day has its own per-day suite reading only its slice.
 *
 * This is the week-end integration complement (mirroring Day 7/14/21/28/35/42/
 * 49/56/63/70): NO new product surface — it wires the REAL Week-11 cores
 * together and proves the week's invariants COMPOSE across the whole billing
 * surface and that the surfaces AGREE, properties no single-day suite sees:
 *
 *  1. The subscription lifecycle composes end-to-end through the REAL cores:
 *     checkout (Day 74) → a Stripe event normalized by the REAL client and
 *     interpreted by the REAL webhook policy → the mirrored company row →
 *     `deriveBillingState` entitlement (Day 71) → the manage-plan view (Day 76)
 *     — one company evolving trialing → canceled through the actual event path.
 *  2. ONE catalog is the single source of plan name/price across every surface:
 *     the gate copy (Day 75), the manage-plan panel (Day 76), and the pricing
 *     page (Day 73) all AGREE for every tier because they read the one catalog —
 *     a cross-surface agreement no single-surface suite can see.
 *  3. The feature ladder (Day 72) is the one authority the live gates (Day 75)
 *     and the pricing page (Day 73) obey: the gated features actually wired into
 *     the real source are all real, all PAID (non-free) gates, and for every
 *     tier the gate decision, the ladder, and the pricing card's included flag
 *     agree — and the gate fails closed on an unknown tier.
 *  4. The reconcile guards (tier mapping + pricing) pass together over one build,
 *     and the trial config (Day 71) propagates consistently to BOTH the pricing
 *     card trial label (Day 73) and the manage-plan trial note (Day 76).
 *  5. The subscription-status vocabulary is one source of truth across
 *     `subscription.ts`, the webhook mirror (Day 74), the manage-plan panel
 *     (Day 76), AND the migration 0012 CHECK constraint on disk — every status
 *     the webhook can write is CHECK-valid and renders a panel state, and
 *     entitlement agrees across the cores.
 *
 * All offline (no live Stripe/DB/network): the billing client is the mock in
 * this environment, the policy/view cores are pure, and the webhook body is a
 * plain object — faithful to what ships, and it moves no money.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const COMPANY_ID = "22222222-2222-2222-2222-222222222222";
const PRICE_ID = "price_test_entry_monthly";

interface Mod {
  /** Repo-relative path, POSIX separators. */
  path: string;
  src: string;
}

/** Recursively collect every .ts/.tsx under src/, path repo-relative (POSIX). */
function loadSrcModules(): Mod[] {
  const out: Mod[] = [];
  function walk(absDir: string, rel: string): void {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const abs = `${absDir}/${entry.name}`;
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(abs, childRel);
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        out.push({ path: childRel, src: readFileSync(abs, "utf8") });
      }
    }
  }
  walk(`${repoRoot}src`, "src");
  return out;
}

/** A company row fixture with the given billing fields (free plan unless set). */
function companyWith(overrides: Partial<CompanyRow>): CompanyRow {
  return {
    id: COMPANY_ID,
    name: "Acme",
    industry: null,
    plan_tier: "free",
    juror_weights: null,
    onboarded_at: "2026-08-31T00:00:00.000Z",
    created_at: "2026-08-31T00:00:00.000Z",
    ...overrides,
  };
}

/** An admin session for the given company (checkout is an admin action). */
function adminSession(company: CompanyRow): SessionContext {
  return {
    authUserId: "11111111-1111-1111-1111-111111111111",
    email: "admin@acme.test",
    companyId: company.id,
    role: "admin",
    company,
  };
}

/**
 * Apply a webhook billing update onto a company row — writing ONLY the keys the
 * update carries, faithful to `updateCompanyBilling`'s partial-write contract
 * (a present-keys-only merge). Pure, so the mirror step stays offline.
 */
function applyBillingUpdate(
  company: CompanyRow,
  update: UpdateCompanyBillingParams,
): CompanyRow {
  const next = { ...company };
  for (const [key, value] of Object.entries(update)) {
    if (value !== undefined) {
      (next as Record<string, unknown>)[key] = value;
    }
  }
  return next;
}

/** A Stripe-shaped subscription event body (what the webhook route receives). */
function subscriptionEventBody(
  type: string,
  obj: Record<string, unknown>,
): string {
  return JSON.stringify({
    id: `evt_${type}`,
    type,
    data: { object: { metadata: { company_id: COMPANY_ID }, ...obj } },
  });
}

const VALID_TONES: ReadonlySet<ManagePlanTone> = new Set<ManagePlanTone>([
  "neutral",
  "success",
  "warning",
  "danger",
]);

// ─────────────────────────────────────────────────────────────────────────────

describe("Week 11 hardening — billing-scaffold integration", () => {
  const catalog = buildBillingCatalog(PRICE_ID);
  const trialDays = 30;
  const now = new Date("2026-11-13T00:00:00.000Z");

  // ── 1. the subscription lifecycle composes end-to-end ───────────────────────
  describe("the subscription lifecycle composes through the real cores", () => {
    const client = getBillingClient();

    it("runs on the offline mock (no Stripe key here) so the scaffold moves no money", () => {
      expect(client.isMock).toBe(true);
    });

    it("checkout → webhook (created) → mirror → entitled → manage-plan agree", async () => {
      // 1. Admin starts checkout for the paid plan (Day 74). The customer id is
      //    persisted via the injected saver (mirrors the route's service-role write).
      let savedCustomerId: string | null = null;
      const started = await startCheckout({
        session: adminSession(companyWith({ plan_tier: "free" })),
        baseUrl: "https://app.adjury.test",
        saveCustomerId: async (_companyId, customerId) => {
          savedCustomerId = customerId;
        },
        client,
        catalog,
        trialDays,
      });
      expect(started.ok, JSON.stringify(started)).toBe(true);
      if (!started.ok) return;
      expect(started.isMock).toBe(true);
      expect(started.url).toContain("mock-checkout");
      expect(savedCustomerId).toBe(started.customerId);

      // 2. Stripe sends the subscription.created event AdJury stamped with the
      //    company id. The REAL client normalizes it; the REAL policy interprets it.
      const trialEnd = Math.floor(
        new Date("2026-12-13T00:00:00.000Z").getTime() / 1000,
      );
      const body = subscriptionEventBody("customer.subscription.created", {
        id: "sub_lifecycle_1",
        status: "trialing",
        customer: started.customerId,
        trial_end: trialEnd,
      });
      const event = await client.constructWebhookEvent(body, null);
      const outcome = interpretWebhookEvent(event);
      expect(outcome.handled, JSON.stringify(outcome)).toBe(true);
      if (!outcome.handled) return;
      expect(outcome.companyId).toBe(COMPANY_ID);

      // 3. Mirror onto the company row (plan upgraded to pro at the same time the
      //    paid subscription begins), then derive entitlement (Day 71).
      let company = companyWith({ plan_tier: "pro" });
      company = applyBillingUpdate(company, outcome.update);
      const state = deriveBillingState(company, now);
      expect(state.status).toBe("trialing");
      expect(state.entitled).toBe(true);
      expect(state.trialing).toBe(true);
      expect(state.trialExpired).toBe(false);

      // 4. The manage-plan panel (Day 76) reflects the same entitled, trialing
      //    state and hides the upgrade — the UI agrees with the mirror.
      const view = buildManagePlanView(company, catalog, trialDays, now);
      expect(view.entitled).toBe(true);
      expect(view.showUpgrade).toBe(false);
      expect(view.statusLabel).toBe("Free trial");
      expect(view.planName).toBe(catalog.pro.name);
    });

    it("checkout → webhook (deleted) → mirror → not entitled → manage-plan offers restart", async () => {
      // A previously-subscribed company whose subscription is then deleted.
      const body = subscriptionEventBody("customer.subscription.deleted", {
        id: "sub_lifecycle_1",
        status: "canceled",
        customer: "cus_mock_lifecycle",
      });
      const event = await client.constructWebhookEvent(body, null);
      const outcome = interpretWebhookEvent(event);
      expect(outcome.handled).toBe(true);
      if (!outcome.handled) return;
      // The policy PINS canceled on a delete regardless of the raw status string.
      expect(outcome.update.subscription_status).toBe("canceled");

      let company = companyWith({
        plan_tier: "pro",
        stripe_customer_id: "cus_mock_lifecycle",
        stripe_subscription_id: "sub_lifecycle_1",
        subscription_status: "trialing",
      });
      company = applyBillingUpdate(company, outcome.update);
      const state = deriveBillingState(company, now);
      expect(state.entitled).toBe(false);

      const view = buildManagePlanView(company, catalog, trialDays, now);
      expect(view.entitled).toBe(false);
      expect(view.showUpgrade).toBe(true);
      // A lapsed subscription is a RESTART, not a first trial.
      expect(view.upgradeLabel).toBe("Restart subscription");
      expect(view.trialNote).toBeNull();
    });
  });

  // ── 2. one catalog is the single source of plan name/price across surfaces ──
  describe("one catalog is the single source of plan name/price across surfaces", () => {
    const cards = buildPricingCards(catalog, trialDays);

    it("the gate copy, manage-plan, and pricing page agree on every tier's name + price", () => {
      for (const tier of PLAN_TIER_ORDER) {
        const plan = catalog[tier];
        const expectedName = plan.name;
        const expectedPrice = formatPlanPriceWithInterval(plan);

        // Gate upgrade copy (Day 75) names the plan from the catalog.
        expect(planTierLabel(tier)).toBe(expectedName);

        // Manage-plan panel (Day 76) for a company on this tier.
        const view = buildManagePlanView(
          companyWith({ plan_tier: tier }),
          catalog,
          trialDays,
          now,
        );
        expect(view.planName).toBe(expectedName);
        expect(view.priceLabel).toBe(expectedPrice);

        // Pricing card (Day 73) for this tier.
        const card = cards.find((c) => c.tier === tier);
        expect(card, `no pricing card for ${tier}`).toBeDefined();
        expect(card?.name).toBe(expectedName);
        expect(card?.priceLabel).toBe(expectedPrice);
      }
    });

    it("the paid entry plan is `pro`, priced from one place, and checkout-ready only with a price id", () => {
      expect(catalog.pro.purchasable).toBe(true);
      expect(isCheckoutReady(catalog.pro)).toBe(true);
      // With no configured price id the SAME plan renders but isn't checkout-ready.
      expect(isCheckoutReady(buildBillingCatalog(null).pro)).toBe(false);
      // Only the paid plan is highlighted on the pricing page.
      expect(cards.filter((c) => c.highlighted).map((c) => c.tier)).toEqual([
        "pro",
      ]);
    });
  });

  // ── 3. the feature ladder is the one authority the live gates + pricing obey ─
  describe("the feature ladder (Day 72) is the one authority the live gates obey", () => {
    const modules = loadSrcModules();

    /** Extract the feature keys actually gated at call sites in the real source. */
    function appliedGateFeatures(): Set<string> {
      const found = new Set<string>();
      const callRe = /(?:checkFeatureAccess|canUseFeature)\s*\(([\s\S]*?)\)/g;
      for (const mod of modules) {
        // Skip the gate module's own definitions (it doesn't call itself with a
        // feature literal, but be explicit so a future refactor can't confuse us).
        if (mod.path === "src/lib/billing/feature-gate.ts") continue;
        let m: RegExpExecArray | null;
        while ((m = callRe.exec(mod.src)) !== null) {
          const strLit = /["']([a-z_]+)["']/.exec(m[1]);
          if (strLit) found.add(strLit[1]);
        }
      }
      return found;
    }

    it("loaded a non-trivial module set (so the source scan means something)", () => {
      expect(modules.length).toBeGreaterThan(80);
      const paths = new Set(modules.map((m) => m.path));
      // The surfaces that actually apply gates must be present.
      expect(paths.has("src/app/api/reviews/[id]/export/route.ts")).toBe(true);
      expect(paths.has("src/lib/reviews/create-review.ts")).toBe(true);
    });

    it("every gate wired into the app targets a real, PAID feature from the ladder", () => {
      const applied = appliedGateFeatures();
      // Non-vacuous: the live gates Day 75 documents are actually present.
      expect(applied.size).toBeGreaterThan(0);
      for (const feature of [
        "pdf_export",
        "analytics_dashboard",
        "custom_juror_weights",
      ]) {
        expect(applied.has(feature), `gate for ${feature} not found in source`).toBe(
          true,
        );
      }
      const freeFeatures = featuresForTier("free");
      for (const feature of applied) {
        // It's a real feature key…
        expect(
          (PLAN_FEATURES as readonly string[]).includes(feature),
          `${feature} is not a PlanFeature`,
        ).toBe(true);
        // …and a genuinely paid gate (a free-tier feature gate would be vacuous).
        expect(
          freeFeatures.has(feature as PlanFeature),
          `${feature} is a free feature — gating it is vacuous`,
        ).toBe(false);
      }
    });

    it("the gate, the ladder, and the pricing card agree for every tier × gated feature", () => {
      const cards = buildPricingCards(catalog, trialDays);
      const gated: PlanFeature[] = [
        "pdf_export",
        "analytics_dashboard",
        "custom_juror_weights",
      ];
      for (const tier of PLAN_TIER_ORDER) {
        const ladder = featuresForTier(tier);
        const card = cards.find((c) => c.tier === tier);
        expect(card).toBeDefined();
        for (const feature of gated) {
          const byLadder = ladder.has(feature);
          // The UI affordance (canUseFeature) agrees with the ladder.
          expect(canUseFeature(tier, feature)).toBe(byLadder);
          // The server gate (checkFeatureAccess) agrees with the ladder.
          expect(checkFeatureAccess(tier, feature).ok).toBe(byLadder);
          // The pricing card's included flag agrees with the ladder.
          const row = card?.features.find((f) => f.key === feature);
          expect(row?.included).toBe(byLadder);
        }
      }
    });

    it("a gate denial carries 402 + the ladder's upgrade tier, and fails closed on an unknown tier", () => {
      const denial = checkFeatureAccess("free", "pdf_export");
      expect(denial.ok).toBe(false);
      if (denial.ok) return;
      expect(denial.status).toBe(FEATURE_GATE_STATUS);
      expect(denial.status).toBe(402);
      expect(denial.requiredTier).toBe("pro"); // the ladder's unlockedBy for pdf_export
      expect(denial.error.length).toBeGreaterThan(0);

      // An unknown/garbage tier is treated as free — the most restrictive — so a
      // bad plan_tier never widens access (Rules.md §6).
      const unknown = "platinum" as unknown as PlanTier;
      expect(canUseFeature(unknown, "pdf_export")).toBe(false);
      expect(canUseFeature(unknown, "analytics_dashboard")).toBe(false);
      expect(canUseFeature(unknown, "custom_juror_weights")).toBe(false);
    });
  });

  // ── 4. reconcile guards pass together + trial config propagates consistently ─
  describe("the reconcile guards pass together and the trial config propagates", () => {
    it("tier-mapping and pricing reconcile are both clean over one build", () => {
      const tierProblems = reconcileTierMapping();
      const pricingProblems = reconcilePricing(catalog, trialDays);
      expect(tierProblems, JSON.stringify(tierProblems)).toHaveLength(0);
      expect(pricingProblems, JSON.stringify(pricingProblems)).toHaveLength(0);
    });

    it("the trial length is one clamped config value fed to both pricing and manage-plan", () => {
      // The clamp (Day 71): a typo can't create a decade-long free window.
      expect(resolveTrialDays("999")).toBe(MAX_TRIAL_DAYS);
      expect(resolveTrialDays("0")).toBe(0);
      expect(resolveTrialDays("14")).toBe(14);

      // With a trial ON, BOTH the pricing card and the manage-plan upgrade note
      // advertise it (for a brand-new company), and with it OFF, NEITHER does.
      const newCompany = companyWith({ plan_tier: "free" });
      for (const days of [resolveTrialDays("14"), resolveTrialDays("0")] as const) {
        const wantTrial = days > 0;
        const card = buildPricingCards(catalog, days).find((c) => c.tier === "pro");
        const view = buildManagePlanView(newCompany, catalog, days, now);
        expect(card?.trialLabel !== null).toBe(wantTrial);
        expect(view.trialNote !== null).toBe(wantTrial);
        if (wantTrial) {
          expect(card?.trialLabel).toContain(String(days));
          expect(view.trialNote).toContain(String(days));
        }
      }
    });

    it("an unconfigured checkout never advertises a trial it can't start (manage-plan)", () => {
      // No price id ⇒ not checkout-ready ⇒ the upgrade shows a config note, not a
      // trial promise, so the UI never sends a half-configured plan to checkout.
      const view = buildManagePlanView(
        companyWith({ plan_tier: "free" }),
        buildBillingCatalog(null),
        trialDays,
        now,
      );
      expect(view.showUpgrade).toBe(true);
      expect(view.checkoutReady).toBe(false);
      expect(view.trialNote).toBeNull();
      expect(view.configNote).not.toBeNull();
    });
  });

  // ── 5. the subscription-status vocabulary is one source of truth ────────────
  describe("the subscription-status vocabulary agrees across the cores and the schema", () => {
    it("the vocabulary matches the migration 0012 CHECK constraint on disk", () => {
      const sql = readFileSync(
        `${repoRoot}supabase/migrations/0012_billing_scaffold.sql`,
        "utf8",
      );
      const inClause = /subscription_status in \(([\s\S]*?)\)/.exec(sql);
      expect(inClause, "CHECK (subscription_status in (...)) not found").not.toBeNull();
      const checkStatuses = [...inClause![1].matchAll(/'([a-z_]+)'/g)].map(
        (m) => m[1],
      );
      // The TS vocabulary and the DB CHECK are the same set — no drift between
      // what the app mirrors and what the column accepts.
      expect([...checkStatuses].sort()).toEqual([...SUBSCRIPTION_STATUSES].sort());
    });

    it("every status renders a manage-plan panel state and agrees with isEntitled", () => {
      for (const status of SUBSCRIPTION_STATUSES) {
        const company = companyWith({
          plan_tier: "pro",
          stripe_customer_id: "cus_x",
          stripe_subscription_id: "sub_x",
          subscription_status: status,
        });
        const view = buildManagePlanView(company, catalog, trialDays, now);
        expect(view.statusLabel.length, `empty label for ${status}`).toBeGreaterThan(0);
        expect(VALID_TONES.has(view.statusTone), `bad tone for ${status}`).toBe(true);
        expect(
          view.statusDescription.length,
          `empty description for ${status}`,
        ).toBeGreaterThan(0);
        // Entitlement is one rule: the panel's `entitled` IS `isEntitled(status)`,
        // and the upgrade affordance is exactly its negation.
        expect(view.entitled).toBe(isEntitled(status));
        expect(view.showUpgrade).toBe(!isEntitled(status));
      }
      // Exactly active + trialing are entitled across the whole vocabulary.
      expect([...ENTITLED_STATUSES].sort()).toEqual(["active", "trialing"]);
    });

    it("a company with no subscription fails closed to a not-entitled panel", () => {
      const view = buildManagePlanView(
        companyWith({ plan_tier: "free" }),
        catalog,
        trialDays,
        now,
      );
      expect(view.statusLabel).toBe("No subscription");
      expect(view.entitled).toBe(false);
      expect(view.showUpgrade).toBe(true);
    });

    it("the webhook mirror can only ever write a CHECK-valid status", async () => {
      const client = getBillingClient();
      const vocab = new Set<string>(SUBSCRIPTION_STATUSES);
      // Every real status round-trips through normalize → interpret unchanged…
      for (const status of SUBSCRIPTION_STATUSES) {
        const body = subscriptionEventBody("customer.subscription.updated", {
          id: "sub_v",
          status,
          customer: "cus_v",
        });
        const outcome = interpretWebhookEvent(await client.constructWebhookEvent(body, null));
        expect(outcome.handled).toBe(true);
        if (outcome.handled && outcome.update.subscription_status != null) {
          expect(vocab.has(outcome.update.subscription_status)).toBe(true);
        }
      }
      // …and a bogus status is simply NOT written (never poisons the mirror),
      // rather than being stored and violating the DB CHECK constraint.
      const bogus = subscriptionEventBody("customer.subscription.updated", {
        id: "sub_bogus",
        status: "totally_made_up",
        customer: "cus_bogus",
      });
      const bogusOutcome = interpretWebhookEvent(
        await client.constructWebhookEvent(bogus, null),
      );
      expect(bogusOutcome.handled).toBe(true);
      if (bogusOutcome.handled) {
        expect(bogusOutcome.update.subscription_status).toBeUndefined();
      }
    });
  });
});
