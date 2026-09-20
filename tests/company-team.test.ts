import { describe, it, expect, vi } from "vitest";
import type { SessionContext } from "@/lib/auth/session";
import { getTeamForCompany } from "@/lib/company/read-team";
import {
  formatJoinedDate,
  roleLabel,
  summarizeTeam,
  toTeamMember,
  toTeamRoster,
} from "@/lib/company/team-view";
import type { CompanyRow, UserRow } from "@/types/db";

/**
 * Team management (DailyPlan Day 23). Tests the pure view helpers (role labels,
 * the ordered roster, member counts) and the injectable read core. The central
 * guarantees proved are tenancy + authz: the company comes from the session and
 * is passed to the query, and a non-admin caller is refused (403) so the roster
 * never leaks — even if the page gate were bypassed. The page + component wire
 * these on top and (like the other server pages) aren't unit-tested here.
 */

const COMPANY_ID = "22222222-2222-2222-2222-222222222222";
const ADMIN_ID = "11111111-1111-1111-1111-111111111111";
const MEMBER_ID = "33333333-3333-3333-3333-333333333333";

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

function session(role: "admin" | "member" = "admin"): SessionContext {
  return {
    authUserId: role === "admin" ? ADMIN_ID : MEMBER_ID,
    email: role === "admin" ? "admin@acme.test" : "member@acme.test",
    companyId: COMPANY_ID,
    role,
    company: COMPANY,
  };
}

// ── roleLabel ───────────────────────────────────────────────────────────────

describe("roleLabel", () => {
  it("labels each role", () => {
    expect(roleLabel("admin")).toBe("Admin");
    expect(roleLabel("member")).toBe("Member");
  });
});

// ── formatJoinedDate ──────────────────────────────────────────────────────────

describe("formatJoinedDate", () => {
  it("formats a joined date deterministically (UTC parts)", () => {
    expect(formatJoinedDate("2026-08-31T00:00:00.000Z")).toBe("Aug 31, 2026");
  });

  it("degrades an unparseable value rather than showing Invalid Date", () => {
    expect(formatJoinedDate("not-a-date")).toBe("Unknown date");
  });
});

// ── toTeamMember ──────────────────────────────────────────────────────────────

describe("toTeamMember", () => {
  it("projects a row and marks the current user", () => {
    const view = toTeamMember(userRow(), ADMIN_ID);
    expect(view).toEqual({
      id: ADMIN_ID,
      email: "admin@acme.test",
      role: "admin",
      roleLabel: "Admin",
      joined: "Aug 31, 2026",
      isCurrentUser: true,
    });
  });

  it("does not mark other users as the current user", () => {
    const view = toTeamMember(userRow({ id: MEMBER_ID, role: "member" }), ADMIN_ID);
    expect(view.isCurrentUser).toBe(false);
    expect(view.roleLabel).toBe("Member");
  });
});

// ── toTeamRoster ──────────────────────────────────────────────────────────────

describe("toTeamRoster", () => {
  it("orders admins first, then earliest-joined within each role", () => {
    const users: UserRow[] = [
      userRow({
        id: MEMBER_ID,
        role: "member",
        email: "early-member@acme.test",
        created_at: "2026-09-01T00:00:00.000Z",
      }),
      userRow({
        id: "aaaa1111-1111-1111-1111-111111111111",
        role: "admin",
        email: "late-admin@acme.test",
        created_at: "2026-09-05T00:00:00.000Z",
      }),
      userRow({
        id: ADMIN_ID,
        role: "admin",
        email: "early-admin@acme.test",
        created_at: "2026-08-31T00:00:00.000Z",
      }),
      userRow({
        id: "bbbb2222-2222-2222-2222-222222222222",
        role: "member",
        email: "late-member@acme.test",
        created_at: "2026-09-10T00:00:00.000Z",
      }),
    ];

    const roster = toTeamRoster(users, ADMIN_ID);

    expect(roster.map((r) => r.email)).toEqual([
      "early-admin@acme.test",
      "late-admin@acme.test",
      "early-member@acme.test",
      "late-member@acme.test",
    ]);
    // Order is a pure function of the data, not the input order.
    expect(roster[0].isCurrentUser).toBe(true);
  });

  it("does not mutate the input array", () => {
    const users = [
      userRow({ id: MEMBER_ID, role: "member", created_at: "2026-09-01T00:00:00.000Z" }),
      userRow({ id: ADMIN_ID, role: "admin", created_at: "2026-08-31T00:00:00.000Z" }),
    ];
    const before = users.map((u) => u.id);
    toTeamRoster(users, ADMIN_ID);
    expect(users.map((u) => u.id)).toEqual(before);
  });
});

// ── summarizeTeam ─────────────────────────────────────────────────────────────

describe("summarizeTeam", () => {
  it("counts total, admins, and members", () => {
    const users = [
      userRow({ id: ADMIN_ID, role: "admin" }),
      userRow({ id: MEMBER_ID, role: "member" }),
      userRow({ id: "cccc3333-3333-3333-3333-333333333333", role: "member" }),
    ];
    expect(summarizeTeam(users)).toEqual({ total: 3, admins: 1, members: 2 });
  });

  it("handles an empty roster", () => {
    expect(summarizeTeam([])).toEqual({ total: 0, admins: 0, members: 0 });
  });
});

// ── getTeamForCompany (read core) ─────────────────────────────────────────────

describe("getTeamForCompany", () => {
  it("returns the company's members for an admin, scoped to the session company", async () => {
    const list = vi.fn(async (_companyId: string): Promise<UserRow[]> => [
      userRow(),
      userRow({ id: MEMBER_ID, role: "member", email: "member@acme.test" }),
    ]);

    const result = await getTeamForCompany({ session: session("admin"), list });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(200);
      expect(result.members).toHaveLength(2);
    }
    // Tenancy: the company id came from the session, never a client value.
    expect(list).toHaveBeenCalledOnce();
    expect(list).toHaveBeenCalledWith(COMPANY_ID);
  });

  it("refuses an unauthenticated caller with 401 and never queries", async () => {
    const list = vi.fn();
    const result = await getTeamForCompany({ session: null, list });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
    expect(list).not.toHaveBeenCalled();
  });

  it("refuses a member with 403 and never queries (admin-only, fail closed)", async () => {
    const list = vi.fn();
    const result = await getTeamForCompany({ session: session("member"), list });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
    expect(list).not.toHaveBeenCalled();
  });

  it("maps a query failure to 500 with a plain message (no leak)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const list = vi.fn(async () => {
      throw new Error("db.listUsersByCompany failed [42501]: permission denied");
    });

    const result = await getTeamForCompany({ session: session("admin"), list });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).toBe("We couldn't load your team. Please try again.");
      // The internal DB detail is not surfaced to the user.
      expect(result.error).not.toContain("permission denied");
    }
    errorSpy.mockRestore();
  });
});
