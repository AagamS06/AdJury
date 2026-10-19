"use client";

import { useActionState } from "react";
import { FormError, FormNotice, SubmitButton } from "@/components/auth/auth-ui";
import {
  updateNotificationPreferencesAction,
  type NotificationPrefsFormState,
} from "@/lib/user/actions";
import type { NotificationPreferences } from "@/types/db";

const INITIAL: NotificationPrefsFormState = {};

/** The three opt-ins, with the copy shown beside each checkbox. */
const OPTIONS: {
  name: keyof NotificationPreferences;
  label: string;
  description: string;
}[] = [
  {
    name: "review_complete",
    label: "Review results",
    description: "Email me when a review I submitted finishes.",
  },
  {
    name: "weekly_digest",
    label: "Weekly digest",
    description: "A weekly summary of my company's review activity.",
  },
  {
    name: "product_news",
    label: "Product news",
    description: "Occasional announcements about new AdJury features.",
  },
];

/**
 * Notification preferences editor (DailyPlan Day 51, Part 2). A client island so
 * it owns its own error/notice state. The real authorization (signed-in) and
 * validation run server-side in `updateNotificationPreferences` + the action's
 * `requireSession()` — this is a convenience, not the trust boundary (Rules.md §5).
 *
 * Accessibility (Design.md §6): a keyboard-navigable set of labelled checkboxes in
 * a `<fieldset>`/`<legend>`, each with its description tied via `aria-describedby`;
 * the outcome is announced through `role="alert"` / `role="status"`.
 */
export function NotificationPreferencesForm({
  prefs,
}: {
  prefs: NotificationPreferences;
}) {
  const [state, formAction] = useActionState(
    updateNotificationPreferencesAction,
    INITIAL,
  );

  return (
    <form action={formAction} noValidate>
      <FormError message={state.error} />
      <FormNotice message={state.notice} />

      <fieldset className="mb-6">
        <legend className="mb-2 block text-sm font-medium text-body">
          Email notifications
        </legend>
        <div className="space-y-2">
          {OPTIONS.map((opt) => (
            <label
              key={opt.name}
              htmlFor={`notify-${opt.name}`}
              className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-surface p-3 hover:bg-canvas focus-within:border-royal focus-within:ring-2 focus-within:ring-royal-bright"
            >
              <input
                id={`notify-${opt.name}`}
                name={opt.name}
                type="checkbox"
                defaultChecked={prefs[opt.name]}
                aria-describedby={`notify-${opt.name}-hint`}
                className="mt-1 h-4 w-4 accent-royal focus-visible:outline-none"
              />
              <span className="min-w-0">
                <span className="font-semibold text-navy">{opt.label}</span>
                <span
                  id={`notify-${opt.name}-hint`}
                  className="mt-0.5 block text-sm text-muted"
                >
                  {opt.description}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <SubmitButton label="Save preferences" />
    </form>
  );
}
