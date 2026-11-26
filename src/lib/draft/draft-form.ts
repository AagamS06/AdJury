/**
 * Client-side form logic for the `/draft` page (DailyPlan Day 89).
 *
 * Kept out of the React component so it is unit-testable in the node env (no
 * jsdom): the option lists, the client-side validation (reusing the shared
 * `DraftRequestSchema`), the list-field parsing, and the fetch mapping all live
 * here. The component (`src/components/draft/draft-form.tsx`) only holds state
 * and renders.
 *
 * Client validation mirrors the server contract so the user gets fast, specific
 * feedback — but it is a convenience, not a trust boundary. `POST /api/draft`
 * re-validates every field and derives identity from the session, never the
 * client (Rules.md §5/§6).
 */
import {
  DRAFT_CONTENT_TYPES,
  DRAFT_TONES,
  DraftRequestSchema,
  DraftResultSchema,
  MAX_CONSTRAINT_ITEMS,
  MAX_DRAFT_VARIANTS,
  MAX_KEY_MESSAGE_CHARS,
  MAX_PRODUCT_CHARS,
  MIN_DRAFT_VARIANTS,
  type DraftRequest,
  type DraftResult,
} from "@/lib/draft/draft-assistant";

/** Tone select options — labels for the closed tone vocabulary. */
export const TONE_OPTIONS: ReadonlyArray<{ value: (typeof DRAFT_TONES)[number]; label: string }> = [
  { value: "professional", label: "Professional" },
  { value: "friendly", label: "Friendly" },
  { value: "bold", label: "Bold" },
  { value: "playful", label: "Playful" },
  { value: "urgent", label: "Urgent" },
  { value: "empathetic", label: "Empathetic" },
];

/** Content-type select options — labels for the four draft content types. */
export const DRAFT_CONTENT_TYPE_OPTIONS: ReadonlyArray<{
  value: (typeof DRAFT_CONTENT_TYPES)[number];
  label: string;
}> = [
  { value: "ad_copy", label: "Ad copy" },
  { value: "social_post", label: "Social post" },
  { value: "email", label: "Email" },
  { value: "landing_page", label: "Landing page" },
];

/**
 * Platform select options — `platform` is a free-form nullable string in the
 * contract; these are a curated set for the common cases, shared in spirit with
 * the review form. The empty value maps to `null` ("not platform-specific").
 */
export const DRAFT_PLATFORM_OPTIONS = [
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

/** Variant-count options (MIN..MAX), so the control can't request out of range. */
export const VARIANT_OPTIONS: readonly number[] = Array.from(
  { length: MAX_DRAFT_VARIANTS - MIN_DRAFT_VARIANTS + 1 },
  (_, i) => MIN_DRAFT_VARIANTS + i,
);

export { MAX_PRODUCT_CHARS, MAX_KEY_MESSAGE_CHARS, MAX_CONSTRAINT_ITEMS };

/** The raw string values the form holds (a text input / select value is a string). */
export interface DraftFormFields {
  product: string;
  audience: string;
  keyMessage: string;
  tone: string;
  content_type: string;
  /** "" means "not specified" and maps to `null`. */
  platform: string;
  /** Must-include phrases, one per line. */
  mustInclude: string;
  /** Must-avoid words, one per line. */
  mustAvoid: string;
  /** Variant count as a string (a select's value is always a string). */
  variants: string;
}

export type DraftFieldErrors = Partial<Record<keyof DraftFormFields, string>>;

export type DraftFormValidation =
  | { ok: true; data: DraftRequest }
  | { ok: false; fieldErrors: DraftFieldErrors };

/**
 * Split a multi-line list field into trimmed, non-empty items. Accepts newline
 * OR comma separators so paste-from-anywhere works, and drops blanks so a
 * trailing newline never becomes an empty constraint.
 */
export function parseListField(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** Which form field a schema issue path maps to (so the error lands on the right control). */
function fieldForIssuePath(path: PropertyKey | undefined): keyof DraftFormFields | null {
  switch (path) {
    case "product":
    case "audience":
    case "keyMessage":
    case "tone":
    case "content_type":
    case "platform":
    case "mustInclude":
    case "mustAvoid":
    case "variants":
      return path;
    default:
      return null;
  }
}

/**
 * Validate the form fields against the shared request contract. Trims and maps
 * the raw fields into a candidate brief, parses the list fields, maps an empty
 * platform to `null`, and returns either the parsed request or a per-field error
 * map with plain-language messages (Design.md §7).
 */
export function validateDraftForm(fields: DraftFormFields): DraftFormValidation {
  const variantsNum = Number(fields.variants);
  const candidate = {
    product: fields.product.trim(),
    audience: fields.audience.trim(),
    keyMessage: fields.keyMessage.trim(),
    tone: fields.tone,
    content_type: fields.content_type,
    platform: fields.platform.trim() === "" ? null : fields.platform.trim(),
    mustInclude: parseListField(fields.mustInclude),
    mustAvoid: parseListField(fields.mustAvoid),
    variants: Number.isFinite(variantsNum) ? variantsNum : fields.variants,
  };

  const parsed = DraftRequestSchema.safeParse(candidate);
  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }

  const fieldErrors: DraftFieldErrors = {};
  for (const issue of parsed.error.issues) {
    const key = fieldForIssuePath(issue.path[0]);
    if (!key || key in fieldErrors) continue;
    fieldErrors[key] =
      key === "content_type"
        ? "Choose a content type."
        : key === "tone"
          ? "Choose a tone."
          : issue.message;
  }
  // Defensive: guarantee at least one message so the UI never shows an empty error.
  if (Object.keys(fieldErrors).length === 0) {
    fieldErrors.product = "Please check your input and try again.";
  }
  return { ok: false, fieldErrors };
}

export type SubmitDraftOutcome =
  | { ok: true; result: DraftResult }
  | { ok: false; message: string };

/**
 * POST the validated request to `/api/draft` and map the outcome to a
 * discriminated union the component can render. `fetchImpl` is injectable so
 * this is testable without a network. The success payload is re-validated
 * against `DraftResultSchema` so a malformed response is surfaced as an error
 * rather than rendered as drafts.
 */
export async function submitDraft(
  data: DraftRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<SubmitDraftOutcome> {
  let response: Response;
  try {
    response = await fetchImpl("/api/draft", {
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
    const parsed = DraftResultSchema.safeParse(payload);
    if (!parsed.success) {
      return {
        ok: false,
        message: "The server returned an unexpected response. Please try again.",
      };
    }
    return { ok: true, result: parsed.data };
  }

  const message =
    payload &&
    typeof payload === "object" &&
    typeof (payload as { error?: unknown }).error === "string"
      ? (payload as { error: string }).error
      : "Something went wrong drafting your copy. Please try again.";
  return { ok: false, message };
}
