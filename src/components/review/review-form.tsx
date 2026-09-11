"use client";

import { useId, useState } from "react";
import {
  CONTENT_TYPE_OPTIONS,
  MAX_CONTENT_LENGTH,
  PLATFORM_OPTIONS,
  submitReview,
  validateReviewForm,
  type ReviewFieldErrors,
  type ReviewFormFields,
} from "@/lib/reviews/review-form";
import type { ReviewResult } from "@/lib/schema/juror";
import { Scorecard } from "@/components/review/scorecard";

/**
 * Content submission form (DailyPlan Day 8): content textarea + content-type and
 * platform selects, client-side Zod validation, calls `POST /api/reviews`.
 *
 * On success it renders the returned payload as a full Scorecard (DailyPlan
 * Day 9) — the aggregate + verdict header and one JurorCard per juror. The
 * form's own concern stays submit-and-receive; the scorecard is a separate,
 * reusable presentational component (`components/review/scorecard.tsx`).
 *
 * Accessibility (Design.md §6): every control has a real label; invalid fields
 * set `aria-invalid` and point at their message via `aria-describedby`; the
 * form-level error uses `role="alert"` and the result region is a labelled
 * live region.
 */

const EMPTY_FIELDS: ReviewFormFields = {
  content_text: "",
  content_type: "",
  platform: "",
};

export function ReviewForm() {
  const baseId = useId();
  const fieldId = (name: string) => `${baseId}-${name}`;
  const errorId = (name: string) => `${baseId}-${name}-error`;

  const [fields, setFields] = useState<ReviewFormFields>(EMPTY_FIELDS);
  const [fieldErrors, setFieldErrors] = useState<ReviewFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ReviewResult | null>(null);
  // The content that produced `result`, captured for the before/after rewrite
  // diff (DailyPlan Day 15) — the API response doesn't echo the content back.
  const [submittedContent, setSubmittedContent] = useState<string | null>(null);

  function update<K extends keyof ReviewFormFields>(
    key: K,
    value: ReviewFormFields[K],
  ) {
    setFields((prev) => ({ ...prev, [key]: value }));
    // Clear a field's error as the user edits it.
    setFieldErrors((prev) =>
      prev[key] ? { ...prev, [key]: undefined } : prev,
    );
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setFormError(null);
    const validation = validateReviewForm(fields);
    if (!validation.ok) {
      setFieldErrors(validation.fieldErrors);
      return;
    }
    setFieldErrors({});

    setSubmitting(true);
    setResult(null);
    const outcome = await submitReview(validation.data);
    setSubmitting(false);

    if (outcome.ok) {
      setResult(outcome.review);
      setSubmittedContent(validation.data.content_text);
    } else {
      setFormError(outcome.message);
    }
  }

  const remaining = MAX_CONTENT_LENGTH - fields.content_text.length;

  return (
    <div className="space-y-8">
      <form
        onSubmit={onSubmit}
        noValidate
        className="max-w-3xl rounded-md border border-border bg-surface p-6 shadow-[0_1px_2px_rgba(11,11,15,.06)]"
      >
        {/* Content */}
        <div className="mb-4">
          <label
            htmlFor={fieldId("content_text")}
            className="mb-1 block text-sm font-medium text-body"
          >
            Content to review
          </label>
          <textarea
            id={fieldId("content_text")}
            name="content_text"
            required
            rows={10}
            maxLength={MAX_CONTENT_LENGTH}
            value={fields.content_text}
            onChange={(e) => update("content_text", e.target.value)}
            placeholder="Paste the ad copy, social post, email, or landing-page text you want the jurors to review…"
            aria-invalid={fieldErrors.content_text ? true : undefined}
            aria-describedby={
              fieldErrors.content_text
                ? errorId("content_text")
                : `${baseId}-content-hint`
            }
            className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-body outline-none focus-visible:border-royal focus-visible:ring-2 focus-visible:ring-royal-bright"
          />
          <div className="mt-1 flex items-center justify-between gap-3">
            {fieldErrors.content_text ? (
              <p
                id={errorId("content_text")}
                role="alert"
                className="text-sm font-medium text-danger"
              >
                {fieldErrors.content_text}
              </p>
            ) : (
              <p id={`${baseId}-content-hint`} className="text-sm text-muted">
                Up to {MAX_CONTENT_LENGTH.toLocaleString()} characters.
              </p>
            )}
            <span
              className="shrink-0 text-sm tabular-nums text-muted"
              aria-live="polite"
            >
              {remaining.toLocaleString()} left
            </span>
          </div>
        </div>

        {/* Content type + platform */}
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor={fieldId("content_type")}
              className="mb-1 block text-sm font-medium text-body"
            >
              Content type
            </label>
            <select
              id={fieldId("content_type")}
              name="content_type"
              required
              value={fields.content_type}
              onChange={(e) => update("content_type", e.target.value)}
              aria-invalid={fieldErrors.content_type ? true : undefined}
              aria-describedby={
                fieldErrors.content_type
                  ? errorId("content_type")
                  : undefined
              }
              className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-body outline-none focus-visible:border-royal focus-visible:ring-2 focus-visible:ring-royal-bright"
            >
              <option value="" disabled>
                Select a type…
              </option>
              {CONTENT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {fieldErrors.content_type && (
              <p
                id={errorId("content_type")}
                role="alert"
                className="mt-1 text-sm font-medium text-danger"
              >
                {fieldErrors.content_type}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor={fieldId("platform")}
              className="mb-1 block text-sm font-medium text-body"
            >
              Platform{" "}
              <span className="font-normal text-muted">(optional)</span>
            </label>
            <select
              id={fieldId("platform")}
              name="platform"
              value={fields.platform}
              onChange={(e) => update("platform", e.target.value)}
              className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-body outline-none focus-visible:border-royal focus-visible:ring-2 focus-visible:ring-royal-bright"
            >
              {PLATFORM_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {formError && (
          <p role="alert" className="mb-4 text-sm font-medium text-danger">
            {formError}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          aria-busy={submitting}
          className="w-full rounded-sm bg-royal px-4 py-2 font-semibold text-white transition-colors hover:bg-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {submitting ? "Reviewing…" : "Run review"}
        </button>
      </form>

      <ResultPanel
        result={result}
        submitting={submitting}
        originalContent={submittedContent}
      />
    </div>
  );
}

function ResultPanel({
  result,
  submitting,
  originalContent,
}: {
  result: ReviewResult | null;
  submitting: boolean;
  originalContent: string | null;
}) {
  if (submitting) {
    return (
      <div
        role="status"
        className="flex items-center rounded-md border border-border bg-surface p-6 text-sm text-muted shadow-[0_1px_2px_rgba(11,11,15,.06)]"
      >
        The five jurors are reviewing your content…
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex items-center rounded-md border border-dashed border-border bg-canvas p-6 text-sm text-muted">
        Your review will appear here once you run it.
      </div>
    );
  }

  return (
    <div role="status" aria-label="Review result" className="space-y-4">
      <Scorecard
        aggregateScore={result.aggregate_score}
        verdict={result.verdict}
        jurors={result.jurors}
        contentType={result.content_type}
        platform={result.platform}
        createdAt={result.created_at}
        originalContent={originalContent}
      />

      <details>
        <summary className="cursor-pointer text-sm font-medium text-royal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright">
          View raw JSON
        </summary>
        <pre className="mt-2 max-h-72 overflow-auto rounded-sm border border-border bg-surface p-3 font-mono text-xs text-body">
          {JSON.stringify(result, null, 2)}
        </pre>
      </details>
    </div>
  );
}
