"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  FormError,
  SubmitButton,
} from "@/components/auth/auth-ui";
import {
  completeOnboardingAction,
  type OnboardingFormState,
} from "@/lib/company/actions";
import {
  INDUSTRY_OPTIONS,
  PLAN_TIER_OPTIONS,
  planReviewAllowance,
} from "@/lib/company/onboarding";
import type { PlanTier } from "@/types/db";

const INITIAL: OnboardingFormState = {};

/**
 * First-admin onboarding form (DailyPlan Day 22). A focused, on-brand card that
 * collects the company name, industry, and plan tier and hands them to
 * `completeOnboardingAction`. Accessibility per Design.md §6: every control has a
 * real `<label>`/`<legend>`, the plan choice is a keyboard-navigable radio group
 * in a `<fieldset>`, and the error is announced via `role="alert"`. Server-side
 * validation is the trust boundary; the `required`/`defaultValue` here are only a
 * convenience.
 */
export function OnboardingForm({
  companyName,
  industry,
  planTier,
  alreadyOnboarded,
}: {
  companyName: string;
  industry: string | null;
  planTier: PlanTier;
  alreadyOnboarded: boolean;
}) {
  const [state, formAction] = useActionState(completeOnboardingAction, INITIAL);

  return (
    <div className="w-full max-w-lg">
      <div className="mb-6 text-center">
        <Link
          href="/dashboard"
          className="text-sm font-semibold uppercase tracking-wide text-royal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
        >
          AdJury
        </Link>
        <h1 className="mt-3 text-2xl font-bold text-ink">
          {alreadyOnboarded ? "Company details" : "Set up your company"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {alreadyOnboarded
            ? "Update how AdJury represents your company."
            : "Tell us a little about your company so AdJury can tailor reviews. You can change these later."}
        </p>
      </div>

      <div className="rounded-md border border-border bg-surface p-6 shadow-[0_1px_2px_rgba(11,11,15,.06)]">
        <form action={formAction} noValidate>
          <FormError message={state.error} />

          <div className="mb-4">
            <label
              htmlFor="name"
              className="mb-1 block text-sm font-medium text-body"
            >
              Company name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              minLength={2}
              maxLength={120}
              defaultValue={companyName}
              autoComplete="organization"
              className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-body outline-none focus-visible:border-royal focus-visible:ring-2 focus-visible:ring-royal-bright"
            />
          </div>

          <div className="mb-6">
            <label
              htmlFor="industry"
              className="mb-1 block text-sm font-medium text-body"
            >
              Industry
            </label>
            <select
              id="industry"
              name="industry"
              required
              defaultValue={industry ?? ""}
              className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-body outline-none focus-visible:border-royal focus-visible:ring-2 focus-visible:ring-royal-bright"
            >
              <option value="" disabled>
                Select your industry…
              </option>
              {INDUSTRY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <fieldset className="mb-6">
            <legend className="mb-2 block text-sm font-medium text-body">
              Plan
            </legend>
            <p className="mb-3 text-xs text-muted">
              Sets your review allowance. Billing arrives later — you can change
              plans anytime.
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
                      <span className="font-semibold text-navy">
                        {opt.label}
                      </span>
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

          <SubmitButton
            label={alreadyOnboarded ? "Save changes" : "Finish setup"}
          />
        </form>
      </div>

      {alreadyOnboarded && (
        <p className="mt-6 text-center text-sm text-muted">
          <Link
            href="/dashboard"
            className="font-semibold text-royal hover:text-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
          >
            Back to dashboard
          </Link>
        </p>
      )}
    </div>
  );
}
