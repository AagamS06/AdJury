import { describe, it, expect, vi } from "vitest";
import type { SessionContext } from "@/lib/auth/session";
import {
  BrandProfileSchema,
  MAX_TONE_GUIDE_CHARS,
  MIN_TONE_GUIDE_CHARS,
  brandProfileUpdatedAt,
  firstBrandProfileIssue,
  hasBrandProfile,
  resolveBrandContext,
  toneGuideText,
} from "@/lib/company/brand-profile";
import {
  saveBrandProfile,
  type SaveBrandProfileDeps,
} from "@/lib/company/save-brand-profile";
import type { BrandProfileRow, CompanyRow, UserRole } from "@/types/db";

/**
 * Brand profile CRUD (DailyPlan Day 26). Tests the pure module (input contract,
 * the length bounds, the display predicates/helpers) and the injectable save
 * core. The central guarantees proved are authz + tenancy + create-vs-edit:
 * only an admin may write (401/403 fail closed), the read/write are scoped to
 * the server-derived company id (never client input), and an existing guide is
 * updated in place while a first guide is inserted. The form + RLS wire these on
 * top and aren't unit-tested.
 */

const COMPANY_ID = "22222222-2222-2222-2222-222222222222";
const PROFILE_ID = "44444444-4444-4444-4444-444444444444";
const ADMIN_ID = "11111111-1111-1111-1111-111111111111";
const MEMBER_ID = "33333333-3333-3333-3333-333333333333";

const COMPANY: CompanyRow = {
  id: COMPANY_ID,
  name: "Acme",
  industry: "saas",
  plan_tier: "pro",
  juror_weights: null,
  onboarded_at: "2026-09-18T00:00:00.000Z",
  created_at: "2026-08-31T00:00:00.000Z",
};

function session(role: UserRole = "admin"): SessionContext {
  return {
    authUserId: role === "admin" ? ADMIN_ID : MEMBER_ID,
    email: role === "admin" ? "admin@acme.test" : "member@acme.test",
    companyId: COMPANY_ID,
    role,
    company: COMPANY,
  };
}

function profileRow(overrides: Partial<BrandProfileRow> = {}): BrandProfileRow {
  return {
    id: PROFILE_ID,
    company_id: COMPANY_ID,
    tone_guide_text: "Measured, expert, never hype.",
    embedding_ref: null,
    updated_at: "2026-09-22T00:00:00.000Z",
    ...overrides,
  };
}

const GOOD_GUIDE = "Measured and expert; prefer plain verbs, avoid hype.";

/** Deps whose writes should never fire (used for the guard-rejection cases). */
function forbiddenDeps(session_: SessionContext | null): SaveBrandProfileDeps {
  return {
    session: session_,
    input: { tone_guide_text: GOOD_GUIDE },
    getExisting: vi.fn(async () => {
      throw new Error("getExisting must not be called");
    }),
    insert: vi.fn(async () => {
      throw new Error("insert must not be called");
    }),
    update: vi.fn(async () => {
      throw new Error("update must not be called");
    }),
  };
}

// ── BrandProfileSchema ──────────────────────────────────────────────────────

describe("BrandProfileSchema", () => {
  it("accepts and trims a valid guide", () => {
    const parsed = BrandProfileSchema.parse({
      tone_guide_text: `   ${GOOD_GUIDE}   `,
    });
    expect(parsed.tone_guide_text).toBe(GOOD_GUIDE);
  });

  it("rejects a guide shorter than the minimum (after trim)", () => {
    const result = BrandProfileSchema.safeParse({ tone_guide_text: "   hi   " });
    expect(result.success).toBe(false);
  });

  it("rejects an empty guide", () => {
    expect(BrandProfileSchema.safeParse({ tone_guide_text: "" }).success).toBe(
      false,
    );
    expect(
      BrandProfileSchema.safeParse({ tone_guide_text: "        " }).success,
    ).toBe(false);
  });

  it("accepts a guide at the max length and rejects one over it", () => {
    const atMax = "a".repeat(MAX_TONE_GUIDE_CHARS);
    expect(
      BrandProfileSchema.safeParse({ tone_guide_text: atMax }).success,
    ).toBe(true);
    const overMax = "a".repeat(MAX_TONE_GUIDE_CHARS + 1);
    expect(
      BrandProfileSchema.safeParse({ tone_guide_text: overMax }).success,
    ).toBe(false);
  });

  it("accepts a guide exactly at the minimum length", () => {
    const atMin = "a".repeat(MIN_TONE_GUIDE_CHARS);
    expect(
      BrandProfileSchema.safeParse({ tone_guide_text: atMin }).success,
    ).toBe(true);
  });

  it("firstBrandProfileIssue surfaces a plain message", () => {
    const result = BrandProfileSchema.safeParse({ tone_guide_text: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(firstBrandProfileIssue(result.error)).toMatch(/\S/);
    }
  });
});

// ── pure display helpers ─────────────────────────────────────────────────────

describe("brand-profile display helpers", () => {
  it("hasBrandProfile is false for null / empty / whitespace, true for real text", () => {
    expect(hasBrandProfile(null)).toBe(false);
    expect(hasBrandProfile({ tone_guide_text: null })).toBe(false);
    expect(hasBrandProfile({ tone_guide_text: "   " })).toBe(false);
    expect(hasBrandProfile({ tone_guide_text: "Real guide." })).toBe(true);
  });

  it("toneGuideText returns the text or an empty string (never null)", () => {
    expect(toneGuideText(null)).toBe("");
    expect(toneGuideText({ tone_guide_text: null })).toBe("");
    expect(toneGuideText({ tone_guide_text: "Guide" })).toBe("Guide");
  });

  it("resolveBrandContext trims to the guide text or null when unusable (Day 27)", () => {
    expect(resolveBrandContext(null)).toBeNull();
    expect(resolveBrandContext({ tone_guide_text: null })).toBeNull();
    expect(resolveBrandContext({ tone_guide_text: "   \n " })).toBeNull();
    expect(resolveBrandContext({ tone_guide_text: "  Measured, expert.  " })).toBe(
      "Measured, expert.",
    );
  });

  it("brandProfileUpdatedAt formats a valid date and returns null otherwise", () => {
    expect(brandProfileUpdatedAt(null)).toBeNull();
    expect(brandProfileUpdatedAt({ updated_at: "not-a-date" })).toBeNull();
    expect(brandProfileUpdatedAt({ updated_at: "2026-09-22T00:00:00.000Z" })).toMatch(
      /2026/,
    );
  });
});

// ── saveBrandProfile core ───────────────────────────────────────────────────

describe("saveBrandProfile core", () => {
  it("401 when unauthenticated (no read/write)", async () => {
    const deps = forbiddenDeps(null);
    const result = await saveBrandProfile(deps);
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(deps.getExisting).not.toHaveBeenCalled();
    expect(deps.insert).not.toHaveBeenCalled();
    expect(deps.update).not.toHaveBeenCalled();
  });

  it("403 for a member — admin-only, never reads or writes", async () => {
    const deps = forbiddenDeps(session("member"));
    const result = await saveBrandProfile(deps);
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(deps.getExisting).not.toHaveBeenCalled();
    expect(deps.insert).not.toHaveBeenCalled();
    expect(deps.update).not.toHaveBeenCalled();
  });

  it("400 on invalid input (no read/write)", async () => {
    const deps: SaveBrandProfileDeps = {
      ...forbiddenDeps(session("admin")),
      input: { tone_guide_text: "  " },
    };
    const result = await saveBrandProfile(deps);
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(deps.getExisting).not.toHaveBeenCalled();
    expect(deps.insert).not.toHaveBeenCalled();
    expect(deps.update).not.toHaveBeenCalled();
  });

  it("inserts the first guide (created:true) scoped to the session company", async () => {
    const insert = vi.fn(async ({ companyId, toneGuideText: t }) =>
      profileRow({ company_id: companyId, tone_guide_text: t }),
    );
    const update = vi.fn();
    const result = await saveBrandProfile({
      session: session("admin"),
      input: { tone_guide_text: `  ${GOOD_GUIDE}  ` },
      getExisting: vi.fn(async () => null),
      insert,
      update,
    });

    expect(result).toMatchObject({ ok: true, status: 200, created: true });
    // Company id comes from the session; the text is trimmed by the schema.
    expect(insert).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      toneGuideText: GOOD_GUIDE,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("updates an existing guide in place (created:false), id + company scoped", async () => {
    const existing = profileRow();
    const update = vi.fn(async ({ id, companyId, toneGuideText: t }) =>
      profileRow({ id, company_id: companyId, tone_guide_text: t }),
    );
    const insert = vi.fn();
    const result = await saveBrandProfile({
      session: session("admin"),
      input: { tone_guide_text: "A revised, longer brand guide." },
      getExisting: vi.fn(async () => existing),
      insert,
      update,
    });

    expect(result).toMatchObject({ ok: true, status: 200, created: false });
    expect(update).toHaveBeenCalledWith({
      id: PROFILE_ID,
      companyId: COMPANY_ID,
      toneGuideText: "A revised, longer brand guide.",
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("500 (redacted) when the existing-profile read fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await saveBrandProfile({
      session: session("admin"),
      input: { tone_guide_text: GOOD_GUIDE },
      getExisting: vi.fn(async () => {
        throw new Error("db read boom");
      }),
      insert: vi.fn(),
      update: vi.fn(),
    });
    expect(result).toMatchObject({ ok: false, status: 500 });
    // The guide text is never logged (Rules.md §6).
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain(GOOD_GUIDE);
    spy.mockRestore();
  });

  it("500 (redacted) when the write fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await saveBrandProfile({
      session: session("admin"),
      input: { tone_guide_text: GOOD_GUIDE },
      getExisting: vi.fn(async () => null),
      insert: vi.fn(async () => {
        throw new Error("write boom");
      }),
      update: vi.fn(),
    });
    expect(result).toMatchObject({ ok: false, status: 500 });
    spy.mockRestore();
  });
});
