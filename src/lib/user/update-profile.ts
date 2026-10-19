/**
 * Update-user-profile core (DailyPlan Day 51).
 *
 * Kept out of the server action (like `update-settings.ts` / `update-role.ts`)
 * so the decision logic is unit-testable without Next's request plumbing or a
 * live database: identity and the DB write are injected. The action wires the
 * real dependency (the service-role client, since `users` has no client write
 * policy — mirroring the Day 25 role-change write path).
 *
 * Authz + tenancy are non-negotiable (Rules.md §5): only an authenticated user
 * may save a profile (401 fail closed), and — unlike the admin-only company
 * settings — this is a *self-edit*, so there is no target to resolve: the write
 * is scoped to the session user's own id + company id, never client input. A
 * caller can therefore only ever change their own row. An unchanged name is an
 * idempotent no-op so a resubmit doesn't issue a pointless write.
 */
import type { SessionContext } from "@/lib/auth/session";
import type { UserRow } from "@/types/db";
import {
  UserProfileSchema,
  firstProfileIssue,
  normalizeDisplayName,
} from "./profile";
import { logError, errorContext } from "@/lib/observability/logger";

export type UpdateProfileResult =
  | { ok: true; status: 200; user: UserRow; changed: boolean }
  | { ok: false; status: 400 | 401 | 500; error: string };

export interface UpdateProfileDeps {
  /** Server-resolved session, or null when unauthenticated. */
  session: SessionContext | null;
  /** Raw form input (validated here — untrusted). */
  input: { display_name: string };
  /**
   * Persist the new display name, wired to `updateUserDisplayName`; scoped by
   * the session user's id + company id (defense-in-depth, Rules.md §5).
   */
  update: (params: {
    companyId: string;
    userId: string;
    displayName: string | null;
  }) => Promise<UserRow>;
}

export async function updateUserProfile(
  deps: UpdateProfileDeps,
): Promise<UpdateProfileResult> {
  if (!deps.session) {
    return { ok: false, status: 401, error: "You must be signed in." };
  }

  const parsed = UserProfileSchema.safeParse(deps.input);
  if (!parsed.success) {
    return { ok: false, status: 400, error: firstProfileIssue(parsed.error) };
  }
  const displayName = normalizeDisplayName(parsed.data.display_name);

  const { authUserId: userId, companyId } = deps.session;

  // Idempotent no-op: the name is already what was submitted, so skip the write.
  const current = deps.session.displayName ?? null;
  if (current === displayName) {
    // Reflect the current session row back without a write.
    return {
      ok: true,
      status: 200,
      user: sessionUser(deps.session, displayName),
      changed: false,
    };
  }

  let user: UserRow;
  try {
    user = await deps.update({ companyId, userId, displayName });
  } catch (err) {
    // Redacted log; plain user message (Rules.md §6).
    logError("user profile update failed", {
      op: "updateUserProfile/update",
      companyId,
      userId,
      ...errorContext(err),
    });
    return {
      ok: false,
      status: 500,
      error: "We couldn't save your profile. Please try again.",
    };
  }

  return { ok: true, status: 200, user, changed: true };
}

/**
 * Build a `UserRow` view from the session for the no-op path. The session
 * doesn't carry the full row (only the fields it needs), so `created_at` is left
 * empty — callers on the no-op path only read the identity + display name.
 */
function sessionUser(
  session: SessionContext,
  displayName: string | null,
): UserRow {
  return {
    id: session.authUserId,
    company_id: session.companyId,
    email: session.email,
    role: session.role,
    display_name: displayName,
    created_at: "",
  };
}
