/**
 * Core logic for the team-management view (DailyPlan Day 23): list the company's
 * members and roles for an admin.
 *
 * Kept out of the page (like `read-reviews.ts`) so it is unit-testable without
 * Next's request plumbing or a live database: identity and the DB read are
 * injected. The page wires the real dependencies (a request-scoped anon client,
 * so RLS also constrains the read) and renders the outcome.
 *
 * Tenancy + authz are non-negotiable (Rules.md §5): the company is taken from
 * the server-resolved session and passed explicitly to the query, and team
 * management is admin-only — enforced HERE on the server, not just hidden in the
 * UI. A missing session reads as 401, a non-admin as 403 (fail closed on authz —
 * Rules.md §6), so the list can never leak another company's members or be read
 * by a member even if the page gate were bypassed.
 */
import type { SessionContext } from "@/lib/auth/session";
import type { UserRow } from "@/types/db";

export type GetTeamResult =
  | { ok: true; status: 200; members: UserRow[] }
  | { ok: false; status: 401 | 403 | 500; error: string };

export interface GetTeamDeps {
  /** Server-resolved session, or null when the caller is unauthenticated. */
  session: SessionContext | null;
  /**
   * List a company's users. Wired to `listUsersByCompany(db, companyId)`;
   * injectable so this logic is testable without a database.
   */
  list: (companyId: string) => Promise<UserRow[]>;
}

export async function getTeamForCompany(
  deps: GetTeamDeps,
): Promise<GetTeamResult> {
  if (!deps.session) {
    return { ok: false, status: 401, error: "You must be signed in." };
  }
  if (deps.session.role !== "admin") {
    // Admin-only surface (Rules.md §5); never reveal the roster to a member.
    return {
      ok: false,
      status: 403,
      error: "Only an admin can manage the team.",
    };
  }

  let members: UserRow[];
  try {
    members = await deps.list(deps.session.companyId);
  } catch (err) {
    console.error("team list failed", {
      op: "getTeamForCompany",
      companyId: deps.session.companyId,
      message: err instanceof Error ? err.message : "unknown error",
    });
    return {
      ok: false,
      status: 500,
      error: "We couldn't load your team. Please try again.",
    };
  }

  return { ok: true, status: 200, members };
}
