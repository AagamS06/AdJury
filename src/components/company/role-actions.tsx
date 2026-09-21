"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  changeMemberRoleAction,
  type RoleChangeState,
} from "@/lib/company/actions";
import { nextRole, roleActionLabel } from "@/lib/company/role-management";
import type { UserRole } from "@/types/db";

/**
 * RoleActions (DailyPlan Day 25): the per-row promote/demote control on the
 * team table. A small client island so each member's toggle has its own
 * error/notice state; the token is a hidden field and the real authorization
 * (admin-only), the target-in-company check, and the last-admin guard all run
 * server-side in `changeMemberRole` — this is a convenience, not the trust
 * boundary (Rules.md §5).
 *
 * When the row is the company's only admin, the demote control is disabled with
 * a spoken explanation rather than letting the click bounce off the 409 guard.
 * Accessibility (Design.md §6): the button names the action and the target, and
 * the outcome is announced via `role="alert"`/`role="status"`.
 */
const INITIAL: RoleChangeState = {};

function ToggleButton({
  label,
  ariaLabel,
}: {
  label: string;
  ariaLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      aria-label={ariaLabel}
      className="rounded-sm border border-navy px-2.5 py-1 text-xs font-semibold text-navy transition-colors hover:bg-navy hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

export function RoleActions({
  userId,
  email,
  role,
  isOnlyAdmin,
}: {
  userId: string;
  email: string;
  role: UserRole;
  /** True when this row is the company's sole admin (demotion is blocked). */
  isOnlyAdmin: boolean;
}) {
  const [state, formAction] = useActionState(changeMemberRoleAction, INITIAL);
  const target = nextRole(role);
  const label = roleActionLabel(role);

  if (isOnlyAdmin) {
    // The last admin can't be demoted (would lock the company out of admin
    // management); show why instead of a control that only errors.
    return (
      <span className="text-xs text-muted">
        Only admin
        <span className="sr-only">
          {" "}
          — promote another teammate to admin before changing this role.
        </span>
      </span>
    );
  }

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="role" value={target} />
      <ToggleButton label={label} ariaLabel={`${label}: ${email}`} />
      {state.error && (
        <span role="alert" className="text-xs font-medium text-danger">
          {state.error}
        </span>
      )}
      {state.notice && (
        <span role="status" className="text-xs font-medium text-success">
          {state.notice}
        </span>
      )}
    </form>
  );
}
