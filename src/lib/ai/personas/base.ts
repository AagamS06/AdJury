import type { PersonaName } from "@/lib/schema/juror";

export interface Persona {
  /** Stable machine name — must match PersonaName in the schema. */
  name: PersonaName;
  /** Human-readable title for UI. */
  title: string;
  /** One-line description of this juror's lens. */
  lens: string;
  /** The full system prompt sent to the model. */
  systemPrompt: string;
}

/**
 * The output contract fragment appended to every persona's system prompt.
 * It forces JSON-only output matching JurorResultSchema (PRD.md §7).
 */
export const OUTPUT_CONTRACT = `
You must respond with a SINGLE JSON object and NOTHING else — no prose, no
markdown fences, no commentary before or after. The object must match exactly:

{
  "persona": "<your persona machine-name>",
  "score": <integer 0-10>,
  "confidence": "high" | "medium" | "low",
  "summary": "<one sentence, plain and specific>",
  "issues": [
    { "severity": "high" | "medium" | "low", "excerpt": "<quoted text from the content>", "explanation": "<why it's an issue on your lens>" }
  ],
  "suggested_rewrite": "<an improved version of the content on your lens; if nothing needs changing, return the original text>"
}

Rules:
- "issues" may be an empty array, but the key must be present.
- "suggested_rewrite" is ALWAYS required and must be non-empty.
- Score only on YOUR lens; ignore concerns that belong to other jurors.
- Be specific and constructive: name the problem, then fix it.`.trim();

/** Shared 0-10 anchors so scores are comparable across jurors (PRD.md §5.1). */
export const SHARED_ANCHORS = `
Scoring anchors (apply to your lens):
- 9-10: Excellent. Ship as-is; only nitpicks.
- 7-8:  Good. Minor improvements suggested.
- 5-6:  Mixed. Real issues; revise before publishing.
- 3-4:  Weak. Significant problems on this lens.
- 0-2:  Failing. Do not publish; major rework needed.`.trim();

/**
 * Shared confidence rubric (Day 7 calibration). Confidence is part of the
 * contract (PRD.md §7) but the personas previously gave the model no guidance on
 * when to use each level, so it was reported inconsistently. Report how sure you
 * are of the SCORE, independent of how good the content is — a low score can be
 * high-confidence. Keeps confidence comparable across the five jurors.
 */
export const CONFIDENCE_GUIDANCE = `
Confidence guidance (how sure you are of THIS score, not how good the content is):
- high:   the content clearly sits in this band; little ambiguity on your lens.
- medium: a defensible judgement, but context or intent could reasonably shift it.
- low:    limited signal — very short content, or missing brand/audience context.`.trim();

/** Compose a full system prompt from a persona's role and lens-specific rubric. */
export function composeSystemPrompt(args: {
  name: PersonaName;
  role: string;
  rubric: string;
}): string {
  return [
    args.role.trim(),
    "",
    args.rubric.trim(),
    "",
    SHARED_ANCHORS,
    "",
    CONFIDENCE_GUIDANCE,
    "",
    OUTPUT_CONTRACT,
    "",
    `Your persona machine-name is "${args.name}". Use it in the "persona" field.`,
  ].join("\n");
}
