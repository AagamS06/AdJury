/**
 * Accept-invitation core (DailyPlan Day 24) — the heart of "an invite token adds
 * a member to the right company" (the day's Definition of Done).
 *
 * Kept out of the server action / page so the decision logic is unit-testable
 * without Next or a live database: the auth identity, the invite lookup, the
 * existing-user check, the member insert, and the accept-stamp are all injected.
 *
 * Guarantees (Rules.md §5/§6, fail closed):
 *  - Only an authenticated caller may accept (else 401).
 *  - The token must resolve to a still-acceptable invite (pending, not expired) —
 *    an unknown token is 404 (never reveal which tokens exist), a used/expired/
 *    revoked one is 410.
 *  - The accepting account's email MUST match the invited email (else 403), so a
 *    leaked link can't be redeemed by a different account.
 *  - A caller who already belongs to a company is refused (409) — this model has
 *    one company per user, so we never silently move someone between tenants.
 *  - On success the member row is created in the INVITE'S company with the
 *    invite's role, and the invite is marked accepted.
 */
import type {
  InvitationRow,
  UserRole,
  UserRow,
} from "@/types/db";
import { invitationEmailMatches, invitationState } from "./invitations";

export type AcceptFailureReason =
  | "unauthenticated"
  | "not-found"
  | "expired"
  | "revoked"
  | "already-accepted"
  | "email-mismatch"
  | "already-member"
  | "error";

export type AcceptInvitationResult =
  | {
      ok: true;
      status: 200;
      companyId: string;
      role: UserRole;
      user: UserRow;
    }
  | {
      ok: false;
      status: 401 | 403 | 404 | 409 | 410 | 500;
      reason: AcceptFailureReason;
      error: string;
    };

export interface AcceptInvitationDeps {
  /** The authenticated Supabase user accepting the invite, or null. */
  auth: { userId: string; email: string } | null;
  /** SHA-256 hash of the presented raw token. */
  tokenHash: string;
  /** Resolve the invite by token hash, wired to `getInvitationByTokenHash`. */
  lookup: (tokenHash: string) => Promise<InvitationRow | null>;
  /** Whether this auth user already has a `users` row, wired to `getUserById`. */
  findExistingUser: (userId: string) => Promise<UserRow | null>;
  /** Insert the member row, wired to `insertUser`. */
  join: (params: {
    id: string;
    company_id: string;
    email: string;
    role: UserRole;
  }) => Promise<UserRow>;
  /** Mark the invite accepted, wired to `markInvitationAccepted`. */
  markAccepted: (id: string) => Promise<InvitationRow>;
  /** Injectable clock for the expiry check. */
  now?: Date;
}

export async function acceptInvitation(
  deps: AcceptInvitationDeps,
): Promise<AcceptInvitationResult> {
  if (!deps.auth) {
    return {
      ok: false,
      status: 401,
      reason: "unauthenticated",
      error: "Sign in or create an account to accept this invitation.",
    };
  }

  let invitation: InvitationRow | null;
  try {
    invitation = await deps.lookup(deps.tokenHash);
  } catch (err) {
    return failure("acceptInvitation/lookup", err);
  }
  if (!invitation) {
    return {
      ok: false,
      status: 404,
      reason: "not-found",
      error: "This invitation link isn't valid.",
    };
  }

  const now = deps.now ?? new Date();
  const state = invitationState(invitation, now);
  if (state !== "pending") {
    return notAcceptable(state);
  }

  if (!invitationEmailMatches(invitation, deps.auth.email)) {
    // The link is bound to a specific address (Rules.md §5 fail closed).
    return {
      ok: false,
      status: 403,
      reason: "email-mismatch",
      error:
        "This invitation was sent to a different email address. Sign in with that address to accept it.",
    };
  }

  // One company per user in this model: never move an existing member.
  let existing: UserRow | null;
  try {
    existing = await deps.findExistingUser(deps.auth.userId);
  } catch (err) {
    return failure("acceptInvitation/findExistingUser", err);
  }
  if (existing) {
    return {
      ok: false,
      status: 409,
      reason: "already-member",
      error: "Your account already belongs to a company.",
    };
  }

  let user: UserRow;
  try {
    user = await deps.join({
      id: deps.auth.userId,
      company_id: invitation.company_id,
      email: invitation.email,
      role: invitation.role,
    });
  } catch (err) {
    return failure("acceptInvitation/join", err);
  }

  // The member now exists (the DoD is met). Marking the invite accepted is a
  // bookkeeping follow-up: if it fails we log and still report success rather
  // than leaving the just-joined user in limbo (a re-accept would be caught by
  // the already-member guard above).
  try {
    await deps.markAccepted(invitation.id);
  } catch (err) {
    console.error("invitation accept: mark-accepted failed", {
      op: "acceptInvitation/markAccepted",
      invitationId: invitation.id,
      message: err instanceof Error ? err.message : "unknown error",
    });
  }

  return {
    ok: true,
    status: 200,
    companyId: invitation.company_id,
    role: invitation.role,
    user,
  };
}

function notAcceptable(
  state: "accepted" | "revoked" | "expired",
): AcceptInvitationResult {
  const map: Record<
    typeof state,
    { reason: AcceptFailureReason; error: string }
  > = {
    accepted: {
      reason: "already-accepted",
      error: "This invitation has already been used.",
    },
    revoked: {
      reason: "revoked",
      error: "This invitation is no longer active.",
    },
    expired: {
      reason: "expired",
      error: "This invitation has expired. Ask an admin to send a new one.",
    },
  };
  return { ok: false, status: 410, ...map[state] };
}

function failure(op: string, err: unknown): AcceptInvitationResult {
  console.error("invitation accept failed", {
    op,
    message: err instanceof Error ? err.message : "unknown error",
  });
  return {
    ok: false,
    status: 500,
    reason: "error",
    error: "We couldn't accept this invitation. Please try again.",
  };
}
