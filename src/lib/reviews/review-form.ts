/**
 * Client-side form logic for the `/review` submission page (DailyPlan Day 8).
 *
 * Kept out of the React component so it is unit-testable in the node test env
 * (no jsdom): the option lists, the client-side Zod validation, and the fetch
 * mapping all live here. The component (`src/components/review/review-form.tsx`)
 * only holds state and renders.
 *
 * Client-side validation mirrors the server contract (`ReviewRequestSchema`) so
 * the user gets fast, specific feedback — but it is a convenience, not a trust
 * boundary. The API re-validates every field and derives tenancy from the
 * session, never the client (Rules.md §5/§6).
 */
import {
  ReviewRequestSchema,
  ReviewResultSchema,
  type PersonaName,
  type ReviewRequest,
  type ReviewResult,
} from "@/lib/schema/juror";

/** Max content length — mirrors `ReviewInputSchema.content_text` (10k chars). */
export const MAX_CONTENT_LENGTH = 10_000;

/** Content-type select options — labels for the four schema enum values. */
export const CONTENT_TYPE_OPTIONS = [
  { value: "ad_copy", label: "Ad copy" },
  { value: "social_post", label: "Social post" },
  { value: "email", label: "Email" },
  { value: "landing_page", label: "Landing page" },
] as const;

/**
 * Platform select options. `platform` is a free-form nullable string in the
 * contract; these are a curated set for the common cases. The empty value maps
 * to `null` ("not platform-specific").
 */
export const PLATFORM_OPTIONS = [
  { value: "", label: "General / not specified" },
  { value: "google", label: "Google" },
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "x", label: "X (Twitter)" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
  { value: "email", label: "Email / newsletter" },
  { value: "website", label: "Website / blog" },
] as const;

/** Human-readable labels for the five jurors (for the result summary). */
export const PERSONA_LABELS: Record<PersonaName, string> = {
  brand_voice_guardian: "Brand Voice Guardian",
  compliance_legal_flagger: "Compliance & Legal Flagger",
  target_audience_fit: "Target Audience Fit",
  seo_discoverability: "SEO / Discoverability",
  stop_scrolling: "Would I Stop Scrolling",
};

/** The raw string values the form holds (a select's value is always a string). */
export interface ReviewFormFields {
  content_text: string;
  content_type: string;
  /** "" means "not specified" and maps to `null`. */
  platform: string;
}

export type ReviewFieldErrors = Partial<
  Record<keyof ReviewFormFields, string>
>;

export type ReviewFormValidation =
  | { ok: true; data: ReviewRequest }
  | { ok: false; fieldErrors: ReviewFieldErrors };

/**
 * Validate the form fields against the shared request contract. Trims the
 * content, maps an empty platform to `null`, and returns either the parsed
 * request or a per-field error map with plain-language messages (Design.md §7).
 */
export function validateReviewForm(
  fields: ReviewFormFields,
): ReviewFormValidation {
  const candidate = {
    content_text: fields.content_text.trim(),
    content_type: fields.content_type,
    platform: fields.platform.trim() === "" ? null : fields.platform.trim(),
  };

  const parsed = ReviewRequestSchema.safeParse(candidate);
  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }

  const fieldErrors: ReviewFieldErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if (typeof key !== "string" || key in fieldErrors) continue;
    if (key === "content_type") {
      fieldErrors.content_type = "Choose a content type.";
    } else if (key === "content_text" || key === "platform") {
      fieldErrors[key] = issue.message;
    }
  }
  // Defensive: guarantee at least one message so the UI never shows an empty error.
  if (Object.keys(fieldErrors).length === 0) {
    fieldErrors.content_text = "Please check your input and try again.";
  }
  return { ok: false, fieldErrors };
}

export type SubmitReviewOutcome =
  | { ok: true; review: ReviewResult }
  | { ok: false; message: string };

/**
 * POST the validated request to `/api/reviews` and map the outcome to a
 * discriminated union the component can render. `fetchImpl` is injectable so
 * this is testable without a network. The success payload is re-validated
 * against `ReviewResultSchema` so a malformed response is surfaced as an error
 * rather than rendered as a review.
 */
export async function submitReview(
  data: ReviewRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<SubmitReviewOutcome> {
  let response: Response;
  try {
    response = await fetchImpl("/api/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } catch {
    return {
      ok: false,
      message: "Network error — check your connection and try again.",
    };
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (response.ok) {
    const parsed = ReviewResultSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        ok: false,
        message: "The server returned an unexpected response. Please try again.",
      };
    }
    return { ok: true, review: parsed.data };
  }

  const message =
    payload &&
    typeof payload === "object" &&
    typeof (payload as { error?: unknown }).error === "string"
      ? (payload as { error: string }).error
      : "Something went wrong submitting your review. Please try again.";
  return { ok: false, message };
}
