/**
 * Brand profile CRUD (DailyPlan Day 26).
 *
 * An admin writes the company's tone/style guide once; Juror 1 (Brand Voice
 * Guardian) reviews content against it (PRD §5 juror 1, §6.1). This module owns
 * the pure pieces — the input contract, the length bounds, and the small display
 * predicates/helpers — so they are unit-testable without a database or React;
 * the DB read/write live in `queries.ts`, the decision/authz core in
 * `save-brand-profile.ts`, the server action in `actions.ts`, and the editor in
 * `components/company/brand-profile-form.tsx`.
 *
 * Wiring the stored guide into the review's `brand_context` is Day 27; the
 * brand-voice embedding cache is Days 29–30. This day is the create/edit surface
 * and its storage only.
 */
import { z } from "zod";
import { formatHistoryDate } from "@/lib/reviews/history-view";
import type { BrandProfileRow } from "@/types/db";

/**
 * A meaningful guide needs a little substance, but we keep the floor low so an
 * admin can start small and refine. The cap keeps the stored guide bounded and
 * (once Day 27 threads it into prompts) the review's token budget in check —
 * well under the review content cap so the two never fight.
 */
export const MIN_TONE_GUIDE_CHARS = 10;
export const MAX_TONE_GUIDE_CHARS = 8000;

/**
 * Brand profile input contract (Rules.md §3 — validate before trust). The same
 * schema guards the server action so a malformed or oversized submit is rejected
 * at the boundary. Tenancy (`company_id`) is never part of this — it is derived
 * from the session server-side (Rules.md §5).
 */
export const BrandProfileSchema = z.object({
  tone_guide_text: z
    .string()
    .trim()
    .min(
      MIN_TONE_GUIDE_CHARS,
      `Your brand guide needs at least ${MIN_TONE_GUIDE_CHARS} characters.`,
    )
    .max(
      MAX_TONE_GUIDE_CHARS,
      `Keep your brand guide to ${MAX_TONE_GUIDE_CHARS.toLocaleString()} characters or fewer.`,
    ),
});

export type BrandProfileInput = z.infer<typeof BrandProfileSchema>;

/**
 * Whether the company already has a usable brand guide. A row with no (or
 * whitespace-only) `tone_guide_text` counts as "not set" so the UI prompts the
 * admin to write one rather than showing an empty guide as complete.
 */
export function hasBrandProfile(
  profile: Pick<BrandProfileRow, "tone_guide_text"> | null,
): boolean {
  return Boolean(profile && (profile.tone_guide_text ?? "").trim().length > 0);
}

/** The stored guide's text for editing, or "" when none is set (never null). */
export function toneGuideText(
  profile: Pick<BrandProfileRow, "tone_guide_text"> | null,
): string {
  return profile?.tone_guide_text ?? "";
}

/**
 * The brand guide to inject into a review as `brand_context` (DailyPlan Day 27),
 * or `null` when the company has no usable guide. Trims first so a
 * whitespace-only row reads as "not set" (mirrors `hasBrandProfile`) and the
 * Brand Voice Guardian falls back to inferring a professional baseline rather
 * than being handed an empty guide. The full stored guide is passed verbatim
 * here; the brand-voice summary/embedding cache that avoids reprocessing it
 * every review is Days 29–30.
 */
export function resolveBrandContext(
  profile: Pick<BrandProfileRow, "tone_guide_text"> | null,
): string | null {
  const text = (profile?.tone_guide_text ?? "").trim();
  return text.length > 0 ? text : null;
}

/** Display date for when the guide was last saved (invalid/absent → null). */
export function brandProfileUpdatedAt(
  profile: Pick<BrandProfileRow, "updated_at"> | null,
): string | null {
  if (!profile?.updated_at) return null;
  const label = formatHistoryDate(profile.updated_at);
  return label === "Unknown date" ? null : label;
}

/** First human-readable validation message, for surfacing in the form. */
export function firstBrandProfileIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the form and try again.";
}
