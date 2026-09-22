"use client";

import { useActionState, useId, useState } from "react";
import { FormError, FormNotice, SubmitButton } from "@/components/auth/auth-ui";
import {
  saveBrandProfileAction,
  type BrandProfileFormState,
} from "@/lib/company/actions";
import {
  MAX_TONE_GUIDE_CHARS,
  MIN_TONE_GUIDE_CHARS,
} from "@/lib/company/brand-profile";

const INITIAL: BrandProfileFormState = {};

/**
 * Brand profile editor (DailyPlan Day 26): the admin-only textarea for the
 * company's tone/style guide, handed to `saveBrandProfileAction`. A client
 * island so it owns its own error/notice state and a live character counter;
 * the real authorization (admin-only) and validation run server-side in
 * `saveBrandProfile` + RLS — this is a convenience, not the trust boundary
 * (Rules.md §5).
 *
 * Accessibility (Design.md §6): a real `<label>`, the counter is wired via
 * `aria-describedby`, and the outcome is announced through `role="alert"` /
 * `role="status"` (the shared FormError/FormNotice primitives). Server-side
 * validation is authoritative; the `required`/`maxLength` here are conveniences.
 */
export function BrandProfileForm({ initialText }: { initialText: string }) {
  const [state, formAction] = useActionState(saveBrandProfileAction, INITIAL);
  const [text, setText] = useState(initialText);
  const counterId = useId();
  const helpId = useId();

  const count = text.trim().length;
  const overLimit = count > MAX_TONE_GUIDE_CHARS;

  return (
    <form action={formAction} noValidate>
      <FormError message={state.error} />
      <FormNotice message={state.notice} />

      <div className="mb-2">
        <label
          htmlFor="tone_guide_text"
          className="mb-1 block text-sm font-medium text-body"
        >
          Tone &amp; style guide
        </label>
        <p id={helpId} className="mb-2 text-sm text-muted">
          Describe your brand voice: the tone to strike, words and phrases to
          prefer or avoid, and any style rules. The Brand Voice Guardian juror
          reviews every submission against this.
        </p>
        <textarea
          id="tone_guide_text"
          name="tone_guide_text"
          required
          minLength={MIN_TONE_GUIDE_CHARS}
          maxLength={MAX_TONE_GUIDE_CHARS}
          rows={14}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-describedby={`${helpId} ${counterId}`}
          placeholder="e.g. Measured and expert, never hype. Prefer plain verbs over jargon. Avoid superlatives and exclamation marks…"
          className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-body leading-relaxed outline-none focus-visible:border-royal focus-visible:ring-2 focus-visible:ring-royal-bright"
        />
      </div>

      <div className="mb-6 flex items-center justify-between">
        <p
          id={counterId}
          className={`text-xs tabular-nums ${overLimit ? "font-semibold text-danger" : "text-muted"}`}
        >
          {count.toLocaleString()} / {MAX_TONE_GUIDE_CHARS.toLocaleString()}{" "}
          characters
          <span className="sr-only">
            {overLimit
              ? " — over the limit, please shorten your guide."
              : ""}
          </span>
        </p>
      </div>

      <SubmitButton label="Save brand guide" />
    </form>
  );
}
