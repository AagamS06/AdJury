"use client";

import { useActionState } from "react";
import { FormError, FormNotice, SubmitButton } from "@/components/auth/auth-ui";
import {
  acceptInvitationAction,
  signUpViaInviteAction,
  type AcceptInviteState,
  type InviteSignupState,
} from "@/lib/company/actions";

/**
 * Interactive pieces of the invite-acceptance page (DailyPlan Day 24). Kept
 * minimal — the token is a hidden field and all the real validation (email
 * match, expiry, single-company rule) runs server-side in the accept core.
 */

const ACCEPT_INITIAL: AcceptInviteState = {};

/** Signed-in matching user: a one-click accept. */
export function InviteAcceptForm({ token }: { token: string }) {
  const [state, formAction] = useActionState(
    acceptInvitationAction,
    ACCEPT_INITIAL,
  );
  return (
    <form action={formAction} noValidate>
      <FormError message={state.error} />
      <input type="hidden" name="token" value={token} />
      <SubmitButton label="Accept invitation" />
    </form>
  );
}

const SIGNUP_INITIAL: InviteSignupState = {};

/** New invitee: set a password to create an account and join in one step. */
export function InviteSignupForm({
  token,
  email,
}: {
  token: string;
  email: string;
}) {
  const [state, formAction] = useActionState(
    signUpViaInviteAction,
    SIGNUP_INITIAL,
  );
  return (
    <form action={formAction} noValidate>
      <FormError message={state.error} />
      <FormNotice message={state.notice} />
      <input type="hidden" name="token" value={token} />

      <div className="mb-4">
        <label
          htmlFor="invite-account-email"
          className="mb-1 block text-sm font-medium text-body"
        >
          Email address
        </label>
        <input
          id="invite-account-email"
          type="email"
          value={email}
          readOnly
          aria-readonly="true"
          autoComplete="username"
          className="w-full cursor-not-allowed rounded-sm border border-border bg-canvas px-3 py-2 text-muted outline-none"
        />
        <p className="mt-1 text-xs text-muted">
          Your account is created for the invited address.
        </p>
      </div>

      <div className="mb-5">
        <label
          htmlFor="invite-password"
          className="mb-1 block text-sm font-medium text-body"
        >
          Choose a password
        </label>
        <input
          id="invite-password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-body outline-none focus-visible:border-royal focus-visible:ring-2 focus-visible:ring-royal-bright"
        />
      </div>

      <SubmitButton label="Create account & join" />
    </form>
  );
}
