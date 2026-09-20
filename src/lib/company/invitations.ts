/**
 * Team invitations — pure domain logic (DailyPlan Day 24).
 *
 * An admin invites a teammate by email; the invitee follows a tokenised link
 * and joins the *existing* company (PRD §6.1 auth + roles; §6.2 team management).
 * This module owns the pieces that are unit-testable without a database, React,
 * or Next: the token primitives, the input contract, the lifecycle predicates,
 * and the display helpers. The DB writes live in `queries.ts`, the decision
 * logic in the injectable cores (`create-invitation.ts` / `accept-invitation.ts`
 * / `read-invitations.ts`), and the forms/pages in `components`/`app`.
 *
 * Security (Rules.md §4/§5): the raw token is a bearer credential — it is only
 * ever placed in the emailed link and NEVER stored. We persist a SHA-256 hash
 * (`token_hash`) and match by hashing the presented token, so a DB leak cannot
 * hand an attacker a usable invite. Tenancy (`company_id`) always comes from the
 * inviting admin's server session, never from client input.
 */
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { formatHistoryDate } from "@/lib/reviews/history-view";
import { roleLabel } from "@/lib/company/team-view";
import type { InvitationRow, UserRole } from "@/types/db";

/** Entropy for a raw invite token (32 bytes → 64 hex chars). */
export const INVITE_TOKEN_BYTES = 32;

/** How long an invite stays acceptable after it is created. */
export const INVITE_EXPIRY_DAYS = 7;
const INVITE_EXPIRY_MS = INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

/**
 * Generate a random, URL-safe invite token (hex). The random source is
 * injectable so tests can make it deterministic; production uses Node's CSPRNG.
 * This is the raw token that goes in the link — hash it with `hashInviteToken`
 * before storing.
 */
export function generateInviteToken(
  rng: (n: number) => Buffer = randomBytes,
): string {
  return rng(INVITE_TOKEN_BYTES).toString("hex");
}

/**
 * Hash a raw token to the value we store/compare (`token_hash`). Deterministic
 * and pure, so both the write and the lookup derive the same hash. SHA-256 is
 * sufficient for a high-entropy random token (no need for a slow KDF — there is
 * nothing to brute-force in 32 random bytes).
 */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** ISO expiry timestamp for an invite created at `now`. */
export function inviteExpiresAt(now: Date = new Date()): string {
  return new Date(now.getTime() + INVITE_EXPIRY_MS).toISOString();
}

/** The path an invitee visits to accept, carrying the raw token. */
export function inviteAcceptPath(token: string): string {
  return `/invite/${token}`;
}

/**
 * Absolute accept URL for the (stubbed) invite email. Falls back to the
 * relative path when no base URL is configured, so a missing env var never
 * throws — the admin still gets a usable, copyable link in the app.
 */
export function inviteAcceptUrl(
  token: string,
  baseUrl?: string | null,
): string {
  const path = inviteAcceptPath(token);
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

/**
 * Create-invitation input contract (Rules.md §3 — validate before trust). The
 * same schema guards the server action. `company_id`/`invited_by` are never part
 * of this — they are derived from the session server-side (Rules.md §5).
 */
export const CreateInvitationSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  role: z.enum(["admin", "member"], {
    errorMap: () => ({ message: "Choose a role." }),
  }),
});

export type CreateInvitationInput = z.infer<typeof CreateInvitationSchema>;

/** First human-readable validation message, for surfacing in the form. */
export function firstInvitationIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the form and try again.";
}

/**
 * Effective lifecycle state of an invite, folding expiry into the stored
 * status: a `pending` row whose `expires_at` has passed reads as `expired`.
 * Pure so the cores and the UI derive the same state.
 */
export type InvitationState = "pending" | "accepted" | "revoked" | "expired";

export function invitationState(
  invitation: Pick<InvitationRow, "status" | "expires_at">,
  now: Date = new Date(),
): InvitationState {
  if (invitation.status === "accepted") return "accepted";
  if (invitation.status === "revoked") return "revoked";
  // status === "pending"
  if (isExpired(invitation.expires_at, now)) return "expired";
  return "pending";
}

function isExpired(expiresAt: string, now: Date): boolean {
  const expiry = Date.parse(expiresAt);
  // An unparseable expiry is treated as expired (fail closed — Rules.md §6).
  if (Number.isNaN(expiry)) return true;
  return expiry <= now.getTime();
}

/** Whether an invite can still be accepted (pending and not expired). */
export function isInvitationAcceptable(
  invitation: Pick<InvitationRow, "status" | "expires_at">,
  now: Date = new Date(),
): boolean {
  return invitationState(invitation, now) === "pending";
}

/** Case-insensitive comparison of an invite's target email to a candidate. */
export function invitationEmailMatches(
  invitation: Pick<InvitationRow, "email">,
  email: string,
): boolean {
  return invitation.email.trim().toLowerCase() === email.trim().toLowerCase();
}

// ── display helpers ───────────────────────────────────────────────────────

/** Human label for an invite's effective state. */
export function invitationStateLabel(state: InvitationState): string {
  switch (state) {
    case "pending":
      return "Pending";
    case "accepted":
      return "Accepted";
    case "revoked":
      return "Revoked";
    case "expired":
      return "Expired";
  }
}

/** Format an invite date, reusing the app-wide deterministic UTC formatter. */
export function formatInviteDate(iso: string): string {
  return formatHistoryDate(iso);
}

/** A single invitation prepared for the admin list. */
export interface InvitationView {
  id: string;
  email: string;
  role: UserRole;
  roleLabel: string;
  state: InvitationState;
  stateLabel: string;
  invited: string;
  expires: string;
}

/** Project one row into a view-model for a given `now` (expiry-aware). */
export function toInvitationView(
  invitation: InvitationRow,
  now: Date = new Date(),
): InvitationView {
  const state = invitationState(invitation, now);
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    roleLabel: roleLabel(invitation.role),
    state,
    stateLabel: invitationStateLabel(state),
    invited: formatInviteDate(invitation.created_at),
    expires: formatInviteDate(invitation.expires_at),
  };
}

/**
 * Build the admin invitation list: still-actionable invites first (pending,
 * then expired), accepted/revoked after, and within each group newest-first.
 * The order is a pure function of the data, so it is stable regardless of query
 * order.
 */
export function toInvitationList(
  invitations: InvitationRow[],
  now: Date = new Date(),
): InvitationView[] {
  const rank = (state: InvitationState): number =>
    ({ pending: 0, expired: 1, accepted: 2, revoked: 3 })[state];
  return [...invitations]
    .map((inv) => ({ view: toInvitationView(inv, now), created: inv.created_at }))
    .sort((a, b) => {
      const byState = rank(a.view.state) - rank(b.view.state);
      if (byState !== 0) return byState;
      // Newest first within a state group.
      return b.created.localeCompare(a.created);
    })
    .map((entry) => entry.view);
}
