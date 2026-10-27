"use client";

import { useId, useState } from "react";
import {
  CONTENT_TYPE_OPTIONS,
  IMAGE_ACCEPT,
  MAX_CONTENT_LENGTH,
  MEDIA_TYPE_OPTIONS,
  PLATFORM_OPTIONS,
  submitReview,
  validateReviewForm,
  type ReviewFieldErrors,
  type ReviewFormFields,
} from "@/lib/reviews/review-form";
import type { ReviewResult } from "@/lib/schema/juror";
import { Scorecard } from "@/components/review/scorecard";
import { useToast } from "@/components/ui/toast";
import { formatAggregate, verdictLabel } from "@/lib/reviews/scorecard-view";

/** Read an uploaded image file into a base64 `data:` URL + its MIME type. */
function readImageFile(
  file: File,
): Promise<{ data_url: string; mime_type: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({ data_url: String(reader.result), mime_type: file.type });
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

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
  media_type: "text",
  image: null,
};

export function ReviewForm() {
  const { notify } = useToast();
  const baseId = useId();
  const fieldId = (name: string) => `${baseId}-${name}`;
  const errorId = (name: string) => `${baseId}-${name}-error`;

  const [fields, setFields] = useState<ReviewFormFields>(EMPTY_FIELDS);
  const [fieldErrors, setFieldErrors] = useState<ReviewFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [imageName, setImageName] = useState<string | null>(null);
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
      // App-wide confirmation (Day 53): the scorecard renders below, but a toast
      // announces completion + the headline verdict without the user scrolling.
      notify({
        tone: "success",
        title: "Review complete",
        message: `Verdict: ${verdictLabel(outcome.review.verdict)} · Score ${formatAggregate(outcome.review.aggregate_score)}`,
      });
    } else {
      setFormError(outcome.message);
      // The inline form error stays for correction; the toast surfaces the
      // failure app-wide (Rules.md §6 — a clear, actionable message).
      notify({ tone: "error", title: "Review failed", message: outcome.message });
    }
  }

  function onMediaTypeChange(value: string) {
    // Switching format clears any attached image (text ads must not carry one).
    setImageName(null);
    setFields((prev) => ({ ...prev, media_type: value, image: null }));
    setFieldErrors((prev) => ({ ...prev, image: undefined, media_type: undefined }));
  }

  async function onImageChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      setImageName(null);
      update("image", null);
      return;
    }
    try {
      const image = await readImageFile(file);
      setImageName(file.name);
      update("image", image);
    } catch {
      setImageName(null);
      update("image", null);
      setFieldErrors((prev) => ({ ...prev, image: "Could not read that file. Please try another image." }));
    }
  }

  const isImage = fields.media_type === "image";
  const remaining = MAX_CONTENT_LENGTH - fields.content_text.length;

  return (
    <div className="space-y-8">
      <form
        onSubmit={onSubmit}
        noValidate
        className="max-w-3xl rounded-md border border-border bg-surface p-6 shadow-card"
      >
        {/* Ad format (Day 15a) */}
        <fieldset className="mb-4">
          <legend className="mb-1 block text-sm font-medium text-body">
            Ad format
          </legend>
          <div className="flex flex-wrap gap-2">
            {MEDIA_TYPE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex cursor-pointer items-center gap-2 rounded-sm border px-3 py-2 text-sm ${
                  fields.media_type === opt.value
                    ? "border-royal bg-canvas font-semibold text-navy"
                    : "border-border text-body"
                } ${opt.comingSoon ? "cursor-not-allowed opacity-50" : "hover:bg-canvas"} focus-within:ring-2 focus-within:ring-royal-bright`}
              >
                <input
                  type="radio"
                  name="media_type"
                  value={opt.value}
                  checked={fields.media_type === opt.value}
                  disabled={opt.comingSoon}
                  onChange={(e) => onMediaTypeChange(e.target.value)}
                  className="h-4 w-4 accent-royal focus-visible:outline-none"
                />
                {opt.label}
                {opt.comingSoon && (
                  <span className="text-xs font-normal text-muted">(soon)</span>
                )}
              </label>
            ))}
          </div>
        </fieldset>

        {/* Image upload (image ads only) */}
        {isImage && (
          <div className="mb-4">
            <label
              htmlFor={fieldId("image")}
              className="mb-1 block text-sm font-medium text-body"
            >
              Ad image
            </label>
            <input
              id={fieldId("image")}
              name="image"
              type="file"
              accept={IMAGE_ACCEPT}
              onChange={onImageChange}
              aria-invalid={fieldErrors.image ? true : undefined}
              aria-describedby={fieldErrors.image ? errorId("image") : `${baseId}-image-hint`}
              className="block w-full text-sm text-body file:mr-3 file:rounded-sm file:border-0 file:bg-royal file:px-3 file:py-2 file:font-semibold file:text-white hover:file:bg-royal-bright"
            />
            {fieldErrors.image ? (
              <p id={errorId("image")} role="alert" className="mt-1 text-sm font-medium text-danger">
                {fieldErrors.image}
              </p>
            ) : (
              <p id={`${baseId}-image-hint`} className="mt-1 text-sm text-muted">
                {imageName
                  ? `Selected: ${imageName}`
                  : "PNG, JPEG, WebP, or GIF — up to ~5 MB. The jurors review the image together with your caption below."}
              </p>
            )}
          </div>
        )}

        {/* Content */}
        <div className="mb-4">
          <label
            htmlFor={fieldId("content_text")}
            className="mb-1 block text-sm font-medium text-body"
          >
            {isImage ? "Caption / headline / CTA" : "Content to review"}
          </label>
          <textarea
            id={fieldId("content_text")}
            name="content_text"
            required
            rows={isImage ? 4 : 10}
            maxLength={MAX_CONTENT_LENGTH}
            value={fields.content_text}
            onChange={(e) => update("content_text", e.target.value)}
            placeholder={
              isImage
                ? "The copy that runs with this image — caption, headline, or call to action…"
                : "Paste the ad copy, social post, email, or landing-page text you want the jurors to review…"
            }
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
        className="flex items-center rounded-md border border-border bg-surface p-6 text-sm text-muted shadow-card"
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
