import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { completeCompanyOnboarding } from "@/lib/db/queries";
import {
  CompanyOnboardingSchema,
  INDUSTRY_OPTIONS,
  PLAN_TIER_OPTIONS,
  firstOnboardingIssue,
  industryLabel,
  needsOnboarding,
  planReviewAllowance,
  planTierLabel,
} from "@/lib/company/onboarding";
import { PLAN_RATE_LIMITS } from "@/lib/rate-limit";
import type { CompanyRow, PlanTier } from "@/types/db";

/**
 * First-admin company onboarding (DailyPlan Day 22). Tests the pure contract +
 * helpers and the DB write helper (validated fields, server-scoped company id,
 * stamped `onboarded_at`). The server action and route gate are wired on top of
 * these; like the auth actions they touch next/headers + redirect and aren't
 * unit-tested here.
 */

// ── needsOnboarding ────────────────────────────────────────────────────────

describe("needsOnboarding", () => {
  it("is true when the company has not been onboarded", () => {
    expect(needsOnboarding({ onboarded_at: null })).toBe(true);
  });

  it("is false once onboarding is stamped", () => {
    expect(needsOnboarding({ onboarded_at: "2026-09-18T00:00:00.000Z" })).toBe(
      false,
    );
  });
});

// ── option lists ───────────────────────────────────────────────────────────

describe("option lists", () => {
  it("exposes unique, non-empty industry values incl. an 'other' catch-all", () => {
    const values = INDUSTRY_OPTIONS.map((o) => o.value);
    expect(values.length).toBeGreaterThan(0);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toContain("other");
    for (const opt of INDUSTRY_OPTIONS) {
      expect(opt.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("covers exactly the three plan tiers", () => {
    const values = PLAN_TIER_OPTIONS.map((o) => o.value).sort();
    expect(values).toEqual(["enterprise", "free", "pro"]);
  });
});

// ── label + allowance helpers ──────────────────────────────────────────────

describe("labels & allowance", () => {
  it("maps a known industry value to its label; passes through unknown/null", () => {
    expect(industryLabel("saas")).toBe("SaaS & software");
    expect(industryLabel("made_up_value")).toBe("made_up_value");
    expect(industryLabel(null)).toBeNull();
  });

  it("labels each plan tier", () => {
    expect(planTierLabel("free")).toBe("Free");
    expect(planTierLabel("pro")).toBe("Pro");
    expect(planTierLabel("enterprise")).toBe("Enterprise");
  });

  it("reads the review allowance from the rate-limit policy (single source)", () => {
    for (const tier of ["free", "pro", "enterprise"] as PlanTier[]) {
      expect(planReviewAllowance(tier)).toBe(PLAN_RATE_LIMITS[tier].limit);
    }
  });
});

// ── input contract ─────────────────────────────────────────────────────────

describe("CompanyOnboardingSchema", () => {
  it("accepts a valid submission and trims the name", () => {
    const parsed = CompanyOnboardingSchema.safeParse({
      name: "  Acme Marketing  ",
      industry: "saas",
      plan_tier: "pro",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.name).toBe("Acme Marketing");
      expect(parsed.data.industry).toBe("saas");
      expect(parsed.data.plan_tier).toBe("pro");
    }
  });

  it("rejects a too-short name", () => {
    const parsed = CompanyOnboardingSchema.safeParse({
      name: "A",
      industry: "saas",
      plan_tier: "free",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an unknown industry", () => {
    const parsed = CompanyOnboardingSchema.safeParse({
      name: "Acme",
      industry: "not_a_real_industry",
      plan_tier: "free",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(firstOnboardingIssue(parsed.error)).toBe("Choose your industry.");
    }
  });

  it("rejects an invalid plan tier", () => {
    const parsed = CompanyOnboardingSchema.safeParse({
      name: "Acme",
      industry: "saas",
      plan_tier: "platinum",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a missing industry with a plain-language message", () => {
    const parsed = CompanyOnboardingSchema.safeParse({
      name: "Acme",
      industry: "",
      plan_tier: "free",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(firstOnboardingIssue(parsed.error)).toBe("Choose your industry.");
    }
  });
});

// ── DB write helper ────────────────────────────────────────────────────────

function fakeCompaniesDb(row: CompanyRow) {
  const calls: { updated?: Record<string, unknown>; id?: unknown } = {};
  const builder = {
    update(values: Record<string, unknown>) {
      calls.updated = values;
      return this;
    },
    eq(col: string, val: unknown) {
      if (col === "id") calls.id = val;
      return this;
    },
    select() {
      return this;
    },
    async single() {
      return { data: row, error: null };
    },
  };
  const db = { from: () => builder } as unknown as SupabaseClient;
  return { db, calls };
}

const COMPANY_ROW: CompanyRow = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "Acme",
  industry: null,
  plan_tier: "free",
  juror_weights: null,
  onboarded_at: null,
  created_at: "2026-09-18T00:00:00.000Z",
};

describe("completeCompanyOnboarding", () => {
  it("writes the name/industry/plan and stamps onboarded_at, scoped to the company id", async () => {
    const { db, calls } = fakeCompaniesDb({
      ...COMPANY_ROW,
      name: "Acme Marketing",
      industry: "saas",
      plan_tier: "pro",
      onboarded_at: "2026-09-18T12:00:00.000Z",
    });
    const now = new Date("2026-09-18T12:00:00.000Z");

    const result = await completeCompanyOnboarding(
      db,
      COMPANY_ROW.id,
      { name: "Acme Marketing", industry: "saas", plan_tier: "pro" },
      now,
    );

    expect(calls.id).toBe(COMPANY_ROW.id);
    expect(calls.updated).toEqual({
      name: "Acme Marketing",
      industry: "saas",
      plan_tier: "pro",
      onboarded_at: "2026-09-18T12:00:00.000Z",
    });
    expect(result.onboarded_at).toBe("2026-09-18T12:00:00.000Z");
    expect(needsOnboarding(result)).toBe(false);
  });

  it("throws with context (no PII) when the update fails", async () => {
    const failingDb = {
      from: () => ({
        update() {
          return this;
        },
        eq() {
          return this;
        },
        select() {
          return this;
        },
        async single() {
          return { data: null, error: { message: "update denied", code: "42501" } };
        },
      }),
    } as unknown as SupabaseClient;

    await expect(
      completeCompanyOnboarding(failingDb, COMPANY_ROW.id, {
        name: "Acme",
        industry: "saas",
        plan_tier: "free",
      }),
    ).rejects.toThrow(/completeCompanyOnboarding/);
  });
});
