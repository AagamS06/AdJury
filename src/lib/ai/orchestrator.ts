import { ZodError } from "zod";
import {
  JurorResultSchema,
  type JurorSlot,
  type ReviewInput,
  type ReviewResult,
} from "@/lib/schema/juror";
import { computeAggregate, deriveVerdict } from "@/lib/scoring";
import type { PersonaWeights } from "@/lib/schema/weights";
import { getModelClient, type ModelClient } from "./client";
import { PERSONAS, type Persona } from "./personas";
import { platformGuidanceFor } from "./personas/platform-guidance";
import {
  callWithResilience,
  classifyModelError,
  TimeoutError,
  type ResilienceOptions,
} from "./resilience";

const CONTENT_MARKER = "<<<CONTENT>>>";

const CORRECTIVE_NUDGE =
  "Your previous response was not valid JSON matching the required schema. Return ONLY the JSON object, nothing else.";

/** The juror that reviews content against the company's brand guide (PRD §5). */
const BRAND_JUROR: Persona["name"] = "brand_voice_guardian";

/**
 * Assemble the user message for one persona from the review input.
 *
 * Brand context is scoped to the Brand Voice Guardian only (DailyPlan Day 27):
 * it is the one juror whose lens is consistency with the company's tone/style
 * guide (PRD §5, Rules.md §3), so the stored guide is injected into its prompt
 * and no other's. Sending the guide to all five jurors would waste tokens on
 * lenses that ignore it (Rules.md §1 cost discipline) and add noise to their
 * judgement. When no guide is stored, the brand juror is told to infer a
 * professional baseline (matching its system prompt).
 *
 * For the platform-aware jurors (SEO, "stop scrolling") a platform-specific
 * expectations block is injected so their judgement adapts to the selected
 * channel (DailyPlan Day 20); other jurors' prompts are unchanged. Exported so
 * the brand + platform pass-through is unit-testable without a live model.
 */
export function buildUserPrompt(input: ReviewInput, persona: Persona): string {
  const brandBlock =
    persona.name === BRAND_JUROR
      ? [
          input.brand_context
            ? `Brand context / style guide:\n${input.brand_context}\n`
            : "No brand context provided — infer a reasonable professional baseline.\n",
        ]
      : [];

  const platformGuidance = platformGuidanceFor(persona.name, input.platform);
  const platformBlock = platformGuidance
    ? [
        `Platform-specific expectations for this juror (target platform: ${input.platform}):`,
        `${platformGuidance}\n`,
      ]
    : [];

  return [
    `Content type: ${input.content_type}`,
    `Platform: ${input.platform ?? "unspecified"}`,
    "",
    ...brandBlock,
    ...platformBlock,
    `Review the content between the delimiter lines below as the ${persona.title}.`,
    CONTENT_MARKER,
    input.content_text,
    CONTENT_MARKER,
  ].join("\n");
}

/** Strip accidental markdown fences and parse the first JSON object. */
function parseJson(raw: string): unknown {
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    text = text.slice(start, end + 1);
  }
  return JSON.parse(text);
}

/** True when a failure is the model returning unusable output (bad JSON / schema). */
function isOutputError(err: unknown): boolean {
  return err instanceof ZodError || err instanceof SyntaxError;
}

/**
 * A concise, content-free reason for a juror's failure. Kept internal (logs +
 * the slot's `error` field); the UI shows its own generic message rather than
 * this string, so no provider internals leak to users (Rules.md §6).
 */
function jurorErrorReason(err: unknown): string {
  if (err instanceof TimeoutError) return "provider timeout";
  if (err instanceof ZodError) return "invalid model output (schema mismatch)";
  if (err instanceof SyntaxError) return "invalid model output (not JSON)";
  switch (classifyModelError(err)) {
    case "rate_limit":
      return "provider rate limited";
    case "permanent":
      return "provider rejected the request";
    default:
      return "provider unavailable";
  }
}

/**
 * Run one persona to a validated result (DailyPlan Day 19).
 *
 * Two layers of resilience, kept distinct because they need different cures:
 *  - The *model call* is wrapped in a per-attempt timeout + backoff retry for
 *    transient provider failures (`callWithResilience`) — a nudge can't fix a
 *    dead connection.
 *  - The *output contract* keeps the Rules.md §6 behaviour: if the call
 *    succeeds but the JSON is invalid, retry once with a corrective nudge.
 * A provider failure that exhausts its retries doesn't waste the corrective
 * attempt (the output was never the problem); either way, after the retries a
 * failing juror degrades to an `error` slot so the other four still return.
 */
async function runPersona(
  client: ModelClient,
  input: ReviewInput,
  persona: Persona,
  resilience?: Partial<ResilienceOptions>,
): Promise<JurorSlot> {
  const baseUser = buildUserPrompt(input, persona);
  const temperature = Number(process.env.AI_TEMPERATURE ?? "0.2");
  let lastError: unknown = new Error("juror produced no result");
  let sawOutputError = false;

  for (let attempt = 0; attempt < 2; attempt++) {
    // Only append the corrective nudge when the previous failure was invalid
    // output — a provider/timeout failure won't be helped by re-asking.
    const user =
      attempt > 0 && sawOutputError ? `${baseUser}\n\n${CORRECTIVE_NUDGE}` : baseUser;
    try {
      const raw = await callWithResilience(
        (signal) =>
          client.complete({
            system: persona.systemPrompt,
            user,
            persona: persona.name,
            temperature,
            signal,
          }),
        {
          ...resilience,
          onRetry: (info) =>
            console.warn("juror model call retry", {
              op: "runPersona",
              persona: persona.name,
              attempt: info.attempt,
              category: info.category,
              delayMs: info.delayMs,
            }),
        },
      );
      const parsed = parseJson(raw);
      const result = JurorResultSchema.parse(parsed);
      // Force the persona field to match the juror we asked for.
      return { ...result, persona: persona.name, status: "ok" as const };
    } catch (err) {
      lastError = err;
      sawOutputError = isOutputError(err);
      // A provider/timeout failure gets no corrective retry; invalid output
      // gets exactly one (attempt 1) before the juror degrades to `error`.
      if (!sawOutputError || attempt === 1) break;
    }
  }

  const reason = jurorErrorReason(lastError);
  // Redacted per-juror failure log (no content/secrets — Rules.md §3/§6).
  console.error("juror failed", {
    op: "runPersona",
    persona: persona.name,
    reason,
  });
  return { persona: persona.name, status: "error" as const, error: reason };
}

/**
 * Run all five jurors against the content and assemble the composed review.
 * Jurors run in parallel; a single juror failing never fails the whole review.
 */
export async function runReview(
  input: ReviewInput,
  deps: {
    client?: ModelClient;
    weights?: PersonaWeights;
    /** Override the per-call timeout/backoff policy (DailyPlan Day 19; tests). */
    resilience?: Partial<ResilienceOptions>;
  } = {},
): Promise<ReviewResult> {
  const client = deps.client ?? getModelClient();

  const jurors = await Promise.all(
    PERSONAS.map((persona) => runPersona(client, input, persona, deps.resilience)),
  );

  // Per-company weights (DailyPlan Day 16); omitted → equal default.
  const aggregate_score = computeAggregate(jurors, deps.weights);
  const verdict = deriveVerdict(aggregate_score, jurors);

  return {
    review_id: globalThis.crypto.randomUUID(),
    content_type: input.content_type,
    platform: input.platform,
    model: client.isMock ? `${client.model} (mock)` : client.model,
    created_at: new Date().toISOString(),
    aggregate_score,
    verdict,
    jurors,
  };
}
