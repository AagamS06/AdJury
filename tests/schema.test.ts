import { describe, it, expect } from "vitest";
import { JurorResultSchema } from "@/lib/schema/juror";
import { computeAggregate, deriveVerdict } from "@/lib/scoring";
import type { JurorSlot } from "@/lib/schema/juror";

const validJuror = {
  persona: "brand_voice_guardian" as const,
  score: 8,
  confidence: "high" as const,
  summary: "On-brand and confident.",
  issues: [],
  suggested_rewrite: "One of the most effective tools we tested this year.",
};

describe("juror schema contract", () => {
  it("accepts a valid juror object", () => {
    expect(() => JurorResultSchema.parse(validJuror)).not.toThrow();
  });

  it("rejects a score above 10", () => {
    expect(() => JurorResultSchema.parse({ ...validJuror, score: 11 })).toThrow();
  });

  it("rejects a non-integer score", () => {
    expect(() => JurorResultSchema.parse({ ...validJuror, score: 7.5 })).toThrow();
  });

  it("requires a suggested_rewrite", () => {
    const { suggested_rewrite, ...withoutRewrite } = validJuror;
    void suggested_rewrite;
    expect(() => JurorResultSchema.parse(withoutRewrite)).toThrow();
  });

  it("rejects an unknown persona", () => {
    expect(() =>
      JurorResultSchema.parse({ ...validJuror, persona: "mystery_juror" }),
    ).toThrow();
  });
});

function ok(persona: JurorSlot extends { persona: infer P } ? P : never, score: number, issues: any[] = []): JurorSlot {
  return {
    persona: persona as any,
    score,
    confidence: "medium",
    summary: "test",
    issues,
    suggested_rewrite: "test",
    status: "ok",
  } as JurorSlot;
}

describe("scoring & verdict", () => {
  it("computes an equal-weighted aggregate", () => {
    const jurors: JurorSlot[] = [
      ok("brand_voice_guardian", 8),
      ok("compliance_legal_flagger", 7),
      ok("target_audience_fit", 9),
      ok("seo_discoverability", 6),
      ok("stop_scrolling", 5),
    ];
    expect(computeAggregate(jurors)).toBe(7);
  });

  it("renormalizes weights when a juror errored", () => {
    const jurors: JurorSlot[] = [
      ok("brand_voice_guardian", 8),
      { persona: "compliance_legal_flagger", status: "error", error: "boom" },
      ok("target_audience_fit", 8),
      ok("seo_discoverability", 8),
      ok("stop_scrolling", 8),
    ];
    expect(computeAggregate(jurors)).toBe(8);
  });

  it("passes a clean high-scoring review", () => {
    const jurors: JurorSlot[] = [
      ok("brand_voice_guardian", 9),
      ok("compliance_legal_flagger", 9),
      ok("target_audience_fit", 8),
      ok("seo_discoverability", 8),
      ok("stop_scrolling", 8),
    ];
    const agg = computeAggregate(jurors);
    expect(deriveVerdict(agg, jurors)).toBe("pass");
  });

  it("downgrades to revise when any medium issue exists", () => {
    const jurors: JurorSlot[] = [
      ok("brand_voice_guardian", 9),
      ok("compliance_legal_flagger", 9),
      ok("target_audience_fit", 8, [
        { severity: "medium", excerpt: "x", explanation: "y" },
      ]),
      ok("seo_discoverability", 9),
      ok("stop_scrolling", 9),
    ];
    const agg = computeAggregate(jurors);
    expect(deriveVerdict(agg, jurors)).toBe("revise");
  });

  it("lets a high-severity compliance issue veto to fail", () => {
    const jurors: JurorSlot[] = [
      ok("brand_voice_guardian", 10),
      ok("compliance_legal_flagger", 3, [
        { severity: "high", excerpt: "guaranteed", explanation: "risky" },
      ]),
      ok("target_audience_fit", 10),
      ok("seo_discoverability", 10),
      ok("stop_scrolling", 10),
    ];
    const agg = computeAggregate(jurors);
    expect(deriveVerdict(agg, jurors)).toBe("fail");
  });
});
