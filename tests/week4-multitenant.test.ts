import { describe, it, expect } from "vitest";
import type { SessionContext } from "@/lib/auth/session";
import { getTeamForCompany } from "@/lib/company/read-team";
import { getInvitationsForCompany } from "@/lib/company/read-invitations";
import { createInvitation } from "@/lib/company/create-invitation";
import { acceptInvitation } from "@/lib/company/accept-invitation";
import { changeMemberRole } from "@/lib/company/update-role";
import { saveBrandProfile } from "@/lib/company/save-brand-profile";
import { hashInviteToken } from "@/lib/company/invitations";
import type {
  BrandProfileRow,
  CompanyRow,
  InvitationRow,
  UserRole,
  UserRow,
} from "@/types/db";

/**
 * Week 4 hardening (DailyPlan Day 28) — multi-tenant lifecycle integration.
 *
 * The per-day suites (Days 22–27) inject narrow, single-purpose fakes into each
 * core in isolation. This suite is the missing end-to-end complement (mirroring
 * the Day 7 cross-tenant check and the Day 21 orchestrator integration suite):
 * it wires the REAL Week-4 cores — invite → accept, team read, role change,
 * brand-profile save, invitation list — against ONE shared, stateful in-memory
 * datastore holding TWO companies, and proves the multi-tenant-safety invariants
 * COMPOSE across the whole surface, not just per-core:
 *
 *  1. The invite → accept lifecycle adds the invitee to the INVITE'S company
 *     with the invite's role (Day 24 DoD), and the team read then reflects it.
 *  2. Cross-tenant isolation holds across cores: company B's admin can never
 *     see, target, or mutate company A's members, invitations, or brand guide —
 *     a foreign target is an indistinguishable 404 (never reveal cross-tenant
 *     existence, Rules.md §5/§6), and every write lands only in the caller's
 *     own company.
 *  3. The role lifecycle + no-lockout guard hold against real shared state:
 *     promote, self-demote-while-another-admin-exists, then the last-admin
 *     demotion is blocked (409).
 *  4. The invite token is a bound bearer credential: a mismatched-email redeem
 *     is 403 and a re-redeem of an accepted token is 410.
 *
 * All offline (no live model/DB) — the cores are the server-side trust boundary,
 * so exercising them together against one store is a faithful integration test.
 */

// ── stable ids ───────────────────────────────────────────────────────────────
const COMPANY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ADMIN_A = "a0000000-0000-0000-0000-000000000001";
const ADMIN_B = "b0000000-0000-0000-0000-000000000001";
const BOB = "bb000000-0000-0000-0000-000000000002";

/**
 * A minimal stateful datastore modelling the Week-4 tenant tables. Its methods
 * match the shapes the cores inject (queries.ts helpers), so the real cores run
 * unchanged. One store instance is shared across every core call in a test, so a
 * write by one core is visible to the next read — that shared state is exactly
 * what makes this an integration test rather than a bag of per-core mocks.
 */
class Store {
  companies = new Map<string, CompanyRow>();
  users = new Map<string, UserRow>();
  invitations = new Map<string, InvitationRow>();
  brandProfiles = new Map<string, BrandProfileRow>();
  private seq = 0;

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(4, "0")}`;
  }

  addCompany(id: string, overrides: Partial<CompanyRow> = {}): CompanyRow {
    const row: CompanyRow = {
      id,
      name: id === COMPANY_A ? "Acme" : "Beta",
      industry: "saas",
      plan_tier: "pro",
      juror_weights: null,
      onboarded_at: "2026-09-18T00:00:00.000Z",
      created_at: "2026-08-31T00:00:00.000Z",
      ...overrides,
    };
    this.companies.set(id, row);
    return row;
  }

  addUser(overrides: Partial<UserRow> & Pick<UserRow, "id" | "company_id" | "email">): UserRow {
    const row: UserRow = {
      role: "member",
      created_at: "2026-09-01T00:00:00.000Z",
      ...overrides,
    };
    this.users.set(row.id, row);
    return row;
  }

  // ── query-shaped operations (match queries.ts signatures) ──────────────────
  listUsersByCompany = async (companyId: string): Promise<UserRow[]> =>
    [...this.users.values()]
      .filter((u) => u.company_id === companyId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));

  findCompanyMemberByEmail = async (
    companyId: string,
    email: string,
  ): Promise<UserRow | null> =>
    [...this.users.values()].find(
      (u) =>
        u.company_id === companyId &&
        u.email.toLowerCase() === email.toLowerCase(),
    ) ?? null;

  insertInvitation = async (params: {
    company_id: string;
    email: string;
    role: UserRole;
    token_hash: string;
    invited_by: string;
    expires_at: string;
  }): Promise<InvitationRow> => {
    const row: InvitationRow = {
      id: this.nextId("inv"),
      status: "pending",
      accepted_at: null,
      created_at: "2026-09-22T00:00:00.000Z",
      ...params,
    };
    this.invitations.set(row.id, row);
    return row;
  };

  getInvitationByTokenHash = async (
    tokenHash: string,
  ): Promise<InvitationRow | null> =>
    [...this.invitations.values()].find((i) => i.token_hash === tokenHash) ??
    null;

  listInvitationsByCompany = async (
    companyId: string,
  ): Promise<InvitationRow[]> =>
    [...this.invitations.values()].filter((i) => i.company_id === companyId);

  markInvitationAccepted = async (id: string): Promise<InvitationRow> => {
    const row = this.invitations.get(id);
    if (!row) throw new Error("invitation not found");
    const updated: InvitationRow = {
      ...row,
      status: "accepted",
      accepted_at: "2026-09-22T01:00:00.000Z",
    };
    this.invitations.set(id, updated);
    return updated;
  };

  getUserById = async (id: string): Promise<UserRow | null> =>
    this.users.get(id) ?? null;

  join = async (params: {
    id: string;
    company_id: string;
    email: string;
    role: UserRole;
  }): Promise<UserRow> => this.addUser(params);

  // Scoped by BOTH id and company_id, exactly like updateUserRole in queries.ts:
  // a write handed a foreign company id must not touch another company's user.
  updateUserRole = async (params: {
    companyId: string;
    userId: string;
    role: UserRole;
  }): Promise<UserRow> => {
    const row = this.users.get(params.userId);
    if (!row || row.company_id !== params.companyId) {
      throw new Error("user not found in company");
    }
    const updated: UserRow = { ...row, role: params.role };
    this.users.set(params.userId, updated);
    return updated;
  };

  getBrandProfileByCompany = async (
    companyId: string,
  ): Promise<BrandProfileRow | null> =>
    [...this.brandProfiles.values()].find((b) => b.company_id === companyId) ??
    null;

  insertBrandProfile = async (params: {
    companyId: string;
    toneGuideText: string;
  }): Promise<BrandProfileRow> => {
    const row: BrandProfileRow = {
      id: this.nextId("bp"),
      company_id: params.companyId,
      tone_guide_text: params.toneGuideText,
      embedding_ref: null,
      updated_at: "2026-09-22T00:00:00.000Z",
    };
    this.brandProfiles.set(row.id, row);
    return row;
  };

  updateBrandProfile = async (params: {
    id: string;
    companyId: string;
    toneGuideText: string;
  }): Promise<BrandProfileRow> => {
    const row = this.brandProfiles.get(params.id);
    if (!row || row.company_id !== params.companyId) {
      throw new Error("brand profile not found in company");
    }
    const updated: BrandProfileRow = {
      ...row,
      tone_guide_text: params.toneGuideText,
      updated_at: "2026-09-23T00:00:00.000Z",
    };
    this.brandProfiles.set(params.id, updated);
    return updated;
  };
}

function session(store: Store, userId: string): SessionContext {
  const user = store.users.get(userId);
  if (!user) throw new Error(`no user ${userId}`);
  const company = store.companies.get(user.company_id);
  if (!company) throw new Error(`no company ${user.company_id}`);
  return {
    authUserId: user.id,
    email: user.email,
    companyId: company.id,
    role: user.role,
    company,
  };
}

/** Two onboarded companies, each with one admin. */
function seed(): Store {
  const store = new Store();
  store.addCompany(COMPANY_A);
  store.addCompany(COMPANY_B);
  store.addUser({ id: ADMIN_A, company_id: COMPANY_A, email: "admin@a.test", role: "admin" });
  store.addUser({ id: ADMIN_B, company_id: COMPANY_B, email: "admin@b.test", role: "admin" });
  return store;
}

// Deterministic invite tokens so we can compute their hashes for the accept step.
function inviteDeps(store: Store, adminSession: SessionContext, token: string) {
  return {
    session: adminSession,
    findMember: store.findCompanyMemberByEmail,
    insert: store.insertInvitation,
    makeToken: () => token,
    now: new Date("2026-09-22T00:00:00.000Z"),
  };
}

describe("Week 4 multi-tenant lifecycle (integration)", () => {
  it("invite → accept adds the invitee to the invite's company, then the team read reflects it", async () => {
    const store = seed();
    const adminA = session(store, ADMIN_A);

    // 1. Company A's admin invites Bob as a member.
    const created = await createInvitation({
      ...inviteDeps(store, adminA, "raw-token-bob"),
      input: { email: "bob@a.test", role: "member" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.invitation.company_id).toBe(COMPANY_A);
    // Only the hash is stored — never the raw bearer token (Rules.md §4).
    expect(created.invitation.token_hash).toBe(hashInviteToken("raw-token-bob"));
    expect(created.invitation.token_hash).not.toBe(created.token);

    // 2. Bob (a fresh auth user with no users row yet) accepts via the link.
    const accepted = await acceptInvitation({
      auth: { userId: BOB, email: "bob@a.test" },
      tokenHash: hashInviteToken(created.token),
      lookup: store.getInvitationByTokenHash,
      findExistingUser: store.getUserById,
      join: store.join,
      markAccepted: store.markInvitationAccepted,
      now: new Date("2026-09-22T02:00:00.000Z"),
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    // The DoD: joined the INVITE'S company with the invite's role.
    expect(accepted.companyId).toBe(COMPANY_A);
    expect(accepted.role).toBe("member");
    expect(store.users.get(BOB)?.company_id).toBe(COMPANY_A);
    // The invite is now consumed (marked accepted in shared state).
    expect(created.invitation.token_hash).toBeDefined();
    expect(
      (await store.getInvitationByTokenHash(created.invitation.token_hash))?.status,
    ).toBe("accepted");

    // 3. Company A's team read now lists both members; B's admin sees only B.
    const teamA = await getTeamForCompany({ session: adminA, list: store.listUsersByCompany });
    expect(teamA.ok).toBe(true);
    if (!teamA.ok) return;
    expect(teamA.members.map((m) => m.id).sort()).toEqual([ADMIN_A, BOB].sort());

    const teamB = await getTeamForCompany({
      session: session(store, ADMIN_B),
      list: store.listUsersByCompany,
    });
    expect(teamB.ok).toBe(true);
    if (!teamB.ok) return;
    expect(teamB.members.map((m) => m.id)).toEqual([ADMIN_B]);
  });

  it("a re-redeem of the accepted token is 410 and a mismatched email is 403", async () => {
    const store = seed();
    const created = await createInvitation({
      ...inviteDeps(store, session(store, ADMIN_A), "raw-token-bob"),
      input: { email: "bob@a.test", role: "member" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const acceptArgs = {
      tokenHash: hashInviteToken(created.token),
      lookup: store.getInvitationByTokenHash,
      findExistingUser: store.getUserById,
      join: store.join,
      markAccepted: store.markInvitationAccepted,
      now: new Date("2026-09-22T02:00:00.000Z"),
    };

    // A leaked link redeemed by the wrong account is refused (bound credential).
    const mismatch = await acceptInvitation({
      ...acceptArgs,
      auth: { userId: "cc000000-0000-0000-0000-000000000009", email: "mallory@evil.test" },
    });
    expect(mismatch.ok).toBe(false);
    if (mismatch.ok) return;
    expect(mismatch.status).toBe(403);
    expect(mismatch.reason).toBe("email-mismatch");

    // Bob accepts, then the same token can't be reused.
    const first = await acceptInvitation({ ...acceptArgs, auth: { userId: BOB, email: "bob@a.test" } });
    expect(first.ok).toBe(true);
    const second = await acceptInvitation({
      ...acceptArgs,
      auth: { userId: "dd000000-0000-0000-0000-000000000010", email: "bob@a.test" },
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.status).toBe(410);
    expect(second.reason).toBe("already-accepted");
  });

  it("cross-tenant: company B's admin cannot change a role on company A's member (404, no write)", async () => {
    const store = seed();
    store.addUser({ id: BOB, company_id: COMPANY_A, email: "bob@a.test", role: "member" });

    const result = await changeMemberRole({
      session: session(store, ADMIN_B),
      input: { userId: BOB, role: "admin" },
      listMembers: store.listUsersByCompany,
      update: store.updateUserRole,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Indistinguishable from absent — never reveal cross-tenant existence.
    expect(result.status).toBe(404);
    // The foreign member's role is untouched.
    expect(store.users.get(BOB)?.role).toBe("member");
  });

  it("role lifecycle: promote, self-demote with another admin, then last-admin demotion is blocked", async () => {
    const store = seed();
    store.addUser({ id: BOB, company_id: COMPANY_A, email: "bob@a.test", role: "member" });
    const adminA = session(store, ADMIN_A);

    // Promote Bob → now two admins in company A.
    const promote = await changeMemberRole({
      session: adminA,
      input: { userId: BOB, role: "admin" },
      listMembers: store.listUsersByCompany,
      update: store.updateUserRole,
    });
    expect(promote.ok).toBe(true);
    expect(store.users.get(BOB)?.role).toBe("admin");

    // Admin A steps down to member — allowed because Bob is still an admin.
    const selfDemote = await changeMemberRole({
      session: adminA,
      input: { userId: ADMIN_A, role: "member" },
      listMembers: store.listUsersByCompany,
      update: store.updateUserRole,
    });
    expect(selfDemote.ok).toBe(true);
    expect(store.users.get(ADMIN_A)?.role).toBe("member");

    // Now Bob is the sole admin. He demotes himself → blocked (no lockout).
    const lastAdmin = await changeMemberRole({
      session: session(store, BOB),
      input: { userId: BOB, role: "member" },
      listMembers: store.listUsersByCompany,
      update: store.updateUserRole,
    });
    expect(lastAdmin.ok).toBe(false);
    if (lastAdmin.ok) return;
    expect(lastAdmin.status).toBe(409);
    expect(store.users.get(BOB)?.role).toBe("admin");
  });

  it("cross-tenant: brand-profile saves land only in the caller's own company", async () => {
    const store = seed();
    const brandDeps = {
      getExisting: store.getBrandProfileByCompany,
      insert: store.insertBrandProfile,
      update: store.updateBrandProfile,
    };

    const saveA = await saveBrandProfile({
      session: session(store, ADMIN_A),
      input: { tone_guide_text: "Company A: measured, expert, never hype." },
      ...brandDeps,
    });
    expect(saveA.ok).toBe(true);
    if (!saveA.ok) return;
    expect(saveA.created).toBe(true);
    expect(saveA.profile.company_id).toBe(COMPANY_A);

    const saveB = await saveBrandProfile({
      session: session(store, ADMIN_B),
      input: { tone_guide_text: "Company B: playful, bold, punchy." },
      ...brandDeps,
    });
    expect(saveB.ok).toBe(true);
    if (!saveB.ok) return;
    expect(saveB.created).toBe(true);
    expect(saveB.profile.company_id).toBe(COMPANY_B);

    // Each company reads back only its own guide — no bleed.
    expect((await store.getBrandProfileByCompany(COMPANY_A))?.tone_guide_text).toContain("Company A");
    expect((await store.getBrandProfileByCompany(COMPANY_B))?.tone_guide_text).toContain("Company B");
    expect(store.brandProfiles.size).toBe(2);

    // A second save by A edits in place (create-or-edit), scoped to A only.
    const editA = await saveBrandProfile({
      session: session(store, ADMIN_A),
      input: { tone_guide_text: "Company A v2: calm, confident, decisive." },
      ...brandDeps,
    });
    expect(editA.ok).toBe(true);
    if (!editA.ok) return;
    expect(editA.created).toBe(false);
    expect(editA.profile.company_id).toBe(COMPANY_A);
    expect(store.brandProfiles.size).toBe(2);
    expect((await store.getBrandProfileByCompany(COMPANY_B))?.tone_guide_text).toContain("Company B");
  });

  it("cross-tenant: the invitation list is scoped to the caller's company", async () => {
    const store = seed();
    await createInvitation({
      ...inviteDeps(store, session(store, ADMIN_A), "token-a"),
      input: { email: "one@a.test", role: "member" },
    });
    await createInvitation({
      ...inviteDeps(store, session(store, ADMIN_B), "token-b"),
      input: { email: "one@b.test", role: "member" },
    });

    const listA = await getInvitationsForCompany({
      session: session(store, ADMIN_A),
      list: store.listInvitationsByCompany,
    });
    expect(listA.ok).toBe(true);
    if (!listA.ok) return;
    expect(listA.invitations.map((i) => i.email)).toEqual(["one@a.test"]);
    expect(listA.invitations.every((i) => i.company_id === COMPANY_A)).toBe(true);
  });
});
