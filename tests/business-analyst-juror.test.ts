import { describe, it, expect } from "vitest";
import { PERSONAS } from "@/lib/ai/personas";
import { businessAnalyst } from "@/lib/ai/personas/business-analyst";
import { buildUserPrompt, runReview } from "@/lib/ai/orchestrator";
import {
  PERSONA_NAMES,
  ReviewInputSchema,
  type PersonaName,
} from "@/lib/schema/juror";
import { DEFAULT_PERSONA_WEIGHTS } from "@/lib/scoring";
import type { CompleteArgs, ModelClient } from "@/lib/ai/client";

/**
 * Business Analyst juror (DailyPlan Day 23b). A sixth juror briefed on the spot
 * as the posting company's insider, grounded ONLY in the business context AdJury
 * compiled from public sources. These tests pin its registration, its grounding
 * guardrails, and that it participates in a review like any other juror.
 */

describe("Business Analyst juror — registration", () => {
  it("is the sixth juror, last in canonical order", () => {
    expect(PERSONA_NAMES).toContain("business_analyst");
    expect(PERSONA_NAMES[PERSONA_NAMES.length - 1]).toBe("business_analyst");
    expect(PERSONAS[PERSONAS.length - 1].name).toBe("business_analyst");
    expect(PERSONA_NAMES).toHaveLength(6);
  });

  it("has a default weight so it counts in the aggregate like the others", () => {
    expect(DEFAULT_PERSONA_WEIGHTS.business_analyst).toBe(0.2);
  });
});

describe("Business Analyst juror — grounding guardrails", () => {
  const prompt = businessAnalyst.systemPrompt;

  it("binds itself to the provided business context", () => {
    expect(prompt.toLowerCase()).toContain("business context");
    expect(prompt.toLowerCase()).toContain("public sources");
    expect(prompt).toContain("business_analyst"); // declares its machine-name
  });

  it("forbids inventing facts about the company (insider, not hallucinated)", () => {
    expect(prompt.toLowerCase()).toMatch(/do not invent|not invent/);
  });

  it("judges the business/market lens, not the other jurors' lenses", () => {
    expect(prompt.toLowerCase()).toContain("market");
    expect(prompt.toLowerCase()).toContain("business");
  });
});

/** A capture client returning valid JSON and recording what each juror was sent. */
function captureClient() {
  const calls: CompleteArgs[] = [];
  const client: ModelClient = {
    model: "capture",
    isMock: true,
    async complete(args) {
      calls.push(args);
      return JSON.stringify({
        persona: args.persona as PersonaName,
        score: 7,
        confidence: "medium",
        summary: "ok",
        issues: [],
        suggested_rewrite: "rewrite",
      });
    },
  };
  return { calls, client };
}

describe("Business Analyst juror — participates in a review", () => {
  it("produces a business_analyst slot and sees the business context", async () => {
    const { calls, client } = captureClient();
    const input = ReviewInputSchema.parse({
      content_text: "Our new all-in-one dashboard for busy teams.",
      content_type: "social_post",
      platform: "instagram",
      business_context: "Acme SaaS operates in the saas field. Its website is https://acme.test.",
    });

    const review = await runReview(input, { client });

    const slot = review.jurors.find((j) => j.persona === "business_analyst");
    expect(slot).toBeDefined();
    expect(slot?.status).toBe("ok");

    const baCall = calls.find((c) => c.persona === "business_analyst");
    expect(baCall?.user).toContain("Business context (what this ad is for):");
    expect(baCall?.user).toContain("Acme SaaS operates in the saas field.");
  });
});
