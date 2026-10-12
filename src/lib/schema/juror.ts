import { z } from "zod";
import { MAX_CONTENT_CHARS } from "@/lib/ai/cost";

/**
 * The juror JSON contract. This is the single source of truth that every
 * persona response is validated against, and it mirrors PRD.md §7.
 * Do not change this without updating PRD.md and the DB persistence mapping.
 */

export const PERSONA_NAMES = [
  "brand_voice_guardian",
  "compliance_legal_flagger",
  "target_audience_fit",
  "seo_discoverability",
  "stop_scrolling",
  // Day 23b — a sixth juror briefed on the spot as the posting company's own
  // Business Analyst, giving a secondary "insider" read grounded in the
  // business context researched from public sources (PRD §5). Appended last so
  // the five original jurors keep their canonical order.
  "business_analyst",
] as const;

export const PersonaNameSchema = z.enum(PERSONA_NAMES);
export type PersonaName = z.infer<typeof PersonaNameSchema>;

export const SeveritySchema = z.enum(["high", "medium", "low"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const VerdictSchema = z.enum(["pass", "revise", "fail"]);
export type Verdict = z.infer<typeof VerdictSchema>;

/**
 * Ad formats AdJury can review (Day 15a — multi-format input). `text` is a pure
 * copy ad; `image` is a visual ad (static creative) reviewed together with its
 * accompanying copy (caption / headline / CTA). Short- and long-form **video**
 * are planned later (they need a transcription + frame-sampling pipeline) and are
 * deliberately not in this enum yet — see DailyPlan Week 13+/PRD §6.3.
 */
export const MEDIA_TYPES = ["text", "image"] as const;
export const MediaTypeSchema = z.enum(MEDIA_TYPES);
export type MediaType = z.infer<typeof MediaTypeSchema>;

export const IssueSchema = z.object({
  severity: SeveritySchema,
  excerpt: z.string().min(1),
  explanation: z.string().min(1),
});
export type Issue = z.infer<typeof IssueSchema>;

/** What a single juror returns. Model output is validated against this. */
export const JurorResultSchema = z.object({
  persona: PersonaNameSchema,
  score: z.number().int().min(0).max(10),
  confidence: ConfidenceSchema,
  summary: z.string().min(1),
  issues: z.array(IssueSchema),
  suggested_rewrite: z.string().min(1),
});
export type JurorResult = z.infer<typeof JurorResultSchema>;

/**
 * A juror slot in the final review. Either a validated result, or an error
 * marker if the model failed to return valid JSON after one retry
 * (a single juror failing must never fail the whole review — see Rules.md §6).
 */
export const JurorSlotSchema = z.union([
  JurorResultSchema.extend({ status: z.literal("ok").default("ok") }),
  z.object({
    persona: PersonaNameSchema,
    status: z.literal("error"),
    error: z.string(),
  }),
]);
export type JurorSlot = z.infer<typeof JurorSlotSchema>;

/** The composed review returned by the orchestrator and stored in the DB. */
export const ReviewResultSchema = z.object({
  review_id: z.string(),
  content_type: z.string(),
  /** Ad format (Day 15a): `text` or `image`. Defaults to `text` for back-compat. */
  media_type: MediaTypeSchema.default("text"),
  platform: z.string().nullable(),
  model: z.string(),
  created_at: z.string(),
  aggregate_score: z.number(),
  verdict: VerdictSchema,
  jurors: z.array(JurorSlotSchema),
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

/** Accepted image MIME types for an image ad (what the model's vision input supports). */
export const IMAGE_MIME_RE = /^image\/(png|jpeg|jpg|webp|gif)$/i;

/**
 * An image ad's visual. `data_url` is either a `data:` URL (base64, the upload
 * path) or an `https:` URL. Bounded so a payload can't blow the request/cost
 * budget; the size guard lives in `lib/ai/cost.ts` and is enforced server-side.
 */
export const ReviewImageSchema = z.object({
  data_url: z.string().min(1, "Image data is required for an image ad."),
  mime_type: z
    .string()
    .regex(IMAGE_MIME_RE, "Image must be a PNG, JPEG, WebP, or GIF."),
});
export type ReviewImage = z.infer<typeof ReviewImageSchema>;

/**
 * The review input fields, before the cross-field media refinement. Kept as a
 * plain object so both `ReviewInputSchema` and `ReviewRequestSchema` can `.pick`
 * from it and then apply the same refinement (a `.superRefine` result can't be
 * `.pick`ed).
 */
const ReviewFields = z.object({
  content_text: z
    .string()
    .min(1, "Content is required")
    .max(
      MAX_CONTENT_CHARS,
      `Content must be ${MAX_CONTENT_CHARS.toLocaleString()} characters or fewer.`,
    ),
  content_type: z.enum(["ad_copy", "social_post", "email", "landing_page"]),
  platform: z.string().nullable().default(null),
  brand_context: z.string().nullable().default(null),
  /**
   * Bounded business-context summary (Day 23a): what business the ad is for — its
   * field and likely audience. Resolved server-side from the company's identity +
   * cached research (never the client — Rules.md §5) and injected into every
   * juror so each judges the ad in the right business context (PRD §4/§5). Null
   * when the company has no usable identity.
   */
  business_context: z.string().nullable().default(null),
  /** Ad format (Day 15a). Defaults to `text` so every existing caller is unchanged. */
  media_type: MediaTypeSchema.default("text"),
  /**
   * The image for an `image` ad; null for a `text` ad. For an image ad the
   * `content_text` carries the accompanying copy (caption / headline / CTA) that
   * every juror reviews alongside the visual, so it stays required.
   */
  image: ReviewImageSchema.nullable().default(null),
});

/**
 * Require the image when (and only when) the ad is an image ad. Keeps the two
 * fields consistent at the boundary (Rules.md §6) rather than trusting them to
 * match. A `text` ad with a stray image is rejected too, so the format a juror is
 * told about always matches what it is given.
 */
function refineMedia(
  data: { media_type: MediaType; image: ReviewImage | null },
  ctx: z.RefinementCtx,
): void {
  if (data.media_type === "image" && !data.image) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["image"],
      message: "An image is required for an image ad.",
    });
  }
  if (data.media_type === "text" && data.image) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["image"],
      message: "A text ad must not include an image.",
    });
  }
}

/** Input accepted by the orchestrator. */
export const ReviewInputSchema = ReviewFields.superRefine(refineMedia);
export type ReviewInput = z.infer<typeof ReviewInputSchema>;

/**
 * The client-supplied fields of a review request (`POST /api/reviews`).
 * Deliberately a subset of the review fields: `company_id` / `submitted_by` are
 * derived from the session, and `brand_context` / `business_context` are resolved
 * server-side — none of these are ever trusted from the client (Rules.md §5). The
 * client does choose the ad `media_type` and supply the `image`, which the same
 * media refinement keeps consistent.
 */
export const ReviewRequestSchema = ReviewFields.pick({
  content_text: true,
  content_type: true,
  platform: true,
  media_type: true,
  image: true,
}).superRefine(refineMedia);
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;
