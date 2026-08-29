import { describe, it, expect } from "vitest";
import { runReview } from "@/lib/ai/orchestrator";
import {
  JurorResultSchema,
  ReviewResultSchema,
  ReviewInputSchema,
  PERSONA_NAMES,
} from "@/lib/schema/juror";

describe("end-to-end review (mock model)", () => {
  it("submits ad copy, runs all 5 jurors, returns valid structured JSON", async () => {
    const input = ReviewInputSchema.parse({
      content_type: "ad_copy",
      platform: "instagram",
      brand_context: "Tone: measured, expert, trustworthy.",
      content_text:
        "Our project-tracking app helps small teams ship on time without the busywork.",
    });

    const review = await runReview(input);

    // The composed review conforms to the contract end-to-end.
    expect(() => ReviewResultSchema.parse(review)).not.toThrow();

    // Exactly the five canonical jurors, in order.
    expect(review.jurors).toHaveLength(5);
    expect(review.jurors.map((j) => j.persona)).toEqual([...PERSONA_NAMES]);

    // Aggregate and verdict are well-formed.
    expect(review.aggregate_score).toBeGreaterThanOrEqual(0);
    expect(review.aggregate_score).toBeLessThanOrEqual(10);
    expect(["pass", "revise", "fail"]).toContain(review.verdict);

    // Every successful juror validates against the juror schema.
    for (const juror of review.jurors) {
      if (juror.status === "ok") {
        expect(() => JurorResultSchema.parse(juror)).not.toThrow();
      }
    }
  });

  it("applies the compliance veto: risky claims force a FAIL", async () => {
    const input = ReviewInputSchema.parse({
      content_type: "ad_copy",
      platform: "facebook",
      content_text:
        "Guaranteed to cure your anxiety in one week — 100% risk-free!",
    });

    const review = await runReview(input);
    expect(review.verdict).toBe("fail");

    const compliance = review.jurors.find(
      (j) => j.persona === "compliance_legal_flagger",
    );
    expect(compliance?.status).toBe("ok");
    if (compliance && compliance.status === "ok") {
      expect(compliance.issues.some((i) => i.severity === "high")).toBe(true);
    }
  });
});
