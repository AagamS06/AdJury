"use client";

import { useActionState } from "react";
import { FormError, FormNotice, SubmitButton } from "@/components/auth/auth-ui";
import {
  updateUserProfileAction,
  type UserSettingsFormState,
} from "@/lib/user/actions";
import { MAX_DISPLAY_NAME_CHARS } from "@/lib/validation/limits";

const INITIAL: UserSettingsFormState = {};

/**
 * User settings — display-name editor (DailyPlan Day 51). A client island so it
 * owns its own error/notice state, handed to `updateUserProfileAction`. The real
 * authorization (signed-in) and validation run server-side in `updateUserProfile`
 * + the action's `requireSession()` — this is a convenience, not the trust
 * boundary (Rules.md §5).
 *
 * Accessibility (Design.md §6): a single labelled text input with a visible
 * focus ring and a `<p>` hint tied to it via `aria-describedby`; the outcome is
 * announced through `role="alert"` / `role="status"` (the shared FormError /
 * FormNotice primitives). The field is optional — clearing it falls back to the
 * email — so it is not marked required.
 */
export function UserSettingsForm({
  displayName,
}: {
  displayName: string | null;
}) {
  const [state, formAction] = useActionState(updateUserProfileAction, INITIAL);

  return (
    <form action={formAction} noValidate>
      <FormError message={state.error} />
      <FormNotice message={state.notice} />

      <div className="mb-6">
        <label
          htmlFor="display_name"
          className="mb-1 block text-sm font-medium text-body"
        >
          Display name
        </label>
        <p id="display_name-hint" className="mb-2 text-sm text-muted">
          How you&apos;re shown across AdJury. Leave it blank to use your email.
        </p>
        <input
          id="display_name"
          name="display_name"
          type="text"
          defaultValue={displayName ?? ""}
          maxLength={MAX_DISPLAY_NAME_CHARS}
          autoComplete="name"
          aria-describedby="display_name-hint"
          placeholder="e.g. Jordan Lee"
          className="w-full max-w-md rounded-sm border border-border bg-surface px-3 py-2 text-body outline-none focus-visible:border-royal focus-visible:ring-2 focus-visible:ring-royal-bright"
        />
      </div>

      <SubmitButton label="Save profile" />
    </form>
  );
}
