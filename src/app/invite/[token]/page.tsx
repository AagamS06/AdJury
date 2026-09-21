import Link from "next/link";
import {
  InviteAcceptForm,
  InviteSignupForm,
} from "@/components/company/invite-actions";
import { createServerSupabase } from "@/lib/auth/supabase-server";
import {
  getInvitationByTokenHash,
  getUserById,
} from "@/lib/db/queries";
import { serverClient } from "@/lib/db/supabase";
import {
  hashInviteToken,
  invitationEmailMatches,
  invitationState,
  invitationStateLabel,
  type InvitationState,
} from "@/lib/company/invitations";
import { roleLabel } from "@/lib/company/team-view";
import type { InvitationRow } from "@/types/db";

/**
 * Invitation acceptance page (DailyPlan Day 24) — where a tokenised invite link
 * lands. A STANDALONE route (outside the `(dashboard)` group) so an invitee who
 * isn't a member yet — or isn't signed in — can reach it without tripping the
 * dashboard's session/onboarding gates.
 *
 * The page resolves the invite by its token HASH server-side (service-role,
 * because the invitee typically isn't yet a member so RLS would hide the row —
 * the token is the bearer credential) and branches on the invite state and who's
 * signed in. All the real enforcement (email match, expiry, single-company rule)
 * lives in the accept core the forms post to; the page only chooses which form
 * or message to show. It never reveals which tokens exist beyond "valid or not".
 */
export const dynamic = "force-dynamic";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let invitation: InvitationRow | null = null;
  let currentUser: { id: string; email: string } | null = null;
  let existingMembership = false;
  let backendUnavailable = false;

  try {
    const admin = serverClient();
    invitation = await getInvitationByTokenHash(admin, hashInviteToken(token));

    // Resolve the signed-in user (if any) to decide accept-vs-signup.
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      currentUser = { id: user.id, email: user.email ?? "" };
      const existing = await getUserById(admin, user.id);
      existingMembership = existing != null;
    }
  } catch {
    // Missing secrets (e.g. the cloud build) or a transient failure — show a
    // graceful message rather than crash (Rules.md §6).
    backendUnavailable = true;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <Link
            href="/"
            className="text-sm font-semibold uppercase tracking-wide text-royal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
          >
            AdJury
          </Link>
          <h1 className="mt-3 text-2xl font-bold text-ink">
            Team invitation
          </h1>
        </div>

        <div className="rounded-md border border-border bg-surface p-6 shadow-[0_1px_2px_rgba(11,11,15,.06)]">
          <InviteBody
            token={token}
            invitation={invitation}
            currentUser={currentUser}
            existingMembership={existingMembership}
            backendUnavailable={backendUnavailable}
          />
        </div>
      </div>
    </main>
  );
}

function InviteBody({
  token,
  invitation,
  currentUser,
  existingMembership,
  backendUnavailable,
}: {
  token: string;
  invitation: InvitationRow | null;
  currentUser: { id: string; email: string } | null;
  existingMembership: boolean;
  backendUnavailable: boolean;
}) {
  if (backendUnavailable) {
    return (
      <Message tone="danger">
        We couldn&apos;t load this invitation right now. Please try again later.
      </Message>
    );
  }

  if (!invitation) {
    return (
      <Message tone="danger">
        This invitation link isn&apos;t valid. Ask an admin to send you a new
        one.
      </Message>
    );
  }

  const state = invitationState(invitation);
  if (state !== "pending") {
    return <Message tone="danger">{unusableCopy(state)}</Message>;
  }

  const intro = (
    <p className="mb-5 text-sm text-body">
      You&apos;ve been invited to join a company on AdJury as{" "}
      <span className="font-semibold text-navy">
        {roleLabel(invitation.role)}
      </span>
      , at <span className="font-semibold">{invitation.email}</span>.
    </p>
  );

  // Not signed in → create an account for the invited address and join.
  if (!currentUser) {
    return (
      <div>
        {intro}
        <InviteSignupForm token={token} email={invitation.email} />
        <p className="mt-6 text-center text-sm text-muted">
          Already have an account for {invitation.email}?{" "}
          <Link
            href="/login"
            className="font-semibold text-royal hover:text-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
          >
            Log in
          </Link>{" "}
          first, then reopen this link.
        </p>
      </div>
    );
  }

  // Signed in with a different address → the link is bound to the invited email.
  if (!invitationEmailMatches(invitation, currentUser.email)) {
    return (
      <Message tone="warning">
        This invitation was sent to{" "}
        <span className="font-semibold">{invitation.email}</span>, but
        you&apos;re signed in as{" "}
        <span className="font-semibold">{currentUser.email}</span>. Sign out and
        log in with the invited address to accept it.
      </Message>
    );
  }

  // Signed in and already in a company → one company per account in this model.
  if (existingMembership) {
    return (
      <div>
        <Message tone="warning">
          Your account already belongs to a company, so this invitation
          can&apos;t be applied.
        </Message>
        <p className="mt-5 text-center text-sm text-muted">
          <Link
            href="/dashboard"
            className="font-semibold text-royal hover:text-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
          >
            Go to your dashboard
          </Link>
        </p>
      </div>
    );
  }

  // Signed in, matching address, not yet provisioned → one-click accept.
  return (
    <div>
      {intro}
      <InviteAcceptForm token={token} />
    </div>
  );
}

function unusableCopy(state: Exclude<InvitationState, "pending">): string {
  switch (state) {
    case "expired":
      return "This invitation has expired. Ask an admin to send you a new one.";
    case "accepted":
      return "This invitation has already been used.";
    case "revoked":
      return "This invitation is no longer active.";
  }
  // Exhaustive; kept for the type checker.
  return `This invitation is ${invitationStateLabel(state).toLowerCase()}.`;
}

function Message({
  tone,
  children,
}: {
  tone: "danger" | "warning";
  children: React.ReactNode;
}) {
  const classes =
    tone === "danger"
      ? "border-danger/30 bg-danger/10 text-danger"
      : "border-warning/30 bg-warning/10 text-warning";
  return (
    <p
      role="alert"
      className={`rounded-md border px-4 py-3 text-sm ${classes}`}
    >
      {children}
    </p>
  );
}
