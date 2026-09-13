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

const CONTENT_MARKER = "<<<CONTENT>>>";

/** Assemble the user message for one persona from the review input. */
function buildUserPrompt(input: ReviewInput, persona: Persona): string {
  const brand = input.brand_context
    ? `Brand context / style guide:\n${input.brand_context}\n`
    : "No brand context provided — infer a reasonable professional baseline.\n";

  return [
    `Content type: ${input.content_type}`,
    `Platform: ${input.platform ?? "unspecified"}`,
    "",
    brand,
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

/** Run one persona, validating output and retrying once on invalid JSON. */
async function runPersona(
  client: ModelClient,
  input: ReviewInput,
  persona: Persona,
): Promise<JurorSlot> {
  const baseUser = buildUserPrompt(input, persona);
  const temperature = Number(process.env.AI_TEMPERATURE ?? "0.2");

  for (let attempt = 0; attempt < 2; attempt++) {
    const user =
      attempt === 0
        ? baseUser
        : `${baseUser}\n\nYour previous response was not valid JSON matching the required schema. Return ONLY the JSON object, nothing else.`;
    try {
      const raw = await client.complete({
        system: persona.systemPrompt,
        user,
        persona: persona.name,
        temperature,
      });
      const parsed = parseJson(raw);
      const result = JurorResultSchema.parse(parsed);
      // Force the persona field to match the juror we asked for.
      return { ...result, persona: persona.name, status: "ok" as const };
    } catch (err) {
      if (attempt === 1) {
        return {
          persona: persona.name,
          status: "error" as const,
          error: err instanceof Error ? err.message : "unknown error",
        };
      }
    }
  }
  // Unreachable, but keeps the type checker happy.
  return { persona: persona.name, status: "error" as const, error: "unreachable" };
}

/**
 * Run all five jurors against the content and assemble the composed review.
 * Jurors run in parallel; a single juror failing never fails the whole review.
 */
export async function runReview(
  input: ReviewInput,
  deps: { client?: ModelClient; weights?: PersonaWeights } = {},
): Promise<ReviewResult> {
  const client = deps.client ?? getModelClient();

  const jurors = await Promise.all(
    PERSONAS.map((persona) => runPersona(client, input, persona)),
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
