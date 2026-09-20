/**
 * Read core for the admin's invitation list (DailyPlan Day 24), mirroring
 * `read-team.ts`. Kept out of the page so the authz + tenancy mapping is
 * unit-testable with the session and the DB read injected.
 *
 * Admin-only and tenant-safe (Rules.md §5): the company comes from the
 * server-resolved session and is passed explicitly to the query; a missing
 * session is 401 and a non-admin is 403 (fail closed), so the pending invites —
 * which include invitee email addresses — never leak to a member or another
 * company.
 */
import type { SessionContext } from "@/lib/auth/session";
import type { InvitationRow } from "@/types/db";

export type GetInvitationsResult =
  | { ok: true; status: 200; invitations: InvitationRow[] }
  | { ok: false; status: 401 | 403 | 500; error: string };

export interface GetInvitationsDeps {
  session: SessionContext | null;
  /** List a company's invitations, wired to `listInvitationsByCompany`. */
  list: (companyId: string) => Promise<InvitationRow[]>;
}

export async function getInvitationsForCompany(
  deps: GetInvitationsDeps,
): Promise<GetInvitationsResult> {
  if (!deps.session) {
    return { ok: false, status: 401, error: "You must be signed in." };
  }
  if (deps.session.role !== "admin") {
    return {
      ok: false,
      status: 403,
      error: "Only an admin can manage invitations.",
    };
  }

  try {
    const invitations = await deps.list(deps.session.companyId);
    return { ok: true, status: 200, invitations };
  } catch (err) {
    console.error("invitation list failed", {
      op: "getInvitationsForCompany",
      companyId: deps.session.companyId,
      message: err instanceof Error ? err.message : "unknown error",
    });
    return {
      ok: false,
      status: 500,
      error: "We couldn't load your invitations. Please try again.",
    };
  }
}
