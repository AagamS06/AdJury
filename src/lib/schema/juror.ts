import { z } from "zod";

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
] as const;

export const PersonaNameSchema = z.enum(PERSONA_NAMES);
export type PersonaName = z.infer<typeof PersonaNameSchema>;

export const SeveritySchema = z.enum(["high", "medium", "low"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const VerdictSchema = z.enum(["pass", "revise", "fail"]);
export type Verdict = z.infer<typeof VerdictSchema>;

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
  platform: z.string().nullable(),
  model: z.string(),
  created_at: z.string(),
  aggregate_score: z.number(),
  verdict: VerdictSchema,
  jurors: z.array(JurorSlotSchema),
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

/** Input accepted by the orchestrator. */
export const ReviewInputSchema = z.object({
  content_text: z.string().min(1, "Content is required").max(10_000),
  content_type: z.enum(["ad_copy", "social_post", "email", "landing_page"]),
  platform: z.string().nullable().default(null),
  brand_context: z.string().nullable().default(null),
});
export type ReviewInput = z.infer<typeof ReviewInputSchema>;

/**
 * The client-supplied fields of a review request (`POST /api/reviews`).
 * Deliberately a subset of ReviewInput: `company_id` / `submitted_by` are
 * derived from the session, and `brand_context` is loaded server-side from the
 * company's brand profile (Day 27) — none of these are ever trusted from the
 * client (Rules.md §5).
 */
export const ReviewRequestSchema = ReviewInputSchema.pick({
  content_text: true,
  content_type: true,
  platform: true,
});
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;
