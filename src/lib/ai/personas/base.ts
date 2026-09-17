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

/**
 * Shared suggested-rewrite guidance (Day 21 — Week 3 calibration). The output
 * contract already requires a rewrite, but gave the model no guardrails on WHAT
 * the rewrite may contain, so it was free to invent facts. That is a real risk:
 * the compliance juror could "fix" a claim by inventing substantiation or a
 * disclaimer (adding new risk instead of removing it), and any juror could add
 * numbers or product details that were never in the original. This fragment
 * keeps every rewrite truthful to the submitted content and scoped to the
 * juror's own lens (Rules.md §3 — the AI critiques, it does not fabricate).
 */
export const REWRITE_GUIDANCE = `
Suggested-rewrite guidance:
- Improve ONLY on your lens; keep the content's facts, offer, and intent intact.
- Never invent claims, statistics, prices, features, names, or disclaimers that
  are not already in the original — a rewrite must not add new risk or false
  specifics.
- If a claim is the problem, prefer softening or removing it over inventing
  substantiation. If nothing needs changing on your lens, return the original.`.trim();

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
    REWRITE_GUIDANCE,
    "",
    OUTPUT_CONTRACT,
    "",
    `Your persona machine-name is "${args.name}". Use it in the "persona" field.`,
  ].join("\n");
}
