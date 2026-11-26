/**
 * Draft Assistant — live, model-backed generation (DailyPlan Day 87, extracted
 * in Day 89).
 *
 * This is the ONE Draft Assistant module that depends on the provider client
 * (`lib/ai/client`), so it is kept **separate** from the pure core in
 * `draft-assistant.ts`. That separation is load-bearing for the Day-89 public
 * surface: the `/draft` form is a client component that imports the core for its
 * schemas/types, and if the core imported `ai/client` (even as a type) the
 * secrets-audit would flag `ai/client` as reachable from the browser bundle.
 * Housing the live generator here keeps the core credential-free and the client
 * bundle clean, while server code (the route) imports the live generator from
 * this module.
 *
 * Like the live business researcher and the review path, this is a thin seam over
 * the shared, provider-abstracted client (Rules.md §2 — one provider). It stays
 * strictly separate from the jury: it imports neither the orchestrator nor any
 * persona.
 */
import { z } from "zod";
import type { ModelClient } from "@/lib/ai/client";
import {
  AdDraftSchema,
  type DraftBrief,
  type DraftGenerator,
} from "@/lib/draft/draft-assistant";

/** Collapse whitespace runs to single spaces and trim (local copy — no core coupling). */
function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

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
 * refuses to run on it: use `offlineDraftGenerator` with no key, or set
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
