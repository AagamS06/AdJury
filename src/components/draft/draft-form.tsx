"use client";

import { useId, useState } from "react";
import {
  DRAFT_CONTENT_TYPE_OPTIONS,
  DRAFT_PLATFORM_OPTIONS,
  MAX_CONSTRAINT_ITEMS,
  MAX_KEY_MESSAGE_CHARS,
  MAX_PRODUCT_CHARS,
  TONE_OPTIONS,
  VARIANT_OPTIONS,
  submitDraft,
  validateDraftForm,
  type DraftFieldErrors,
  type DraftFormFields,
} from "@/lib/draft/draft-form";
import type { DraftResult } from "@/lib/draft/draft-assistant";
import { useToast } from "@/components/ui/toast";

/**
 * Draft Assistant form (DailyPlan Day 89): a brief (product / audience / key
 * message / tone / content type / platform / must-include / must-avoid /
 * variant count), client-side validation against the shared contract, and a call
 * to `POST /api/draft`. On success it renders the returned draft variants and the
 * standing disclaimer.
 *
 * This surface is deliberately separate from the review flow (PRD §3/§6.3): it
 * drafts copy, it does not score it. The disclaimer and the copy here keep that
 * explicit — a human edits and approves, and may THEN submit a draft as a new
 * review. The UI never auto-submits a draft to the jury.
 *
 * Accessibility (Design.md §6): every control has a real label; invalid fields
 * set `aria-invalid` and point at their message via `aria-describedby`; the
 * form-level error uses `role="alert"` and the result region is a labelled
 * live region.
 */

const EMPTY_FIELDS: DraftFormFields = {
  product: "",
  audience: "",
  keyMessage: "",
  tone: "",
  content_type: "",
  platform: "",
  mustInclude: "",
  mustAvoid: "",
  variants: "3",
};

const inputClass =
  "w-full rounded-sm border border-border bg-surface px-3 py-2 text-body outline-none focus-visible:border-royal focus-visible:ring-2 focus-visible:ring-royal-bright";

export function DraftForm() {
  const { notify } = useToast();
  const baseId = useId();
  const fieldId = (name: string) => `${baseId}-${name}`;
  const errorId = (name: string) => `${baseId}-${name}-error`;

  const [fields, setFields] = useState<DraftFormFields>(EMPTY_FIELDS);
  const [fieldErrors, setFieldErrors] = useState<DraftFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<DraftResult | null>(null);

  function update<K extends keyof DraftFormFields>(
    key: K,
    value: DraftFormFields[K],
  ) {
    setFields((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setFormError(null);
    const validation = validateDraftForm(fields);
    if (!validation.ok) {
      setFieldErrors(validation.fieldErrors);
      return;
    }
    setFieldErrors({});

    setSubmitting(true);
    setResult(null);
    const outcome = await submitDraft(validation.data);
    setSubmitting(false);

    if (outcome.ok) {
      setResult(outcome.result);
      notify({
        tone: "success",
        title: "Drafts ready",
        message: `${outcome.result.drafts.length} draft ${outcome.result.drafts.length === 1 ? "variant" : "variants"} generated.`,
      });
    } else {
      setFormError(outcome.message);
      notify({ tone: "error", title: "Couldn't draft copy", message: outcome.message });
    }
  }

  const productRemaining = MAX_PRODUCT_CHARS - fields.product.length;
  const keyMessageRemaining = MAX_KEY_MESSAGE_CHARS - fields.keyMessage.length;

  return (
    <div className="space-y-8">
      <form
        onSubmit={onSubmit}
        noValidate
        className="max-w-3xl rounded-md border border-border bg-surface p-6 shadow-card"
      >
        {/* Product */}
        <div className="mb-4">
          <label htmlFor={fieldId("product")} className="mb-1 block text-sm font-medium text-body">
            Product or offer
          </label>
          <input
            id={fieldId("product")}
            name="product"
            type="text"
            required
            maxLength={MAX_PRODUCT_CHARS}
            value={fields.product}
            onChange={(e) => update("product", e.target.value)}
            placeholder="What are you advertising? e.g. a weighted blanket"
            aria-invalid={fieldErrors.product ? true : undefined}
            aria-describedby={fieldErrors.product ? errorId("product") : `${baseId}-product-hint`}
            className={inputClass}
          />
          <div className="mt-1 flex items-center justify-between gap-3">
            {fieldErrors.product ? (
              <p id={errorId("product")} role="alert" className="text-sm font-medium text-danger">
                {fieldErrors.product}
              </p>
            ) : (
              <p id={`${baseId}-product-hint`} className="text-sm text-muted">
                We draft from your brief only — no invented facts, prices, or claims.
              </p>
            )}
            <span className="shrink-0 text-sm tabular-nums text-muted" aria-live="polite">
              {productRemaining.toLocaleString()} left
            </span>
          </div>
        </div>

        {/* Audience */}
        <div className="mb-4">
          <label htmlFor={fieldId("audience")} className="mb-1 block text-sm font-medium text-body">
            Audience
          </label>
          <input
            id={fieldId("audience")}
            name="audience"
            type="text"
            required
            value={fields.audience}
            onChange={(e) => update("audience", e.target.value)}
            placeholder="Who is it for? e.g. people who struggle to switch off at night"
            aria-invalid={fieldErrors.audience ? true : undefined}
            aria-describedby={fieldErrors.audience ? errorId("audience") : undefined}
            className={inputClass}
          />
          {fieldErrors.audience && (
            <p id={errorId("audience")} role="alert" className="mt-1 text-sm font-medium text-danger">
              {fieldErrors.audience}
            </p>
          )}
        </div>

        {/* Key message */}
        <div className="mb-4">
          <label htmlFor={fieldId("keyMessage")} className="mb-1 block text-sm font-medium text-body">
            Key message
          </label>
          <textarea
            id={fieldId("keyMessage")}
            name="keyMessage"
            required
            rows={3}
            maxLength={MAX_KEY_MESSAGE_CHARS}
            value={fields.keyMessage}
            onChange={(e) => update("keyMessage", e.target.value)}
            placeholder="The core benefit to land — e.g. fall asleep faster and wake up less"
            aria-invalid={fieldErrors.keyMessage ? true : undefined}
            aria-describedby={fieldErrors.keyMessage ? errorId("keyMessage") : `${baseId}-keyMessage-hint`}
            className={inputClass}
          />
          <div className="mt-1 flex items-center justify-between gap-3">
            {fieldErrors.keyMessage ? (
              <p id={errorId("keyMessage")} role="alert" className="text-sm font-medium text-danger">
                {fieldErrors.keyMessage}
              </p>
            ) : (
              <p id={`${baseId}-keyMessage-hint`} className="text-sm text-muted">
                Up to {MAX_KEY_MESSAGE_CHARS.toLocaleString()} characters.
              </p>
            )}
            <span className="shrink-0 text-sm tabular-nums text-muted" aria-live="polite">
              {keyMessageRemaining.toLocaleString()} left
            </span>
          </div>
        </div>

        {/* Tone + content type + platform + variants */}
        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={fieldId("tone")} className="mb-1 block text-sm font-medium text-body">
              Tone
            </label>
            <select
              id={fieldId("tone")}
              name="tone"
              required
              value={fields.tone}
              onChange={(e) => update("tone", e.target.value)}
              aria-invalid={fieldErrors.tone ? true : undefined}
              aria-describedby={fieldErrors.tone ? errorId("tone") : undefined}
              className={inputClass}
            >
              <option value="" disabled>
                Select a tone…
              </option>
              {TONE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {fieldErrors.tone && (
              <p id={errorId("tone")} role="alert" className="mt-1 text-sm font-medium text-danger">
                {fieldErrors.tone}
              </p>
            )}
          </div>

          <div>
            <label htmlFor={fieldId("content_type")} className="mb-1 block text-sm font-medium text-body">
              Content type
            </label>
            <select
              id={fieldId("content_type")}
              name="content_type"
              required
              value={fields.content_type}
              onChange={(e) => update("content_type", e.target.value)}
              aria-invalid={fieldErrors.content_type ? true : undefined}
              aria-describedby={fieldErrors.content_type ? errorId("content_type") : undefined}
              className={inputClass}
            >
              <option value="" disabled>
                Select a type…
              </option>
              {DRAFT_CONTENT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {fieldErrors.content_type && (
              <p id={errorId("content_type")} role="alert" className="mt-1 text-sm font-medium text-danger">
                {fieldErrors.content_type}
              </p>
            )}
          </div>

          <div>
            <label htmlFor={fieldId("platform")} className="mb-1 block text-sm font-medium text-body">
              Platform <span className="font-normal text-muted">(optional)</span>
            </label>
            <select
              id={fieldId("platform")}
              name="platform"
              value={fields.platform}
              onChange={(e) => update("platform", e.target.value)}
              className={inputClass}
            >
              {DRAFT_PLATFORM_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor={fieldId("variants")} className="mb-1 block text-sm font-medium text-body">
              Variants
            </label>
            <select
              id={fieldId("variants")}
              name="variants"
              value={fields.variants}
              onChange={(e) => update("variants", e.target.value)}
              aria-invalid={fieldErrors.variants ? true : undefined}
              aria-describedby={fieldErrors.variants ? errorId("variants") : undefined}
              className={inputClass}
            >
              {VARIANT_OPTIONS.map((n) => (
                <option key={n} value={String(n)}>
                  {n} {n === 1 ? "variant" : "variants"}
                </option>
              ))}
            </select>
            {fieldErrors.variants && (
              <p id={errorId("variants")} role="alert" className="mt-1 text-sm font-medium text-danger">
                {fieldErrors.variants}
              </p>
            )}
          </div>
        </div>

        {/* Must include / must avoid */}
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={fieldId("mustInclude")} className="mb-1 block text-sm font-medium text-body">
              Must include <span className="font-normal text-muted">(one per line, optional)</span>
            </label>
            <textarea
              id={fieldId("mustInclude")}
              name="mustInclude"
              rows={3}
              value={fields.mustInclude}
              onChange={(e) => update("mustInclude", e.target.value)}
              placeholder={"Free returns\n30-day trial"}
              aria-invalid={fieldErrors.mustInclude ? true : undefined}
              aria-describedby={fieldErrors.mustInclude ? errorId("mustInclude") : `${baseId}-mustInclude-hint`}
              className={inputClass}
            />
            {fieldErrors.mustInclude ? (
              <p id={errorId("mustInclude")} role="alert" className="mt-1 text-sm font-medium text-danger">
                {fieldErrors.mustInclude}
              </p>
            ) : (
              <p id={`${baseId}-mustInclude-hint`} className="mt-1 text-sm text-muted">
                Up to {MAX_CONSTRAINT_ITEMS} phrases woven into every draft.
              </p>
            )}
          </div>

          <div>
            <label htmlFor={fieldId("mustAvoid")} className="mb-1 block text-sm font-medium text-body">
              Must avoid <span className="font-normal text-muted">(one per line, optional)</span>
            </label>
            <textarea
              id={fieldId("mustAvoid")}
              name="mustAvoid"
              rows={3}
              value={fields.mustAvoid}
              onChange={(e) => update("mustAvoid", e.target.value)}
              placeholder={"cure\nguaranteed"}
              aria-invalid={fieldErrors.mustAvoid ? true : undefined}
              aria-describedby={fieldErrors.mustAvoid ? errorId("mustAvoid") : `${baseId}-mustAvoid-hint`}
              className={inputClass}
            />
            {fieldErrors.mustAvoid ? (
              <p id={errorId("mustAvoid")} role="alert" className="mt-1 text-sm font-medium text-danger">
                {fieldErrors.mustAvoid}
              </p>
            ) : (
              <p id={`${baseId}-mustAvoid-hint`} className="mt-1 text-sm text-muted">
                Words the drafts will never use.
              </p>
            )}
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
          {submitting ? "Drafting…" : "Draft copy"}
        </button>
      </form>

      <ResultPanel result={result} submitting={submitting} />
    </div>
  );
}

function ResultPanel({
  result,
  submitting,
}: {
  result: DraftResult | null;
  submitting: boolean;
}) {
  if (submitting) {
    return (
      <div
        role="status"
        className="flex items-center rounded-md border border-border bg-surface p-6 text-sm text-muted shadow-card"
      >
        Drafting copy from your brief…
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex items-center rounded-md border border-dashed border-border bg-canvas p-6 text-sm text-muted">
        Your draft variants will appear here once you run them.
      </div>
    );
  }

  return (
    <div role="status" aria-label="Draft variants" className="space-y-4">
      <div className="rounded-md border border-border bg-canvas p-4 text-sm text-body">
        <p className="font-medium text-navy">Draft suggestions — not a review</p>
        <p className="mt-1 text-muted">{result.disclaimer}</p>
      </div>

      <ul className="space-y-4">
        {result.drafts.map((draft) => (
          <li
            key={draft.variantLabel}
            className="rounded-md border border-border bg-surface p-5 shadow-card"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-lg font-semibold text-navy">{draft.variantLabel}</h3>
              <span className="shrink-0 rounded-full bg-canvas px-2 py-0.5 text-xs font-medium text-muted">
                {draft.angle}
              </span>
            </div>
            <p className="mt-3 text-base font-semibold text-ink">{draft.headline}</p>
            <p className="mt-1 break-words text-body">{draft.body}</p>
            <p className="mt-3 text-sm font-medium text-royal">{draft.cta}</p>
          </li>
        ))}
      </ul>

      <p className="text-sm text-muted">
        Generated by <span className="font-medium">{result.generator}</span>. Edit any
        variant, then submit the one you like as a{" "}
        <a
          href="/review"
          className="font-medium text-royal underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
        >
          new review
        </a>{" "}
        to have the jury score it.
      </p>
    </div>
  );
}
