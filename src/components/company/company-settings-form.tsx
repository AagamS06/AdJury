"use client";

import { useActionState } from "react";
import { FormError, FormNotice, SubmitButton } from "@/components/auth/auth-ui";
import {
  updateCompanySettingsAction,
  type CompanySettingsFormState,
} from "@/lib/company/actions";
import { PLAN_TIER_OPTIONS, planReviewAllowance } from "@/lib/company/onboarding";
import type { PlanTier } from "@/types/db";

const INITIAL: CompanySettingsFormState = {};

/**
 * Company settings — plan tier editor (DailyPlan Day 50). A client island so it
 * owns its own error/notice state, handed to `updateCompanySettingsAction`. The
 * real authorization (admin-only) and validation run server-side in
 * `updateCompanySettings` + the action's `requireAdmin()` — this is a convenience,
 * not the trust boundary (Rules.md §5).
 *
 * Accessibility (Design.md §6): the plan choice is a keyboard-navigable radio
 * group in a `<fieldset>`/`<legend>`, and the outcome is announced through
 * `role="alert"` / `role="status"` (the shared FormError/FormNotice primitives).
 */
export function CompanySettingsForm({ planTier }: { planTier: PlanTier }) {
  const [state, formAction] = useActionState(
    updateCompanySettingsAction,
    INITIAL,
  );

  return (
    <form action={formAction} noValidate>
      <FormError message={state.error} />
      <FormNotice message={state.notice} />

      <fieldset className="mb-6">
        <legend className="mb-2 block text-sm font-medium text-body">
          Plan
        </legend>
        <p className="mb-3 text-sm text-muted">
          Your plan sets how many reviews your team can run each day. Billing
          arrives later — you can change plans anytime.
        </p>
        <div className="space-y-2">
          {PLAN_TIER_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              htmlFor={`plan-${opt.value}`}
              className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-surface p-3 hover:bg-canvas focus-within:border-royal focus-within:ring-2 focus-within:ring-royal-bright"
            >
              <input
                id={`plan-${opt.value}`}
                name="plan_tier"
                type="radio"
                value={opt.value}
                defaultChecked={opt.value === planTier}
                required
                className="mt-1 h-4 w-4 accent-royal focus-visible:outline-none"
              />
              <span className="min-w-0">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold text-navy">{opt.label}</span>
                  <span className="text-xs font-medium text-muted">
                    {planReviewAllowance(opt.value)} reviews/day
                  </span>
                </span>
                <span className="mt-0.5 block text-sm text-muted">
                  {opt.tagline}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <SubmitButton label="Save settings" />
    </form>
  );
}
