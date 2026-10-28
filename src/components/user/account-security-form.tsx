"use client";

import { useActionState } from "react";
import {
  Field,
  FormError,
  FormNotice,
  SubmitButton,
} from "@/components/auth/auth-ui";
import {
  changeEmailAction,
  changePasswordAction,
  type AccountSecurityFormState,
} from "@/lib/user/actions";
import { MIN_PASSWORD_CHARS } from "@/lib/validation/limits";

const INITIAL: AccountSecurityFormState = {};

/**
 * Account security — change password and change email (DailyPlan Day 51, Part 2).
 * Two independent client islands (each with its own action state) so a success or
 * error on one doesn't clobber the other. Both run their real validation + the
 * Supabase Auth call server-side; these forms are the convenience layer.
 *
 * Accessibility (Design.md §6): the shared `Field`/`SubmitButton` primitives give
 * labelled inputs, visible focus rings, and `aria-busy` while pending; outcomes
 * are announced via `role="alert"` / `role="status"`.
 */
export function AccountSecurityForms({ email }: { email: string }) {
  return (
    <div className="space-y-6">
      <ChangePasswordForm />
      <ChangeEmailForm currentEmail={email} />
    </div>
  );
}

function ChangePasswordForm() {
  const [state, formAction] = useActionState(changePasswordAction, INITIAL);
  return (
    <div className="rounded-md border border-border bg-surface p-6 shadow-card">
      <h3 className="text-base font-semibold text-navy">Change password</h3>
      <p className="mb-4 mt-1 text-sm text-muted">
        Choose a new password of at least {MIN_PASSWORD_CHARS} characters.
      </p>
      <form action={formAction} noValidate>
        <FormError message={state.error} />
        <FormNotice message={state.notice} />
        <Field
          id="password"
          label="New password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_CHARS}
        />
        <Field
          id="confirm"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_CHARS}
        />
        <SubmitButton label="Update password" />
      </form>
    </div>
  );
}

function ChangeEmailForm({ currentEmail }: { currentEmail: string }) {
  const [state, formAction] = useActionState(changeEmailAction, INITIAL);
  return (
    <div className="rounded-md border border-border bg-surface p-6 shadow-card">
      <h3 className="text-base font-semibold text-navy">Change email</h3>
      <p className="mb-4 mt-1 text-sm text-muted">
        You&apos;re signed in as{" "}
        <span className="font-medium text-body">{currentEmail}</span>. We&apos;ll
        email a confirmation link to your new address before the change takes
        effect.
      </p>
      <form action={formAction} noValidate>
        <FormError message={state.error} />
        <FormNotice message={state.notice} />
        <Field
          id="email"
          label="New email address"
          type="email"
          autoComplete="email"
        />
        <SubmitButton label="Send confirmation" />
      </form>
    </div>
  );
}
