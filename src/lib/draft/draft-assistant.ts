/**
 * Draft Assistant — optional ad-copy generation (DailyPlan Day 87).
 *
 * AdJury is, and stays, a **QA / review layer, not a content generator**
 * (Rules.md §1; PRD §1/§3). The Draft Assistant is the one deliberate, clearly
 * *separate* exception the PRD carves out (§6.3): an **optional** mode that
 * drafts ad copy from a brief, kept strictly distinct from the jury so the
 * critique never grades its own output. It is additive, not a pivot — the jury
 * is untouched, and generation and judgement are two different code paths with
 * **no automatic loop** between them.
 *
 *   brief ─► [generator] ─► AdDraft[]            (the human edits + approves)
 *            offline default: deterministic,       …and may THEN choose to submit
 *            composes the brief into variants       a draft as a NEW review — a
 *            (invents no facts). Live swap-in:       separate, human-initiated act,
 *            one Claude call behind lib/ai/client.   never done automatically here.
 *
 * The separation is a load-bearing invariant, not a convention:
 *  - This module imports neither the orchestrator (`runReview`) nor any persona.
 *    Generation can therefore never invoke the jury. (`draft-assistant-readiness.ts`
 *    proves this by scanning this file's own source — the executable guarantee.)
 *  - An {@link AdDraft} is plain copy (headline / body / CTA). It carries no
 *    `score`, `verdict`, `confidence`, or `persona` — it is not, and cannot be
 *    mistaken for, a juror result.
 *  - Every result ships the {@link DRAFT_DISCLAIMER}: drafts are AI-generated
 *    starting points a human must review before publishing, and AdJury does not
 *    auto-grade its own drafts.
 *
 * Honesty of the offline generator (mirrors Rules.md §3 "grounded, not
 * invented", exactly like the offline business researcher and video processor):
 * it **fabricates no facts** — no invented statistics, prices, dates, customers,
 * or claims. It only *rearranges the advertiser's own brief* into ad-copy shape
 * using a fixed, claim-free scaffolding vocabulary (tone phrasing + CTA verbs).
 * So every digit in a draft came from the brief, and nothing the advertiser
 * asked to avoid can appear. A live, Claude-backed generator ({@link
 * modelDraftGenerator}) produces richer copy behind the same interface.
 *
 * ── Live model generation (needs a credential — owner action) ─────────────────
 * {@link modelDraftGenerator} makes ONE model call via the shared provider
 * client (Rules.md §2 — one provider behind `lib/ai/client.ts`). With no
 * `AI_API_KEY` the client is the offline mock, which only produces juror JSON,
 * so the model generator refuses to run on it; use the offline generator (the
 * default) instead. Wiring a separate `/draft` route + UI is the next increment
 * and is documented in `docs/DRAFT_ASSISTANT.md`; the public review endpoint is
 * untouched, so the jury path is unchanged.
 */
import { z } from "zod";
import type { ModelClient } from "@/lib/ai/client";

/**
 * Tone vocabulary — a small, closed set so a brief is bounded and the offline
 * generator is deterministic. The phrasing each tone contributes is claim-free
 * (an adjective and a call-to-action verb), never a factual assertion.
 */
export const DRAFT_TONES = [
  "professional",
  "friendly",
  "bold",
  "playful",
  "urgent",
  "empathetic",
] as const;
export const DraftToneSchema = z.enum(DRAFT_TONES);
export type DraftTone = z.infer<typeof DraftToneSchema>;

/** Content types a draft can target — the same set a review accepts (`juror.ts`). */
export const DRAFT_CONTENT_TYPES = [
  "ad_copy",
  "social_post",
  "email",
  "landing_page",
] as const;
export const DraftContentTypeSchema = z.enum(DRAFT_CONTENT_TYPES);
export type DraftContentType = z.infer<typeof DraftContentTypeSchema>;

/** Field bounds, so a brief can't blow the request/cost budget (Rules.md §1/§6). */
export const MAX_PRODUCT_CHARS = 200;
export const MAX_AUDIENCE_CHARS = 200;
export const MAX_KEY_MESSAGE_CHARS = 500;
export const MAX_CONSTRAINT_CHARS = 120;
export const MAX_CONSTRAINT_ITEMS = 8;
/** At least one draft; a handful at most (each is cheap, but keep the brief bounded). */
export const MIN_DRAFT_VARIANTS = 1;
export const MAX_DRAFT_VARIANTS = 5;

/** Output bounds for a single draft (shared by the offline composer and the model-output validator). */
export const MAX_HEADLINE_CHARS = 120;
export const MAX_BODY_CHARS = 600;
export const MAX_CTA_CHARS = 40;

/**
 * A draft brief: what the advertiser wants drafted. Every field is the
 * advertiser's own input — the generator introduces no facts beyond it.
 */
export interface DraftBrief {
  /** What is being advertised (product / service / offer). Required. */
  product: string;
  /** Who it is for. Required — copy with no audience is untargeted. */
  audience: string;
  /** The core message / benefit to land. Required. */
  keyMessage: string;
  /** Desired tone (closed vocabulary). */
  tone: DraftTone;
  /** Target content type (ad copy, social post, email, landing page). */
  content_type: DraftContentType;
  /** Target platform, or null. */
  platform: string | null;
  /** Phrases/claims the advertiser requires in the copy (woven into every draft). */
  mustInclude: string[];
  /** Words/claims to avoid — never emitted by the offline generator. */
  mustAvoid: string[];
  /** How many draft variants to produce (`MIN_DRAFT_VARIANTS`..`MAX_DRAFT_VARIANTS`). */
  variants: number;
}

/**
 * One generated draft. Plain ad copy — **not** a juror result: it deliberately
 * carries no score / verdict / confidence / persona, so it can never be confused
 * with (or fed back into) the jury.
 */
export interface AdDraft {
  /** "Variant A", "Variant B", … — a stable label for the variant. */
  variantLabel: string;
  /** The creative angle this variant takes (structural, not a factual claim). */
  angle: string;
  /** The hook / headline. */
  headline: string;
  /** The body copy. */
  body: string;
  /** The call to action. */
  cta: string;
}

/** Zod schema for a draft — used to validate *model* output before trust (Rules.md §3). */
export const AdDraftSchema = z.object({
  variantLabel: z.string().min(1).max(40),
  angle: z.string().min(1).max(60),
  headline: z.string().min(1).max(MAX_HEADLINE_CHARS),
  body: z.string().min(1).max(MAX_BODY_CHARS),
  cta: z.string().min(1).max(MAX_CTA_CHARS),
});

/**
 * The disclaimer shipped with every result. It is what keeps the QA-layer
 * identity honest: these are suggestions, a human owns the final copy, and the
 * jury does not automatically grade AdJury's own drafts.
 */
export const DRAFT_DISCLAIMER =
  "Draft suggestions only — not a review. AdJury is a QA layer: these are " +
  "AI-generated starting points for a person to edit and approve before " +
  "publishing. The jury does not automatically grade AdJury's own drafts; to " +
  "check a draft, submit it as a new review yourself.";

/** A complete Draft Assistant result: the brief, the drafts, and provenance. */
export interface DraftResult {
  brief: DraftBrief;
  drafts: AdDraft[];
  /** Which generator produced the drafts — `offline` or the live model's name. */
  generator: string;
  /** The standing disclaimer ({@link DRAFT_DISCLAIMER}). */
  disclaimer: string;
}

/** Collapse whitespace runs to single spaces and trim. */
function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Why a brief was rejected before any generation (Rules.md §6 — specific, plain-language). */
export type DraftBriefRejection =
  | { code: "missing_field"; field: "product" | "audience" | "keyMessage"; message: string }
  | { code: "field_too_long"; field: string; message: string; limit: number; actual: number }
  | { code: "too_many_constraints"; field: "mustInclude" | "mustAvoid"; message: string; limit: number; actual: number }
  | { code: "variants_out_of_range"; message: string; min: number; max: number; actual: number }
  | { code: "contradictory_constraint"; message: string; term: string };

export type DraftBriefDecision = { ok: true } | ({ ok: false } & DraftBriefRejection);

/** Required free-text fields and their caps. */
const REQUIRED_FIELDS: ReadonlyArray<{
  key: "product" | "audience" | "keyMessage";
  label: string;
  max: number;
}> = [
  { key: "product", label: "product", max: MAX_PRODUCT_CHARS },
  { key: "audience", label: "audience", max: MAX_AUDIENCE_CHARS },
  { key: "keyMessage", label: "key message", max: MAX_KEY_MESSAGE_CHARS },
];

/**
 * Validate a brief at the boundary, before any generation or model spend
 * (Rules.md §6; §1 cost discipline). Checks the required fields are present and
 * within their caps, the constraint lists are bounded, the variant count is in
 * range, and — crucially — that no `mustAvoid` term also appears in the brief's
 * own copy (a contradiction the offline generator could not honour).
 */
export function checkDraftBrief(brief: DraftBrief): DraftBriefDecision {
  for (const { key, label, max } of REQUIRED_FIELDS) {
    const value = normalize(brief[key]);
    if (value.length === 0) {
      return {
        ok: false,
        code: "missing_field",
        field: key,
        message: `Add the ${label} to draft ad copy.`,
      };
    }
    if (value.length > max) {
      return {
        ok: false,
        code: "field_too_long",
        field: key,
        message: `The ${label} must be ${max} characters or fewer.`,
        limit: max,
        actual: value.length,
      };
    }
  }

  for (const field of ["mustInclude", "mustAvoid"] as const) {
    const items = brief[field];
    if (items.length > MAX_CONSTRAINT_ITEMS) {
      return {
        ok: false,
        code: "too_many_constraints",
        field,
        message: `Provide at most ${MAX_CONSTRAINT_ITEMS} ${field === "mustInclude" ? "must-include" : "must-avoid"} items.`,
        limit: MAX_CONSTRAINT_ITEMS,
        actual: items.length,
      };
    }
    for (const item of items) {
      if (normalize(item).length > MAX_CONSTRAINT_CHARS) {
        return {
          ok: false,
          code: "field_too_long",
          field,
          message: `Each ${field === "mustInclude" ? "must-include" : "must-avoid"} item must be ${MAX_CONSTRAINT_CHARS} characters or fewer.`,
          limit: MAX_CONSTRAINT_CHARS,
          actual: normalize(item).length,
        };
      }
    }
  }

  if (
    !Number.isInteger(brief.variants) ||
    brief.variants < MIN_DRAFT_VARIANTS ||
    brief.variants > MAX_DRAFT_VARIANTS
  ) {
    return {
      ok: false,
      code: "variants_out_of_range",
      message: `Choose between ${MIN_DRAFT_VARIANTS} and ${MAX_DRAFT_VARIANTS} draft variants.`,
      min: MIN_DRAFT_VARIANTS,
      max: MAX_DRAFT_VARIANTS,
      actual: brief.variants,
    };
  }

  // A must-avoid term that already appears in the brief's own copy is a
  // contradiction the generator cannot satisfy — reject it plainly rather than
  // silently emit the term (or silently drop the advertiser's own words).
  const briefCorpus = [
    brief.product,
    brief.audience,
    brief.keyMessage,
    ...brief.mustInclude,
  ]
    .join(" ")
    .toLowerCase();
  for (const avoid of brief.mustAvoid) {
    const term = normalize(avoid).toLowerCase();
    if (term.length > 0 && briefCorpus.includes(term)) {
      return {
        ok: false,
        code: "contradictory_constraint",
        message: `"${normalize(avoid)}" is in your brief but also listed to avoid. Remove it from one of them.`,
        term: normalize(avoid),
      };
    }
  }

  return { ok: true };
}

/**
 * A draft generator. Injectable so the deterministic offline default can be
 * swapped for the live Claude-backed one without touching callers — exactly how
 * the model client swaps in behind the offline mock, and the video processor
 * behind its offline default.
 */
export interface DraftGenerator {
  /** Provenance label recorded on the result (`offline` or the model name). */
  readonly name: string;
  generate(brief: DraftBrief): AdDraft[] | Promise<AdDraft[]>;
}

/** Tone-specific phrasing: a claim-free lead adjective and a CTA. No facts, no auth-term collisions. */
const TONE_STYLE: Record<DraftTone, { lead: string; cta: string }> = {
  professional: { lead: "A considered choice", cta: "Learn more" },
  friendly: { lead: "Made with you in mind", cta: "See how it works" },
  bold: { lead: "Don't settle", cta: "Get started today" },
  playful: { lead: "Say hello to", cta: "Take a look" },
  urgent: { lead: "Now is the moment", cta: "Start today" },
  empathetic: { lead: "We get it", cta: "Discover how we can help" },
};

/** The creative angles the offline generator cycles through, in order. */
interface Angle {
  label: string;
  headline(brief: DraftBrief, style: { lead: string }): string;
  body(brief: DraftBrief): string;
}

const ANGLES: readonly Angle[] = [
  {
    label: "benefit-led",
    headline: (b) => `${capitalize(b.keyMessage)}`,
    body: (b) => `${capitalize(b.product)} for ${b.audience}. ${capitalize(b.keyMessage)}.`,
  },
  {
    label: "problem-solution",
    headline: (b) => `For ${b.audience}: ${lower(b.keyMessage)}`,
    body: (b) =>
      `For ${b.audience}, ${lower(b.product)} helps you ${lower(b.keyMessage)}.`,
  },
  {
    label: "direct-offer",
    headline: (b, s) => `${s.lead}: ${capitalize(b.product)}`,
    body: (b) => `${capitalize(b.product)}, built for ${b.audience}. ${capitalize(b.keyMessage)}.`,
  },
  {
    label: "question-hook",
    headline: (b) => `${capitalize(b.audience)}, want ${lower(b.keyMessage)}?`,
    body: (b) => `${capitalize(b.product)} is how ${b.audience} ${lower(b.keyMessage)}.`,
  },
  {
    label: "outcome",
    headline: (b) => `Picture this: ${lower(b.keyMessage)}`,
    body: (b) => `That's what ${lower(b.product)} gives ${b.audience}. ${capitalize(b.keyMessage)}.`,
  },
];

function capitalize(text: string): string {
  const t = normalize(text);
  return t.length === 0 ? t : t[0].toUpperCase() + t.slice(1);
}

function lower(text: string): string {
  const t = normalize(text);
  return t.length === 0 ? t : t[0].toLowerCase() + t.slice(1);
}

/** Append the must-include phrases to a body (so they appear in every draft), bounded. */
function weaveMustInclude(body: string, mustInclude: string[]): string {
  const phrases = mustInclude.map(normalize).filter((p) => p.length > 0);
  if (phrases.length === 0) return body;
  return `${body} ${phrases.join(" ")}`;
}

/**
 * How much body a content type wants: a social post stays to the headline-length
 * hook; email / landing copy can carry the must-include phrases spelled out.
 * This only shapes *length*, never introduces content.
 */
function bodyForContentType(
  content_type: DraftContentType,
  base: string,
  mustInclude: string[],
): string {
  const withIncludes = weaveMustInclude(base, mustInclude);
  const text = content_type === "social_post" ? base : withIncludes;
  return boundText(text, MAX_BODY_CHARS);
}

/** Trim to at most `max` characters at a word boundary. */
function boundText(text: string, max: number): string {
  const t = normalize(text);
  if (t.length <= max) return t;
  const slice = t.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(" ");
  return `${(lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trimEnd()}…`;
}

const VARIANT_LETTERS = ["A", "B", "C", "D", "E", "F"] as const;

/**
 * Deterministic, offline generator. Reaches no network, needs no credential, and
 * **invents nothing** (Rules.md §3 "grounded, not invented"): it composes the
 * advertiser's own brief into `brief.variants` drafts using different creative
 * angles plus a fixed, claim-free tone/CTA vocabulary. Reproducible — the same
 * brief always yields the same drafts, so demos and tests are meaningful without
 * a paid key. This is the Draft Assistant's honest offline floor; a live model
 * produces richer copy behind the same interface.
 */
export function composeOfflineDrafts(brief: DraftBrief): AdDraft[] {
  const style = TONE_STYLE[brief.tone];
  const count = Math.max(
    MIN_DRAFT_VARIANTS,
    Math.min(MAX_DRAFT_VARIANTS, Math.floor(brief.variants)),
  );
  const drafts: AdDraft[] = [];
  for (let i = 0; i < count; i++) {
    const angle = ANGLES[i % ANGLES.length];
    const headline = boundText(angle.headline(brief, style), MAX_HEADLINE_CHARS);
    const body = bodyForContentType(brief.content_type, angle.body(brief), brief.mustInclude);
    drafts.push({
      variantLabel: `Variant ${VARIANT_LETTERS[i] ?? i + 1}`,
      angle: angle.label,
      headline,
      body,
      cta: boundText(style.cta, MAX_CTA_CHARS),
    });
  }
  return drafts;
}

export const offlineDraftGenerator: DraftGenerator = {
  name: "offline",
  generate: composeOfflineDrafts,
};

/** The system prompt for live, model-backed generation. */
export const DRAFT_SYSTEM_PROMPT =
  "You are an expert advertising copywriter drafting ad copy from a brief. You " +
  "are NOT a reviewer or critic — you only draft. Use ONLY the facts in the " +
  "brief; never invent statistics, prices, dates, customers, or claims. Respect " +
  "the requested tone, content type, and platform. Include every must-include " +
  "phrase; never use any must-avoid word. Return ONLY a JSON array of objects, " +
  'each {"variantLabel","angle","headline","body","cta"}, one per requested ' +
  "variant, and nothing else.";

/** Assemble the user prompt for model-backed generation from a brief. */
export function buildDraftPrompt(brief: DraftBrief): string {
  return [
    `Product / offer: ${normalize(brief.product)}`,
    `Audience: ${normalize(brief.audience)}`,
    `Key message: ${normalize(brief.keyMessage)}`,
    `Tone: ${brief.tone}`,
    `Content type: ${brief.content_type}`,
    `Platform: ${brief.platform ?? "unspecified"}`,
    `Must include: ${brief.mustInclude.length ? brief.mustInclude.map(normalize).join("; ") : "(none)"}`,
    `Must avoid: ${brief.mustAvoid.length ? brief.mustAvoid.map(normalize).join("; ") : "(none)"}`,
    `Number of distinct variants: ${brief.variants}`,
  ].join("\n");
}

/** Strip accidental markdown fences and parse the first JSON array in `raw`. */
function parseDraftJson(raw: string): unknown {
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  }
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end !== -1 && end > start) {
    text = text.slice(start, end + 1);
  }
  return JSON.parse(text);
}

/**
 * Live, model-backed generator — one call through the shared provider client
 * (Rules.md §2). Model output is untrusted: it is parsed, Zod-validated per
 * draft, clamped to the requested variant count, and any draft that slips in a
 * must-avoid term is dropped (defence in depth). A higher temperature than
 * scoring is correct here — this is *generation*, not the deterministic,
 * low-temperature *judgement* Rules.md §3 calls for.
 *
 * The offline mock cannot generate drafts (it only knows juror JSON), so this
 * refuses to run on it: use {@link offlineDraftGenerator} with no key, or set
 * `AI_API_KEY` for live generation.
 */
export function modelDraftGenerator(
  client: ModelClient,
  opts: { temperature?: number } = {},
): DraftGenerator {
  return {
    name: client.model,
    async generate(brief) {
      if (client.isMock) {
        throw new Error(
          "The offline mock cannot generate drafts. Use offlineDraftGenerator (no key needed), or configure AI_API_KEY for live model generation.",
        );
      }
      const raw = await client.complete({
        system: DRAFT_SYSTEM_PROMPT,
        user: buildDraftPrompt(brief),
        temperature: opts.temperature ?? 0.7,
      });
      const parsed = z.array(AdDraftSchema).parse(parseDraftJson(raw));
      const avoid = brief.mustAvoid.map((a) => normalize(a).toLowerCase()).filter(Boolean);
      const clean = parsed.filter((d) => {
        const hay = `${d.headline} ${d.body} ${d.cta}`.toLowerCase();
        return !avoid.some((term) => hay.includes(term));
      });
      return clean.slice(0, brief.variants);
    },
  };
}

export type GenerateDraftsResult =
  | { ok: true; result: DraftResult }
  | ({ ok: false } & DraftBriefRejection);

/**
 * Generate drafts end-to-end: guard → generate → wrap with provenance + the
 * standing disclaimer. The generator is injected (offline default), so this runs
 * fully offline with no network or credential. Deliberately does **not** call
 * the orchestrator / jury — generation and judgement stay separate paths.
 */
export async function generateDrafts(
  brief: DraftBrief,
  deps: { generator?: DraftGenerator } = {},
): Promise<GenerateDraftsResult> {
  const decision = checkDraftBrief(brief);
  if (!decision.ok) return decision;

  const generator = deps.generator ?? offlineDraftGenerator;
  const drafts = await generator.generate(brief);
  return {
    ok: true,
    result: {
      brief,
      drafts,
      generator: generator.name,
      disclaimer: DRAFT_DISCLAIMER,
    },
  };
}
