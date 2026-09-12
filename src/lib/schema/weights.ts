import { z } from "zod";
import { PERSONA_NAMES, type PersonaName } from "./juror";

/**
 * Per-company juror weighting contract (DailyPlan Day 16; PRD.md §5.2, §6.3).
 *
 * The aggregate score is a weighted mean of the five juror scores. Weights
 * default to equal (0.2 each) and are configurable per company; this module
 * defines the *shape* of a stored/incoming weight config. The default map and
 * the resolve/compute logic live in `src/lib/scoring.ts`.
 */

/** A complete set of per-juror weights — every persona present. */
export type PersonaWeights = Record<PersonaName, number>;

/**
 * A stored or incoming per-company weight config. Any subset of jurors may be
 * specified; unspecified jurors fall back to the default weight when resolved
 * (see `resolveWeights`). Stored as `companies.juror_weights` (jsonb), null
 * meaning "use the equal default".
 */
export type PersonaWeightsConfig = Partial<Record<PersonaName, number>>;

/** A single weight: a finite, non-negative number (0 disables that juror). */
const WeightValueSchema = z.number().finite().nonnegative();

/**
 * Validation contract for a per-company weight config — the jsonb column and
 * the future admin edit path. Any subset of the five jurors may be given; each
 * weight must be a finite, non-negative number, at least one must be > 0 (an
 * all-zero config carries no signal), and unknown persona keys are rejected
 * (Rules.md §3 — config is untrusted input, validate before trust).
 */
export const PersonaWeightsInputSchema = z
  .object({
    brand_voice_guardian: WeightValueSchema,
    compliance_legal_flagger: WeightValueSchema,
    target_audience_fit: WeightValueSchema,
    seo_discoverability: WeightValueSchema,
    stop_scrolling: WeightValueSchema,
  })
  .partial()
  .strict()
  .refine((w) => PERSONA_NAMES.some((p) => (w[p] ?? 0) > 0), {
    message: "At least one juror weight must be greater than zero.",
  });
export type PersonaWeightsInput = z.infer<typeof PersonaWeightsInputSchema>;
