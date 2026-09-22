import { describe, it, expect, vi } from "vitest";
import type { SessionContext } from "@/lib/auth/session";
import {
  RoleChangeSchema,
  firstRoleChangeIssue,
  nextRole,
  roleActionLabel,
  wouldRemoveLastAdmin,
} from "@/lib/company/role-management";
import { changeMemberRole } from "@/lib/company/update-role";
import type { CompanyRow, UserRole, UserRow } from "@/types/db";

/**
 * Role management (DailyPlan Day 25 — admin promote/demote). Tests the pure
 * domain logic (input contract, the last-admin safety guard, the toggle
 * labels) and the injectable change core. The central guarantees proved are
 * authz + tenancy + the no-lockout invariant: only an admin may act (401/403),
 * the target is resolved from the session-scoped company roster (a stranger →
 * 404, never revealing cross-tenant existence), the write is scoped to the
 * server-derived company id, and a company can never be demoted to zero admins
 * (409). The client island + table wire these on top and aren't unit-tested.
 */

const COMPANY_ID = "22222222-2222-2222-2222-222222222222";
const ADMIN_ID = "11111111-1111-1111-1111-111111111111";
const ADMIN2_ID = "aaaa1111-1111-1111-1111-111111111111";
const MEMBER_ID = "33333333-3333-3333-3333-333333333333";
const STRANGER_ID = "99999999-9999-9999-9999-999999999999";

function userRow(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: ADMIN_ID,
    company_id: COMPANY_ID,
    email: "admin@acme.test",
    role: "admin",
    created_at: "2026-08-31T00:00:00.000Z",
    ...overrides,
  };
}

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

/** A roster with one admin + one member (the common case). */
function roster(): UserRow[] {
  return [
    userRow({ id: ADMIN_ID, role: "admin", email: "admin@acme.test" }),
    userRow({ id: MEMBER_ID, role: "member", email: "member@acme.test" }),
  ];
}

// ── RoleChangeSchema ──────────────────────────────────────────────────────────

describe("RoleChangeSchema", () => {
  it("accepts a valid change and trims the id", () => {
    const parsed = RoleChangeSchema.safeParse({
      userId: `  ${MEMBER_ID}  `,
      role: "admin",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ userId: MEMBER_ID, role: "admin" });
    }
  });

  it("rejects a missing user id", () => {
    const parsed = RoleChangeSchema.safeParse({ userId: "  ", role: "admin" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(firstRoleChangeIssue(parsed.error)).toBe(
        "Choose a teammate to update.",
      );
    }
  });

  it("rejects an unknown role", () => {
    const parsed = RoleChangeSchema.safeParse({
      userId: MEMBER_ID,
      role: "superadmin",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(firstRoleChangeIssue(parsed.error)).toBe("Choose a role.");
    }
  });
});

// ── wouldRemoveLastAdmin ──────────────────────────────────────────────────────

describe("wouldRemoveLastAdmin", () => {
  const oneAdmin = [
    { id: ADMIN_ID, role: "admin" as const },
    { id: MEMBER_ID, role: "member" as const },
  ];
  const twoAdmins = [
    { id: ADMIN_ID, role: "admin" as const },
    { id: ADMIN2_ID, role: "admin" as const },
  ];

  it("blocks demoting the sole admin", () => {
    expect(wouldRemoveLastAdmin(oneAdmin, ADMIN_ID, "member")).toBe(true);
  });

  it("allows demoting an admin when another admin remains", () => {
    expect(wouldRemoveLastAdmin(twoAdmins, ADMIN_ID, "member")).toBe(false);
  });

  it("never blocks a promotion", () => {
    expect(wouldRemoveLastAdmin(oneAdmin, MEMBER_ID, "admin")).toBe(false);
  });

  it("does not fire for a target that isn't currently an admin", () => {
    expect(wouldRemoveLastAdmin(oneAdmin, MEMBER_ID, "member")).toBe(false);
  });

  it("does not fire for an unknown target", () => {
    expect(wouldRemoveLastAdmin(oneAdmin, STRANGER_ID, "member")).toBe(false);
  });
});

// ── nextRole / roleActionLabel ────────────────────────────────────────────────

describe("role toggle helpers", () => {
  it("toggles the role", () => {
    expect(nextRole("admin")).toBe("member");
    expect(nextRole("member")).toBe("admin");
  });

  it("labels the toggle action from the current role", () => {
    expect(roleActionLabel("admin")).toBe("Make member");
    expect(roleActionLabel("member")).toBe("Make admin");
  });
});

// ── changeMemberRole (core) ───────────────────────────────────────────────────

describe("changeMemberRole", () => {
  it("promotes a member to admin, scoped to the session company", async () => {
    const listMembers = vi.fn(async () => roster());
    const update = vi.fn(
      async (p: { companyId: string; userId: string; role: UserRole }) =>
        userRow({ id: p.userId, role: p.role, email: "member@acme.test" }),
    );

    const result = await changeMemberRole({
      session: session("admin"),
      input: { userId: MEMBER_ID, role: "admin" },
      listMembers,
      update,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(200);
      expect(result.changed).toBe(true);
      expect(result.user.role).toBe("admin");
    }
    // Tenancy: company id came from the session, never client input.
    expect(update).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      userId: MEMBER_ID,
      role: "admin",
    });
  });

  it("demotes an admin to member when another admin remains", async () => {
    const members = [
      userRow({ id: ADMIN_ID, role: "admin" }),
      userRow({ id: ADMIN2_ID, role: "admin", email: "admin2@acme.test" }),
    ];
    const listMembers = vi.fn(async () => members);
    const update = vi.fn(
      async (p: { companyId: string; userId: string; role: UserRole }) =>
        userRow({ id: p.userId, role: p.role, email: "admin2@acme.test" }),
    );

    const result = await changeMemberRole({
      session: session("admin"),
      input: { userId: ADMIN2_ID, role: "member" },
      listMembers,
      update,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.role).toBe("member");
    expect(update).toHaveBeenCalledOnce();
  });

  it("refuses an unauthenticated caller with 401 and never reads or writes", async () => {
    const listMembers = vi.fn();
    const update = vi.fn();
    const result = await changeMemberRole({
      session: null,
      input: { userId: MEMBER_ID, role: "admin" },
      listMembers,
      update,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
    expect(listMembers).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses a member with 403 and never reads or writes (admin-only)", async () => {
    const listMembers = vi.fn();
    const update = vi.fn();
    const result = await changeMemberRole({
      session: session("member"),
      input: { userId: ADMIN_ID, role: "member" },
      listMembers,
      update,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
    expect(listMembers).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects invalid input with 400 before any read", async () => {
    const listMembers = vi.fn();
    const update = vi.fn();
    const result = await changeMemberRole({
      session: session("admin"),
      input: { userId: "", role: "admin" },
      listMembers,
      update,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
    expect(listMembers).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("returns 404 for a user not on the caller's team, and never writes", async () => {
    const listMembers = vi.fn(async () => roster());
    const update = vi.fn();
    const result = await changeMemberRole({
      session: session("admin"),
      input: { userId: STRANGER_ID, role: "admin" },
      listMembers,
      update,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });

  it("is an idempotent no-op when the target already has the role (no write)", async () => {
    const listMembers = vi.fn(async () => roster());
    const update = vi.fn();
    const result = await changeMemberRole({
      session: session("admin"),
      input: { userId: MEMBER_ID, role: "member" },
      listMembers,
      update,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(200);
      expect(result.changed).toBe(false);
    }
    expect(update).not.toHaveBeenCalled();
  });

  it("blocks demoting the last admin with 409 and never writes", async () => {
    const listMembers = vi.fn(async () => roster()); // ADMIN_ID is the only admin
    const update = vi.fn();
    const result = await changeMemberRole({
      session: session("admin"),
      input: { userId: ADMIN_ID, role: "member" },
      listMembers,
      update,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toContain("last admin");
    }
    expect(update).not.toHaveBeenCalled();
  });

  it("maps a roster read failure to 500 with a plain message (no leak)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const listMembers = vi.fn(async () => {
      throw new Error("db.listUsersByCompany failed [42501]: permission denied");
    });
    const update = vi.fn();
    const result = await changeMemberRole({
      session: session("admin"),
      input: { userId: MEMBER_ID, role: "admin" },
      listMembers,
      update,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).toBe("We couldn't update that role. Please try again.");
      expect(result.error).not.toContain("permission denied");
    }
    expect(update).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("maps a write failure to 500 with a plain message (no leak)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const listMembers = vi.fn(async () => roster());
    const update = vi.fn(async () => {
      throw new Error("db.updateUserRole failed [23505]: conflict");
    });
    const result = await changeMemberRole({
      session: session("admin"),
      input: { userId: MEMBER_ID, role: "admin" },
      listMembers,
      update,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).not.toContain("conflict");
    }
    errorSpy.mockRestore();
  });
});
