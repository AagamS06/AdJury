/**
 * Change-member-role core (DailyPlan Day 25).
 *
 * Kept out of the server action (like `create-invitation.ts` / `read-team.ts`)
 * so the decision logic is unit-testable without Next's request plumbing or a
 * live database: identity, the roster read, and the DB write are injected. The
 * action wires the real dependencies (service-role client, since `users` has no
 * client write policy).
 *
 * Authz + tenancy are non-negotiable (Rules.md §5): only an authenticated admin
 * may change a role (401/403 fail closed), the target is resolved from the
 * company's own, session-scoped roster (a stranger reads as 404 — never reveal
 * cross-tenant existence, Rules.md §6), and the write is scoped to the
 * server-derived company id, never client input. A demotion that would remove
 * the company's last admin is blocked (409) so it can't lock itself out.
 */
import type { SessionContext } from "@/lib/auth/session";
import type { UserRole, UserRow } from "@/types/db";
import {
  RoleChangeSchema,
  firstRoleChangeIssue,
  wouldRemoveLastAdmin,
} from "./role-management";

export type ChangeRoleResult =
  | { ok: true; status: 200; user: UserRow; changed: boolean }
  | { ok: false; status: 400 | 401 | 403 | 404 | 409 | 500; error: string };

export interface ChangeRoleDeps {
  /** Server-resolved session, or null when unauthenticated. */
  session: SessionContext | null;
  /** Raw form input (validated here — untrusted). */
  input: { userId: string; role: string };
  /**
   * List the company's members, wired to `listUsersByCompany`. Used both to
   * resolve the target within the caller's company and to enforce the
   * last-admin guard; injectable so this logic is testable without a database.
   */
  listMembers: (companyId: string) => Promise<UserRow[]>;
  /** Persist the new role, wired to `updateUserRole`; company-scoped. */
  update: (params: {
    companyId: string;
    userId: string;
    role: UserRole;
  }) => Promise<UserRow>;
}

export async function changeMemberRole(
  deps: ChangeRoleDeps,
): Promise<ChangeRoleResult> {
  if (!deps.session) {
    return { ok: false, status: 401, error: "You must be signed in." };
  }
  if (deps.session.role !== "admin") {
    // Only admins manage roles (Rules.md §5); enforced on the server, not just
    // hidden in the UI. Never reveal the roster to a member.
    return {
      ok: false,
      status: 403,
      error: "Only an admin can change roles.",
    };
  }

  const parsed = RoleChangeSchema.safeParse(deps.input);
  if (!parsed.success) {
    return { ok: false, status: 400, error: firstRoleChangeIssue(parsed.error) };
  }
  const { userId, role } = parsed.data;

  const companyId = deps.session.companyId;

  let members: UserRow[];
  try {
    members = await deps.listMembers(companyId);
  } catch (err) {
    return failure("changeMemberRole/listMembers", companyId, err);
  }

  const target = members.find((m) => m.id === userId);
  if (!target) {
    // Absent OR another company's member — indistinguishable on purpose
    // (Rules.md §5/§6).
    return {
      ok: false,
      status: 404,
      error: "That teammate isn't on your team.",
    };
  }

  // Idempotent no-op: already the requested role, so skip the write.
  if (target.role === role) {
    return { ok: true, status: 200, user: target, changed: false };
  }

  if (wouldRemoveLastAdmin(members, userId, role)) {
    return {
      ok: false,
      status: 409,
      error:
        "You can't remove the last admin. Promote another teammate to admin first.",
    };
  }

  let user: UserRow;
  try {
    user = await deps.update({ companyId, userId, role });
  } catch (err) {
    return failure("changeMemberRole/update", companyId, err);
  }

  return { ok: true, status: 200, user, changed: true };
}

function failure(
  op: string,
  companyId: string,
  err: unknown,
): ChangeRoleResult {
  // Redacted log; plain user message (Rules.md §6).
  console.error("role change failed", {
    op,
    companyId,
    message: err instanceof Error ? err.message : "unknown error",
  });
  return {
    ok: false,
    status: 500,
    error: "We couldn't update that role. Please try again.",
  };
}
