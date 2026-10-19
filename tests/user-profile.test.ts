import { describe, it, expect, vi } from "vitest";
import type { SessionContext } from "@/lib/auth/session";
import {
  UserProfileSchema,
  displayNameOrFallback,
  firstProfileIssue,
  normalizeDisplayName,
} from "@/lib/user/profile";
import { updateUserProfile } from "@/lib/user/update-profile";
import { MAX_DISPLAY_NAME_CHARS } from "@/lib/validation/limits";
import type { CompanyRow, UserRole, UserRow } from "@/types/db";

/**
 * User settings (DailyPlan Day 51). Tests the pure profile contract + helpers and
 * the injectable update core. The central guarantees proved are authz + tenancy
 * + idempotency: only a signed-in user may save (401), the write is scoped to the
 * server-derived id + company id (never client input — a user can only edit their
 * own row), an unchanged name is a no-op (no pointless write), and an oversized
 * name is rejected at the boundary. The client island + page wire these on top
 * and aren't unit-tested.
 */

const COMPANY_ID = "22222222-2222-2222-2222-222222222222";
const USER_ID = "11111111-1111-1111-1111-111111111111";

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

function session(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    authUserId: USER_ID,
    email: "member@acme.test",
    companyId: COMPANY_ID,
    role: "member" as UserRole,
    displayName: null,
    company: companyRow(),
    ...overrides,
  };
}

function userRow(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: USER_ID,
    company_id: COMPANY_ID,
    email: "member@acme.test",
    role: "member",
    display_name: null,
    created_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("UserProfileSchema", () => {
  it("accepts and trims a display name", () => {
    const parsed = UserProfileSchema.safeParse({ display_name: "  Jordan Lee  " });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.display_name).toBe("Jordan Lee");
  });

  it("treats a missing display name as empty (optional)", () => {
    const parsed = UserProfileSchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.display_name).toBe("");
  });

  it("accepts a name exactly at the length cap", () => {
    const parsed = UserProfileSchema.safeParse({
      display_name: "a".repeat(MAX_DISPLAY_NAME_CHARS),
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a name over the length cap with a plain message", () => {
    const parsed = UserProfileSchema.safeParse({
      display_name: "a".repeat(MAX_DISPLAY_NAME_CHARS + 1),
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(firstProfileIssue(parsed.error)).toContain(
        String(MAX_DISPLAY_NAME_CHARS),
      );
    }
  });
});

describe("normalizeDisplayName", () => {
  it("returns null for a blank / whitespace-only name", () => {
    expect(normalizeDisplayName("")).toBeNull();
    expect(normalizeDisplayName("   ")).toBeNull();
  });

  it("returns the trimmed name when present", () => {
    expect(normalizeDisplayName("  Ada  ")).toBe("Ada");
  });
});

describe("displayNameOrFallback", () => {
  it("prefers the display name when set", () => {
    expect(
      displayNameOrFallback({ display_name: "Ada", email: "ada@acme.test" }),
    ).toBe("Ada");
  });

  it("falls back to the email when the name is null/blank/absent", () => {
    expect(
      displayNameOrFallback({ display_name: null, email: "ada@acme.test" }),
    ).toBe("ada@acme.test");
    expect(
      displayNameOrFallback({ display_name: "  ", email: "ada@acme.test" }),
    ).toBe("ada@acme.test");
    expect(displayNameOrFallback({ email: "ada@acme.test" })).toBe(
      "ada@acme.test",
    );
  });
});

describe("updateUserProfile", () => {
  it("rejects an unauthenticated caller (401) without writing", async () => {
    const update = vi.fn();
    const result = await updateUserProfile({
      session: null,
      input: { display_name: "Ada" },
      update,
    });
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects an oversized name (400) without writing", async () => {
    const update = vi.fn();
    const result = await updateUserProfile({
      session: session(),
      input: { display_name: "a".repeat(MAX_DISPLAY_NAME_CHARS + 1) },
      update,
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(update).not.toHaveBeenCalled();
  });

  it("saves a changed name scoped to the server-derived id + company id", async () => {
    const update = vi
      .fn()
      .mockResolvedValue(userRow({ display_name: "Jordan Lee" }));
    const result = await updateUserProfile({
      session: session({ displayName: null }),
      input: { display_name: "  Jordan Lee  " },
      update,
    });
    expect(result).toMatchObject({ ok: true, status: 200, changed: true });
    // Tenancy: both ids come from the session, and the name is normalized/trimmed.
    expect(update).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      userId: USER_ID,
      displayName: "Jordan Lee",
    });
  });

  it("clears the name to null when submitted blank", async () => {
    const update = vi.fn().mockResolvedValue(userRow({ display_name: null }));
    const result = await updateUserProfile({
      session: session({ displayName: "Jordan Lee" }),
      input: { display_name: "   " },
      update,
    });
    expect(result).toMatchObject({ ok: true, status: 200, changed: true });
    expect(update).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      userId: USER_ID,
      displayName: null,
    });
  });

  it("is an idempotent no-op when the name is unchanged", async () => {
    const update = vi.fn();
    const result = await updateUserProfile({
      session: session({ displayName: "Jordan Lee" }),
      input: { display_name: "Jordan Lee" },
      update,
    });
    expect(result).toMatchObject({ ok: true, status: 200, changed: false });
    expect(update).not.toHaveBeenCalled();
  });

  it("treats blank-submitted == already-null as an idempotent no-op", async () => {
    const update = vi.fn();
    const result = await updateUserProfile({
      session: session({ displayName: null }),
      input: { display_name: "" },
      update,
    });
    expect(result).toMatchObject({ ok: true, status: 200, changed: false });
    expect(update).not.toHaveBeenCalled();
  });

  it("maps a write failure to a plain 500 (no internal detail leaked)", async () => {
    const update = vi.fn().mockRejectedValue(new Error("db down"));
    const result = await updateUserProfile({
      session: session({ displayName: null }),
      input: { display_name: "Ada" },
      update,
    });
    expect(result).toMatchObject({ ok: false, status: 500 });
    if (!result.ok) expect(result.error).not.toContain("db down");
  });
});
