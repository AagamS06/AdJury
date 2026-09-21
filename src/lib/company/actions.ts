"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/guard";
import { createServerSupabase } from "@/lib/auth/supabase-server";
import {
  completeCompanyOnboarding,
  findCompanyMemberByEmail,
  getInvitationByTokenHash,
  getUserById,
  insertInvitation,
  insertUser,
  markInvitationAccepted,
} from "@/lib/db/queries";
import { serverClient } from "@/lib/db/supabase";
import { acceptInvitation } from "./accept-invitation";
import { createInvitation } from "./create-invitation";
import {
  hashInviteToken,
  inviteAcceptUrl,
  invitationState,
} from "./invitations";
import {
  CompanyOnboardingSchema,
  firstOnboardingIssue,
} from "./onboarding";

/**
 * Company onboarding server action (DailyPlan Day 22). Logic lives here, not in
 * the form component (Rules.md §7). It re-derives the caller server-side —
 * `requireAdmin()` guarantees an authenticated *admin* and redirects otherwise,
 * so onboarding can never be completed by an unauthenticated or member caller —
 * validates the input with Zod, and writes with the service-role client
 * (companies has no client write policy). The `company_id` comes from the
 * resolved session, never the form (Rules.md §5).
 */
export interface OnboardingFormState {
  error?: string;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function completeOnboardingAction(
  _prev: OnboardingFormState,
  formData: FormData,
): Promise<OnboardingFormState> {
  const session = await requireAdmin();

  const parsed = CompanyOnboardingSchema.safeParse({
    name: field(formData, "name"),
    industry: field(formData, "industry"),
    plan_tier: field(formData, "plan_tier"),
  });
  if (!parsed.success) return { error: firstOnboardingIssue(parsed.error) };

  const admin = serverClient();
  try {
    await completeCompanyOnboarding(admin, session.companyId, parsed.data);
  } catch (err) {
    // Surface a plain message; keep internal detail in logs, no secrets/PII
    // (Rules.md §6).
    console.error("company onboarding failed", {
      op: "completeOnboardingAction",
      companyId: session.companyId,
      message: err instanceof Error ? err.message : "unknown error",
    });
    return {
      error: "We couldn't save your company details. Please try again.",
    };
  }

  redirect("/dashboard");
}

// ── invitations (DailyPlan Day 24) ────────────────────────────────────────

/**
 * State for the admin invite form. On success it carries the accept link so the
 * admin can share it — email delivery is stubbed in this build (the link is also
 * logged server-side), so surfacing it in the UI is how the invite reaches its
 * recipient. On failure, a plain message.
 */
export interface InviteFormState {
  error?: string;
  /** The shareable accept link, set after a successful invite. */
  inviteUrl?: string;
  /** The address the invite is for, echoed back for the confirmation copy. */
  invitedEmail?: string;
}

/**
 * Admin invite-a-teammate action. `requireAdmin()` re-derives the caller
 * server-side (a member/anon caller is redirected), the create core validates
 * the email/role and blocks a duplicate member, and the write runs under the
 * service-role client (invitations has no client write policy). Email delivery
 * is stubbed: the link is logged and returned for the admin to share (Rules.md
 * §6 — no secret is leaked beyond the invite link itself, which is the payload
 * an email would carry).
 */
export async function createInvitationAction(
  _prev: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  const session = await requireAdmin();
  const admin = serverClient();

  const result = await createInvitation({
    session,
    input: { email: field(formData, "email"), role: field(formData, "role") },
    findMember: (companyId, email) =>
      findCompanyMemberByEmail(admin, companyId, email),
    insert: (params) => insertInvitation(admin, params),
  });

  if (!result.ok) return { error: result.error };

  const inviteUrl = inviteAcceptUrl(
    result.token,
    process.env.NEXT_PUBLIC_APP_URL,
  );

  // Stubbed email delivery: log the invite (no secret beyond the link itself).
  console.info("invitation email (stubbed)", {
    op: "createInvitationAction",
    companyId: session.companyId,
    to: result.invitation.email,
    role: result.invitation.role,
    inviteUrl,
  });

  revalidatePath("/team");
  return { inviteUrl, invitedEmail: result.invitation.email };
}

/** Wire the accept core to the service-role client and the current auth user. */
async function runAccept(token: string) {
  const admin = serverClient();

  // Resolve the accepting auth user directly (they are often not yet
  // provisioned, so getSessionContext would return null).
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return acceptInvitation({
    auth: user ? { userId: user.id, email: user.email ?? "" } : null,
    tokenHash: hashInviteToken(token),
    lookup: (hash) => getInvitationByTokenHash(admin, hash),
    findExistingUser: (userId) => getUserById(admin, userId),
    join: (params) => insertUser(admin, params),
    markAccepted: (id) => markInvitationAccepted(admin, id),
  });
}

export interface AcceptInviteState {
  error?: string;
}

/**
 * Accept an invitation as an already-signed-in user (the "Accept" button on the
 * invite page). The token comes from a hidden field; the accept core enforces
 * the email match, expiry, and single-company rule server-side. On success the
 * member row exists and we send them into the app.
 */
export async function acceptInvitationAction(
  _prev: AcceptInviteState,
  formData: FormData,
): Promise<AcceptInviteState> {
  const token = field(formData, "token");
  if (!token) return { error: "This invitation link isn't valid." };

  const result = await runAccept(token);
  if (!result.ok) return { error: result.error };

  redirect("/dashboard");
}

const invitePasswordSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export interface InviteSignupState {
  error?: string;
  notice?: string;
}

/**
 * Create an account FROM an invitation and join the company in one step. The new
 * account's email is taken from the invitation (the bearer token proves the
 * invitee controls that address), so no client-supplied email is trusted
 * (Rules.md §5). Unlike normal signup (`signUpAction`), this does NOT provision a
 * brand-new company — the invitee joins the inviting company as the invite's
 * role via the shared accept core.
 */
export async function signUpViaInviteAction(
  _prev: InviteSignupState,
  formData: FormData,
): Promise<InviteSignupState> {
  const token = field(formData, "token");
  if (!token) return { error: "This invitation link isn't valid." };

  const parsed = invitePasswordSchema.safeParse({
    password: field(formData, "password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check your password." };
  }

  const admin = serverClient();
  const invitation = await getInvitationByTokenHash(
    admin,
    hashInviteToken(token),
  );
  if (!invitation || invitationState(invitation) !== "pending") {
    return {
      error: "This invitation link isn't valid or has expired.",
    };
  }

  // Create the auth account for the invitation's address.
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.signUp({
    email: invitation.email,
    password: parsed.data.password,
  });
  if (error || !data.user) {
    return {
      error:
        "We couldn't create your account. If you already have one, log in and open the invite link again.",
    };
  }

  // Provision the member row into the inviting company (never a new company).
  const result = await acceptInvitation({
    auth: { userId: data.user.id, email: invitation.email },
    tokenHash: hashInviteToken(token),
    lookup: (hash) => getInvitationByTokenHash(admin, hash),
    findExistingUser: (userId) => getUserById(admin, userId),
    join: (params) => insertUser(admin, params),
    markAccepted: (id) => markInvitationAccepted(admin, id),
  });
  if (!result.ok) return { error: result.error };

  // With email confirmation enabled there is no session yet; the membership is
  // already created, so they confirm then log in.
  if (!data.session) {
    return {
      notice:
        "Account created and added to the team. Check your email to confirm your address, then log in.",
    };
  }

  redirect("/dashboard");
}
