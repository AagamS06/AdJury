"use client";

import { useActionState } from "react";
import { FormError, SubmitButton } from "@/components/auth/auth-ui";
import { CopyButton } from "@/components/review/copy-button";
import {
  createInvitationAction,
  type InviteFormState,
} from "@/lib/company/actions";

const INITIAL: InviteFormState = {};

/**
 * Admin "invite a teammate" form (DailyPlan Day 24). Collects an email + role and
 * hands them to `createInvitationAction`. Because email delivery is stubbed in
 * this build, a successful invite surfaces the shareable accept link with a
 * copy button so the admin can pass it on.
 *
 * Accessibility (Design.md §6): real `<label>`s, visible focus rings, and the
 * error/confirmation are announced (`role="alert"`/`role="status"`). Server-side
 * validation + admin gating are the trust boundary; the `required` here is only a
 * convenience.
 */
export function InviteForm() {
  const [state, formAction] = useActionState(createInvitationAction, INITIAL);

  return (
    <div className="rounded-md border border-border bg-surface p-6 shadow-[0_1px_2px_rgba(11,11,15,.06)]">
      <h2 className="text-lg font-semibold text-navy">Invite a teammate</h2>
      <p className="mt-1 text-sm text-muted">
        Send an invite link so a colleague can join your company and start
        reviewing content.
      </p>

      <form action={formAction} noValidate className="mt-4">
        <FormError message={state.error} />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label
              htmlFor="invite-email"
              className="mb-1 block text-sm font-medium text-body"
            >
              Email address
            </label>
            <input
              id="invite-email"
              name="email"
              type="email"
              required
              autoComplete="off"
              placeholder="teammate@company.com"
              className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-body outline-none focus-visible:border-royal focus-visible:ring-2 focus-visible:ring-royal-bright"
            />
          </div>

          <div className="sm:w-40">
            <label
              htmlFor="invite-role"
              className="mb-1 block text-sm font-medium text-body"
            >
              Role
            </label>
            <select
              id="invite-role"
              name="role"
              defaultValue="member"
              className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-body outline-none focus-visible:border-royal focus-visible:ring-2 focus-visible:ring-royal-bright"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          <div className="sm:w-auto">
            <SubmitButton label="Send invite" />
          </div>
        </div>
      </form>

      {state.inviteUrl && (
        <div
          role="status"
          className="mt-4 rounded-md border border-success/30 bg-success/10 p-4"
        >
          <p className="text-sm font-medium text-body">
            Invitation ready for{" "}
            <span className="font-semibold">{state.invitedEmail}</span>. Email
            delivery isn&apos;t wired up yet — share this link so they can join:
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-sm border border-border bg-surface px-2 py-1 font-mono text-xs text-body">
              {state.inviteUrl}
            </code>
            <CopyButton value={state.inviteUrl} label="Copy link" />
          </div>
        </div>
      )}
    </div>
  );
}
