import { describe, it, expect, vi } from "vitest";
import type { SessionContext } from "@/lib/auth/session";
import { acceptInvitation } from "@/lib/company/accept-invitation";
import { createInvitation } from "@/lib/company/create-invitation";
import { getInvitationsForCompany } from "@/lib/company/read-invitations";
import {
  CreateInvitationSchema,
  formatInviteDate,
  generateInviteToken,
  hashInviteToken,
  inviteAcceptPath,
  inviteAcceptUrl,
  inviteExpiresAt,
  invitationEmailMatches,
  invitationState,
  invitationStateLabel,
  isInvitationAcceptable,
  toInvitationList,
  toInvitationView,
} from "@/lib/company/invitations";
import type { CompanyRow, InvitationRow, UserRow } from "@/types/db";

/**
 * Team invitations (DailyPlan Day 24). Covers the pure token/lifecycle/schema
 * logic and the two injectable cores. The central guarantees proved are the
 * day's DoD — an invite token adds a member to the RIGHT company — plus the
 * authz/tenancy fences: only an admin invites, only the matching, unprovisioned,
 * signed-in address can accept, and an expired/used/revoked token can't. The
 * raw token is never stored — only its hash.
 */

const COMPANY_ID = "22222222-2222-2222-2222-222222222222";
const ADMIN_ID = "11111111-1111-1111-1111-111111111111";
const MEMBER_ID = "33333333-3333-3333-3333-333333333333";
const NEW_USER_ID = "44444444-4444-4444-4444-444444444444";
const NOW = new Date("2026-09-20T00:00:00.000Z");

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

function invitationRow(overrides: Partial<InvitationRow> = {}): InvitationRow {
  return {
    id: "inv-1",
    company_id: COMPANY_ID,
    email: "invitee@acme.test",
    role: "member",
    token_hash: hashInviteToken("raw-token"),
    status: "pending",
    invited_by: ADMIN_ID,
    expires_at: "2026-09-27T00:00:00.000Z",
    accepted_at: null,
    created_at: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

// ── token primitives ──────────────────────────────────────────────────────

describe("invite token primitives", () => {
  it("hashes a token deterministically and differently per input", () => {
    expect(hashInviteToken("abc")).toBe(hashInviteToken("abc"));
    expect(hashInviteToken("abc")).not.toBe(hashInviteToken("abd"));
    // SHA-256 hex is 64 chars.
    expect(hashInviteToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates a 64-char hex token, unique across calls", () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it("uses an injectable random source for determinism", () => {
    const fixed = Buffer.alloc(32, 7);
    expect(generateInviteToken(() => fixed)).toBe("07".repeat(32));
  });

  it("computes an expiry 7 days out", () => {
    expect(inviteExpiresAt(NOW)).toBe("2026-09-27T00:00:00.000Z");
  });

  it("builds accept paths and absolute URLs", () => {
    expect(inviteAcceptPath("tok")).toBe("/invite/tok");
    expect(inviteAcceptUrl("tok", "https://app.test")).toBe(
      "https://app.test/invite/tok",
    );
    // Trailing slash trimmed; missing base falls back to the path.
    expect(inviteAcceptUrl("tok", "https://app.test/")).toBe(
      "https://app.test/invite/tok",
    );
    expect(inviteAcceptUrl("tok")).toBe("/invite/tok");
    expect(inviteAcceptUrl("tok", null)).toBe("/invite/tok");
  });
});

// ── schema ────────────────────────────────────────────────────────────────

describe("CreateInvitationSchema", () => {
  it("trims + lowercases the email and accepts a valid role", () => {
    const parsed = CreateInvitationSchema.parse({
      email: "  Person@Acme.TEST ",
      role: "admin",
    });
    expect(parsed).toEqual({ email: "person@acme.test", role: "admin" });
  });

  it("rejects a bad email and an unknown role", () => {
    expect(CreateInvitationSchema.safeParse({ email: "nope", role: "member" }).success).toBe(false);
    expect(CreateInvitationSchema.safeParse({ email: "a@b.co", role: "owner" }).success).toBe(false);
  });
});

// ── lifecycle predicates ───────────────────────────────────────────────────

describe("invitationState / acceptability", () => {
  it("is pending before expiry", () => {
    expect(invitationState(invitationRow(), NOW)).toBe("pending");
    expect(isInvitationAcceptable(invitationRow(), NOW)).toBe(true);
  });

  it("is expired once expires_at passes (fail closed on unparseable)", () => {
    expect(
      invitationState(invitationRow({ expires_at: "2026-09-19T00:00:00.000Z" }), NOW),
    ).toBe("expired");
    expect(invitationState(invitationRow({ expires_at: "not-a-date" }), NOW)).toBe(
      "expired",
    );
    expect(isInvitationAcceptable(invitationRow({ expires_at: "2026-09-19T00:00:00.000Z" }), NOW)).toBe(false);
  });

  it("reflects accepted / revoked regardless of expiry", () => {
    expect(invitationState(invitationRow({ status: "accepted" }), NOW)).toBe("accepted");
    expect(invitationState(invitationRow({ status: "revoked" }), NOW)).toBe("revoked");
  });

  it("matches the target email case-insensitively", () => {
    expect(invitationEmailMatches(invitationRow(), "INVITEE@acme.test")).toBe(true);
    expect(invitationEmailMatches(invitationRow(), " invitee@acme.test ")).toBe(true);
    expect(invitationEmailMatches(invitationRow(), "someone@else.test")).toBe(false);
  });
});

// ── view helpers ───────────────────────────────────────────────────────────

describe("invitation view helpers", () => {
  it("labels each state", () => {
    expect(invitationStateLabel("pending")).toBe("Pending");
    expect(invitationStateLabel("expired")).toBe("Expired");
    expect(invitationStateLabel("accepted")).toBe("Accepted");
    expect(invitationStateLabel("revoked")).toBe("Revoked");
  });

  it("formats dates deterministically (UTC parts)", () => {
    expect(formatInviteDate("2026-09-20T00:00:00.000Z")).toBe("Sep 20, 2026");
  });

  it("projects a row into a view", () => {
    const view = toInvitationView(invitationRow(), NOW);
    expect(view).toMatchObject({
      email: "invitee@acme.test",
      role: "member",
      roleLabel: "Member",
      state: "pending",
      stateLabel: "Pending",
    });
    // The token/hash is never surfaced in the view-model.
    expect(JSON.stringify(view)).not.toContain(invitationRow().token_hash);
  });

  it("orders actionable invites first, newest within a group", () => {
    const rows = [
      invitationRow({ id: "accepted", status: "accepted", created_at: "2026-09-10T00:00:00.000Z" }),
      invitationRow({ id: "pending-old", created_at: "2026-09-18T00:00:00.000Z" }),
      invitationRow({ id: "expired", expires_at: "2026-09-01T00:00:00.000Z", created_at: "2026-09-01T00:00:00.000Z" }),
      invitationRow({ id: "pending-new", created_at: "2026-09-20T00:00:00.000Z" }),
    ];
    expect(toInvitationList(rows, NOW).map((r) => r.id)).toEqual([
      "pending-new",
      "pending-old",
      "expired",
      "accepted",
    ]);
  });
});

// ── createInvitation core ──────────────────────────────────────────────────

describe("createInvitation", () => {
  function deps(overrides: Partial<Parameters<typeof createInvitation>[0]> = {}) {
    return {
      session: session("admin"),
      input: { email: "new@acme.test", role: "member" },
      findMember: vi.fn(async () => null),
      insert: vi.fn(async (params) => invitationRow({ ...params, id: "inv-created" })),
      makeToken: () => "raw-token",
      now: NOW,
      ...overrides,
    } as Parameters<typeof createInvitation>[0];
  }

  it("creates an invite scoped to the session company, storing only the hash", async () => {
    const d = deps();
    const result = await createInvitation(d);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(201);
      expect(result.token).toBe("raw-token"); // raw token returned once
    }
    expect(d.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        company_id: COMPANY_ID, // from the session, never the client
        email: "new@acme.test",
        role: "member",
        token_hash: hashInviteToken("raw-token"),
        invited_by: ADMIN_ID,
        expires_at: inviteExpiresAt(NOW),
      }),
    );
    // The raw token is never handed to the DB.
    const inserted = (d.insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(inserted.token_hash).not.toBe("raw-token");
  });

  it("refuses an unauthenticated caller (401) and never writes", async () => {
    const d = deps({ session: null });
    const result = await createInvitation(d);
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(d.insert).not.toHaveBeenCalled();
  });

  it("refuses a member (403, admin-only) and never writes", async () => {
    const d = deps({ session: session("member") });
    const result = await createInvitation(d);
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(d.insert).not.toHaveBeenCalled();
  });

  it("rejects a malformed email (400) before any lookup/write", async () => {
    const d = deps({ input: { email: "not-an-email", role: "member" } });
    const result = await createInvitation(d);
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(d.findMember).not.toHaveBeenCalled();
    expect(d.insert).not.toHaveBeenCalled();
  });

  it("blocks inviting an existing team member (409)", async () => {
    const existing: UserRow = {
      id: MEMBER_ID,
      company_id: COMPANY_ID,
      email: "new@acme.test",
      role: "member",
      created_at: "2026-09-01T00:00:00.000Z",
    };
    const d = deps({ findMember: vi.fn(async () => existing) });
    const result = await createInvitation(d);
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(d.insert).not.toHaveBeenCalled();
  });

  it("maps a write failure to 500 with a redacted message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps({
      insert: vi.fn(async () => {
        throw new Error("db.insertInvitation failed [23505]: duplicate key");
      }),
    });
    const result = await createInvitation(d);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).not.toContain("duplicate key");
    }
    spy.mockRestore();
  });
});

// ── acceptInvitation core (the DoD) ────────────────────────────────────────

describe("acceptInvitation", () => {
  function deps(overrides: Partial<Parameters<typeof acceptInvitation>[0]> = {}) {
    return {
      auth: { userId: NEW_USER_ID, email: "invitee@acme.test" },
      tokenHash: hashInviteToken("raw-token"),
      lookup: vi.fn(async () => invitationRow()),
      findExistingUser: vi.fn(async () => null),
      join: vi.fn(async (params) => ({
        id: params.id,
        company_id: params.company_id,
        email: params.email,
        role: params.role,
        created_at: NOW.toISOString(),
      })),
      markAccepted: vi.fn(async () => invitationRow({ status: "accepted" })),
      now: NOW,
      ...overrides,
    } as Parameters<typeof acceptInvitation>[0];
  }

  it("adds the member to the invite's company with the invite's role (DoD)", async () => {
    const d = deps();
    const result = await acceptInvitation(d);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(200);
      expect(result.companyId).toBe(COMPANY_ID);
      expect(result.role).toBe("member");
    }
    expect(d.join).toHaveBeenCalledWith({
      id: NEW_USER_ID,
      company_id: COMPANY_ID, // the INVITE's company, not any client value
      email: "invitee@acme.test",
      role: "member",
    });
    expect(d.markAccepted).toHaveBeenCalledWith("inv-1");
  });

  it("honors an admin-role invite", async () => {
    const d = deps({ lookup: vi.fn(async () => invitationRow({ role: "admin" })) });
    const result = await acceptInvitation(d);
    if (result.ok) expect(result.role).toBe("admin");
    expect(d.join).toHaveBeenCalledWith(expect.objectContaining({ role: "admin" }));
  });

  it("refuses an unauthenticated caller (401), never looks up", async () => {
    const d = deps({ auth: null });
    const result = await acceptInvitation(d);
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(d.lookup).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown token, never joins", async () => {
    const d = deps({ lookup: vi.fn(async () => null) });
    const result = await acceptInvitation(d);
    expect(result).toMatchObject({ ok: false, status: 404, reason: "not-found" });
    expect(d.join).not.toHaveBeenCalled();
  });

  it("rejects an expired invite (410), never joins", async () => {
    const d = deps({
      lookup: vi.fn(async () => invitationRow({ expires_at: "2026-09-01T00:00:00.000Z" })),
    });
    const result = await acceptInvitation(d);
    expect(result).toMatchObject({ ok: false, status: 410, reason: "expired" });
    expect(d.join).not.toHaveBeenCalled();
  });

  it("rejects an already-used invite (410)", async () => {
    const d = deps({ lookup: vi.fn(async () => invitationRow({ status: "accepted" })) });
    const result = await acceptInvitation(d);
    expect(result).toMatchObject({ ok: false, status: 410, reason: "already-accepted" });
  });

  it("rejects a revoked invite (410)", async () => {
    const d = deps({ lookup: vi.fn(async () => invitationRow({ status: "revoked" })) });
    const result = await acceptInvitation(d);
    expect(result).toMatchObject({ ok: false, status: 410, reason: "revoked" });
  });

  it("rejects a mismatched account email (403), never joins", async () => {
    const d = deps({ auth: { userId: NEW_USER_ID, email: "someone@else.test" } });
    const result = await acceptInvitation(d);
    expect(result).toMatchObject({ ok: false, status: 403, reason: "email-mismatch" });
    expect(d.join).not.toHaveBeenCalled();
  });

  it("refuses a user who already belongs to a company (409), never joins", async () => {
    const existing: UserRow = {
      id: NEW_USER_ID,
      company_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      email: "invitee@acme.test",
      role: "member",
      created_at: "2026-09-01T00:00:00.000Z",
    };
    const d = deps({ findExistingUser: vi.fn(async () => existing) });
    const result = await acceptInvitation(d);
    expect(result).toMatchObject({ ok: false, status: 409, reason: "already-member" });
    expect(d.join).not.toHaveBeenCalled();
  });

  it("still reports success if the accept-stamp fails after the join", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps({
      markAccepted: vi.fn(async () => {
        throw new Error("db.markInvitationAccepted failed");
      }),
    });
    const result = await acceptInvitation(d);
    expect(result.ok).toBe(true); // the member exists — the DoD is met
    expect(d.join).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("maps a join failure to 500 with a redacted message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps({
      join: vi.fn(async () => {
        throw new Error("db.insertUser failed [23503]: fk violation");
      }),
    });
    const result = await acceptInvitation(d);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).not.toContain("fk violation");
    }
    spy.mockRestore();
  });
});

// ── read-invitations core ──────────────────────────────────────────────────

describe("getInvitationsForCompany", () => {
  it("returns the company's invitations for an admin, scoped to the session", async () => {
    const list = vi.fn(async () => [invitationRow()]);
    const result = await getInvitationsForCompany({ session: session("admin"), list });
    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(list).toHaveBeenCalledWith(COMPANY_ID);
  });

  it("refuses an unauthenticated caller (401) and never queries", async () => {
    const list = vi.fn();
    const result = await getInvitationsForCompany({ session: null, list });
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(list).not.toHaveBeenCalled();
  });

  it("refuses a member (403, admin-only) and never queries", async () => {
    const list = vi.fn();
    const result = await getInvitationsForCompany({ session: session("member"), list });
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(list).not.toHaveBeenCalled();
  });

  it("maps a query failure to 500 without leaking detail", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const list = vi.fn(async () => {
      throw new Error("db.listInvitationsByCompany failed [42501]: permission denied");
    });
    const result = await getInvitationsForCompany({ session: session("admin"), list });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).not.toContain("permission denied");
    }
    spy.mockRestore();
  });
});
