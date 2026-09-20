/**
 * Create-invitation core (DailyPlan Day 24).
 *
 * Kept out of the server action (like `read-team.ts`) so the decision logic is
 * unit-testable without Next's request plumbing or a live database: identity,
 * the duplicate-member check, the token generator, and the DB write are all
 * injected. The action wires the real dependencies (service-role client, Node
 * CSPRNG) and turns the returned raw token into a link.
 *
 * Authz + tenancy are non-negotiable (Rules.md §5): only an authenticated admin
 * may invite (401/403 fail closed), and the invite's `company_id`/`invited_by`
 * come from the server-resolved session — never client input. The raw token is
 * returned to the caller ONCE (for the emailed/displayed link) and only its
 * hash is ever persisted (Rules.md §4).
 */
import type { SessionContext } from "@/lib/auth/session";
import type { InvitationRow, UserRow } from "@/types/db";
import {
  CreateInvitationSchema,
  firstInvitationIssue,
  generateInviteToken,
  hashInviteToken,
  inviteExpiresAt,
} from "./invitations";

export type CreateInvitationResult =
  | {
      ok: true;
      status: 201;
      invitation: InvitationRow;
      /** The raw token — surfaced once so the caller can build the link. */
      token: string;
    }
  | { ok: false; status: 400 | 401 | 403 | 409 | 500; error: string };

export interface CreateInvitationDeps {
  /** Server-resolved session, or null when unauthenticated. */
  session: SessionContext | null;
  /** Raw form input (validated here — untrusted). */
  input: { email: string; role: string };
  /** Existing-member lookup, wired to `findCompanyMemberByEmail`. */
  findMember: (companyId: string, email: string) => Promise<UserRow | null>;
  /** Persist the invitation, wired to `insertInvitation`. */
  insert: (params: {
    company_id: string;
    email: string;
    role: "admin" | "member";
    token_hash: string;
    invited_by: string;
    expires_at: string;
  }) => Promise<InvitationRow>;
  /** Injectable so tests are deterministic; defaults to a fresh random token. */
  makeToken?: () => string;
  /** Injectable clock for the expiry stamp. */
  now?: Date;
}

export async function createInvitation(
  deps: CreateInvitationDeps,
): Promise<CreateInvitationResult> {
  if (!deps.session) {
    return { ok: false, status: 401, error: "You must be signed in." };
  }
  if (deps.session.role !== "admin") {
    // Only admins manage the team (Rules.md §5); enforced on the server.
    return {
      ok: false,
      status: 403,
      error: "Only an admin can invite teammates.",
    };
  }

  const parsed = CreateInvitationSchema.safeParse(deps.input);
  if (!parsed.success) {
    return { ok: false, status: 400, error: firstInvitationIssue(parsed.error) };
  }
  const { email, role } = parsed.data;

  const companyId = deps.session.companyId;

  let existing: UserRow | null;
  try {
    existing = await deps.findMember(companyId, email);
  } catch (err) {
    return failure("createInvitation/findMember", companyId, err);
  }
  if (existing) {
    return {
      ok: false,
      status: 409,
      error: "That person is already on your team.",
    };
  }

  const token = (deps.makeToken ?? generateInviteToken)();
  const now = deps.now ?? new Date();

  let invitation: InvitationRow;
  try {
    invitation = await deps.insert({
      company_id: companyId,
      email,
      role,
      token_hash: hashInviteToken(token),
      invited_by: deps.session.authUserId,
      expires_at: inviteExpiresAt(now),
    });
  } catch (err) {
    return failure("createInvitation/insert", companyId, err);
  }

  return { ok: true, status: 201, invitation, token };
}

function failure(
  op: string,
  companyId: string,
  err: unknown,
): CreateInvitationResult {
  // Redacted log; plain user message (Rules.md §6).
  console.error("invitation create failed", {
    op,
    companyId,
    message: err instanceof Error ? err.message : "unknown error",
  });
  return {
    ok: false,
    status: 500,
    error: "We couldn't send that invitation. Please try again.",
  };
}
