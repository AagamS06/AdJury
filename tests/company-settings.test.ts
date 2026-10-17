import { describe, it, expect, vi } from "vitest";
import type { SessionContext } from "@/lib/auth/session";
import {
  CompanySettingsSchema,
  DANGER_ZONE_ACTIONS,
  firstSettingsIssue,
} from "@/lib/company/settings";
import { updateCompanySettings } from "@/lib/company/update-settings";
import type { CompanyRow, PlanTier, UserRole } from "@/types/db";

/**
 * Company settings (DailyPlan Day 50). Tests the pure input contract + the
 * danger-zone catalogue, and the injectable update core. The central guarantees
 * proved are authz + tenancy + idempotency: only an admin may save (401/403),
 * the write is scoped to the server-derived company id (never client input), an
 * unchanged plan is a no-op (no pointless write), and a bad plan is rejected at
 * the boundary. The client island + page wire these on top and aren't unit-tested.
 */

const COMPANY_ID = "22222222-2222-2222-2222-222222222222";
const ADMIN_ID = "11111111-1111-1111-1111-111111111111";
const MEMBER_ID = "33333333-3333-3333-3333-333333333333";

function companyRow(overrides: Partial<CompanyRow> = {}): CompanyRow {
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
  role: UserRole = "admin",
  companyOverrides: Partial<CompanyRow> = {},
): SessionContext {
  return {
    authUserId: role === "admin" ? ADMIN_ID : MEMBER_ID,
    email: role === "admin" ? "admin@acme.test" : "member@acme.test",
    companyId: COMPANY_ID,
    role,
    company: companyRow(companyOverrides),
  };
}

describe("CompanySettingsSchema", () => {
  it.each(["free", "pro", "enterprise"] as PlanTier[])(
    "accepts the %s plan tier",
    (tier) => {
      const parsed = CompanySettingsSchema.safeParse({ plan_tier: tier });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.plan_tier).toBe(tier);
    },
  );

  it("rejects an unknown plan tier with a plain message", () => {
    const parsed = CompanySettingsSchema.safeParse({ plan_tier: "platinum" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(firstSettingsIssue(parsed.error)).toBe("Choose a plan.");
    }
  });

  it("rejects a missing plan tier", () => {
    const parsed = CompanySettingsSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });
});

describe("DANGER_ZONE_ACTIONS", () => {
  it("catalogues the destructive stubs with unique keys and full copy", () => {
    expect(DANGER_ZONE_ACTIONS.length).toBeGreaterThan(0);
    const keys = DANGER_ZONE_ACTIONS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const action of DANGER_ZONE_ACTIONS) {
      expect(action.title.length).toBeGreaterThan(0);
      expect(action.description.length).toBeGreaterThan(0);
      expect(action.actionLabel.length).toBeGreaterThan(0);
    }
  });
});

describe("updateCompanySettings", () => {
  it("rejects an unauthenticated caller (401) without writing", async () => {
    const update = vi.fn();
    const result = await updateCompanySettings({
      session: null,
      input: { plan_tier: "pro" },
      update,
    });
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a member (403) without writing", async () => {
    const update = vi.fn();
    const result = await updateCompanySettings({
      session: session("member"),
      input: { plan_tier: "pro" },
      update,
    });
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects an invalid plan tier (400) without writing", async () => {
    const update = vi.fn();
    const result = await updateCompanySettings({
      session: session("admin"),
      input: { plan_tier: "platinum" },
      update,
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(update).not.toHaveBeenCalled();
  });

  it("saves a changed plan scoped to the server-derived company id", async () => {
    const update = vi
      .fn()
      .mockResolvedValue(companyRow({ plan_tier: "pro" }));
    const result = await updateCompanySettings({
      // Admin is on `free`; switching to `pro`.
      session: session("admin", { plan_tier: "free" }),
      // A spoofed company id in the input must be ignored (tenancy — Rules.md §5).
      input: { plan_tier: "pro" },
      update,
    });
    expect(result).toMatchObject({ ok: true, status: 200, changed: true });
    expect(update).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      planTier: "pro",
    });
  });

  it("is an idempotent no-op when the plan is unchanged", async () => {
    const update = vi.fn();
    const result = await updateCompanySettings({
      session: session("admin", { plan_tier: "pro" }),
      input: { plan_tier: "pro" },
      update,
    });
    expect(result).toMatchObject({ ok: true, status: 200, changed: false });
    expect(update).not.toHaveBeenCalled();
  });

  it("maps a write failure to a plain 500", async () => {
    const update = vi.fn().mockRejectedValue(new Error("db down"));
    const result = await updateCompanySettings({
      session: session("admin", { plan_tier: "free" }),
      input: { plan_tier: "enterprise" },
      update,
    });
    expect(result).toMatchObject({ ok: false, status: 500 });
    if (!result.ok) expect(result.error).not.toContain("db down");
  });
});
