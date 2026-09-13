import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModelClient } from "@/lib/ai/client";
import type { SessionContext } from "@/lib/auth/session";
import {
  updateCompanyJurorWeights,
  type InsertReviewParams,
} from "@/lib/db/queries";
import { createReview } from "@/lib/reviews/create-review";
import type { JurorSlot, PersonaName } from "@/lib/schema/juror";
import { PersonaWeightsInputSchema } from "@/lib/schema/weights";
import type { PersonaWeights, PersonaWeightsConfig } from "@/lib/schema/weights";
import {
  DEFAULT_PERSONA_WEIGHTS,
  computeAggregate,
  resolveWeights,
} from "@/lib/scoring";
import type { CompanyRow, ReviewWithScores } from "@/types/db";

/**
 * Configurable per-company juror weighting (DailyPlan Day 16).
 * Proves the DoD: the aggregate honors custom weights, the equal default is
 * unchanged when no config is set, and a stored config is resolved safely
 * before scoring reads it.
 */

function ok(persona: PersonaName, score: number): JurorSlot {
  return {
    persona,
    score,
    confidence: "medium",
    summary: "test",
    issues: [],
    suggested_rewrite: "test",
    status: "ok",
  };
}

// Distinct scores per juror so a change in weighting moves the aggregate.
const JURORS: JurorSlot[] = [
  ok("brand_voice_guardian", 10),
  ok("compliance_legal_flagger", 8),
  ok("target_audience_fit", 6),
  ok("seo_discoverability", 4),
  ok("stop_scrolling", 2),
];

describe("computeAggregate weighting", () => {
  it("uses equal weights by default (unchanged behavior)", () => {
    // (10 + 8 + 6 + 4 + 2) / 5 = 6.0
    expect(computeAggregate(JURORS)).toBe(6);
    expect(computeAggregate(JURORS, DEFAULT_PERSONA_WEIGHTS)).toBe(6);
  });

  it("honors custom weights", () => {
    const weights: PersonaWeights = {
      brand_voice_guardian: 0.6,
      compliance_legal_flagger: 0.1,
      target_audience_fit: 0.1,
      seo_discoverability: 0.1,
      stop_scrolling: 0.1,
    };
    // 10*0.6 + (8+6+4+2)*0.1 = 6.0 + 2.0 = 8.0; total weight 1.0
    expect(computeAggregate(JURORS, weights)).toBe(8);
  });

  it("is scale-invariant — only the ratios matter", () => {
    const equalButLarge: PersonaWeights = {
      brand_voice_guardian: 5,
      compliance_legal_flagger: 5,
      target_audience_fit: 5,
      seo_discoverability: 5,
      stop_scrolling: 5,
    };
    expect(computeAggregate(JURORS, equalButLarge)).toBe(6);
  });

  it("renormalizes custom weights when a juror errored", () => {
    const jurors: JurorSlot[] = [
      ok("brand_voice_guardian", 10),
      { persona: "compliance_legal_flagger", status: "error", error: "boom" },
      ok("target_audience_fit", 6),
      ok("seo_discoverability", 4),
      ok("stop_scrolling", 2),
    ];
    const weights: PersonaWeights = {
      brand_voice_guardian: 0.7,
      compliance_legal_flagger: 0.9, // dropped: this juror errored
      target_audience_fit: 0.1,
      seo_discoverability: 0.1,
      stop_scrolling: 0.1,
    };
    // (10*0.7 + 6*0.1 + 4*0.1 + 2*0.1) / (0.7 + 0.1 + 0.1 + 0.1)
    //   = (7 + 1.2) / 1.0 = 8.2
    expect(computeAggregate(jurors, weights)).toBe(8.2);
  });

  it("returns 0 when every scored juror has zero weight", () => {
    const weights: PersonaWeights = {
      brand_voice_guardian: 0,
      compliance_legal_flagger: 0,
      target_audience_fit: 0,
      seo_discoverability: 0,
      stop_scrolling: 1, // the only weighted juror errored below
    };
    const jurors: JurorSlot[] = [
      ok("brand_voice_guardian", 10),
      { persona: "stop_scrolling", status: "error", error: "boom" },
    ];
    expect(computeAggregate(jurors, weights)).toBe(0);
  });
});

describe("resolveWeights", () => {
  it("returns the equal default for null/undefined", () => {
    expect(resolveWeights(null)).toEqual(DEFAULT_PERSONA_WEIGHTS);
    expect(resolveWeights(undefined)).toEqual(DEFAULT_PERSONA_WEIGHTS);
  });

  it("does not mutate the default map", () => {
    const resolved = resolveWeights({ brand_voice_guardian: 0.9 });
    resolved.brand_voice_guardian = 99;
    expect(DEFAULT_PERSONA_WEIGHTS.brand_voice_guardian).toBe(0.2);
  });

  it("merges a partial config onto the default (unspecified jurors keep 0.2)", () => {
    expect(resolveWeights({ brand_voice_guardian: 0.5 })).toEqual({
      brand_voice_guardian: 0.5,
      compliance_legal_flagger: 0.2,
      target_audience_fit: 0.2,
      seo_discoverability: 0.2,
      stop_scrolling: 0.2,
    });
  });

  it("allows disabling a juror with an explicit 0", () => {
    const resolved = resolveWeights({ stop_scrolling: 0 });
    expect(resolved.stop_scrolling).toBe(0);
    expect(resolved.brand_voice_guardian).toBe(0.2);
  });

  it("ignores invalid values (negative, NaN, non-number) — fails safe", () => {
    const malformed = {
      brand_voice_guardian: -5,
      compliance_legal_flagger: Number.NaN,
      target_audience_fit: "0.8",
      seo_discoverability: Infinity,
    } as unknown as PersonaWeightsConfig;
    // Every specified value is invalid, so all fall back to the default.
    expect(resolveWeights(malformed)).toEqual(DEFAULT_PERSONA_WEIGHTS);
  });

  it("falls back to the equal default when the resolved total is zero", () => {
    const allZero: PersonaWeightsConfig = {
      brand_voice_guardian: 0,
      compliance_legal_flagger: 0,
      target_audience_fit: 0,
      seo_discoverability: 0,
      stop_scrolling: 0,
    };
    expect(resolveWeights(allZero)).toEqual(DEFAULT_PERSONA_WEIGHTS);
  });
});

describe("PersonaWeightsInputSchema", () => {
  it("accepts a valid partial config", () => {
    expect(() =>
      PersonaWeightsInputSchema.parse({ brand_voice_guardian: 0.5 }),
    ).not.toThrow();
  });

  it("accepts a full config", () => {
    expect(() =>
      PersonaWeightsInputSchema.parse({
        brand_voice_guardian: 0.4,
        compliance_legal_flagger: 0.3,
        target_audience_fit: 0.1,
        seo_discoverability: 0.1,
        stop_scrolling: 0.1,
      }),
    ).not.toThrow();
  });

  it("rejects a negative weight", () => {
    expect(() =>
      PersonaWeightsInputSchema.parse({ brand_voice_guardian: -1 }),
    ).toThrow();
  });

  it("rejects an all-zero config (no signal)", () => {
    expect(() =>
      PersonaWeightsInputSchema.parse({
        brand_voice_guardian: 0,
        stop_scrolling: 0,
      }),
    ).toThrow();
  });

  it("rejects an unknown persona key", () => {
    expect(() =>
      PersonaWeightsInputSchema.parse({ mystery_juror: 0.5 }),
    ).toThrow();
  });

  it("rejects a non-number weight", () => {
    expect(() =>
      PersonaWeightsInputSchema.parse({ brand_voice_guardian: "0.5" }),
    ).toThrow();
  });
});

// ── Integration: the review aggregate honors the company's weights ─────────

/** A model client that returns a fixed score per persona (no network/mock). */
function fixedScoreClient(scores: Record<PersonaName, number>): ModelClient {
  return {
    model: "fixed-test",
    isMock: true,
    complete: async ({ persona }) =>
      JSON.stringify({
        persona,
        score: scores[persona],
        confidence: "medium",
        summary: "fixed",
        issues: [],
        suggested_rewrite: "fixed rewrite",
      }),
  };
}

const FIXED_SCORES: Record<PersonaName, number> = {
  brand_voice_guardian: 10,
  compliance_legal_flagger: 8,
  target_audience_fit: 6,
  seo_discoverability: 4,
  stop_scrolling: 2,
};

function sessionWithWeights(
  juror_weights: PersonaWeightsConfig | null,
): SessionContext {
  return {
    authUserId: "11111111-1111-1111-1111-111111111111",
    email: "admin@acme.test",
    companyId: "22222222-2222-2222-2222-222222222222",
    role: "admin",
    company: {
      id: "22222222-2222-2222-2222-222222222222",
      name: "Acme",
      industry: null,
      plan_tier: "free",
      juror_weights,
      created_at: "2026-08-31T00:00:00.000Z",
    },
  };
}

const noopPersist = async (
  params: InsertReviewParams,
): Promise<ReviewWithScores> => ({
  review: {
    id: params.review.review_id,
    company_id: params.companyId,
    submitted_by: params.submittedBy,
    content_text: params.content_text,
    content_type: params.review.content_type as never,
    platform: params.review.platform,
    aggregate_score: params.review.aggregate_score,
    verdict: params.review.verdict,
    created_at: "2026-09-12T00:00:00.000Z",
  },
  scores: [],
});

const BODY = {
  content_text: "A concise, on-brand product announcement.",
  content_type: "ad_copy",
  platform: "instagram",
};

describe("createReview honors the company's configured weights", () => {
  it("uses the equal default when juror_weights is null", async () => {
    const result = await createReview(BODY, {
      session: sessionWithWeights(null),
      persist: noopPersist,
      client: fixedScoreClient(FIXED_SCORES),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    // Equal weighting: (10 + 8 + 6 + 4 + 2) / 5 = 6.0
    expect(result.review.aggregate_score).toBe(6);
  });

  it("shifts the aggregate when the company weights a juror heavily", async () => {
    const result = await createReview(BODY, {
      session: sessionWithWeights({
        brand_voice_guardian: 0.6,
        compliance_legal_flagger: 0.1,
        target_audience_fit: 0.1,
        seo_discoverability: 0.1,
        stop_scrolling: 0.1,
      }),
      persist: noopPersist,
      client: fixedScoreClient(FIXED_SCORES),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    // 10*0.6 + (8+6+4+2)*0.1 = 8.0
    expect(result.review.aggregate_score).toBe(8);
  });
});

// ── Scaffold write path: updateCompanyJurorWeights ─────────────────────────

function fakeCompaniesDb(row: CompanyRow) {
  const calls: { updated?: Record<string, unknown>; id?: unknown } = {};
  const builder = {
    update(values: Record<string, unknown>) {
      calls.updated = values;
      return this;
    },
    eq(col: string, val: unknown) {
      if (col === "id") calls.id = val;
      return this;
    },
    select() {
      return this;
    },
    async single() {
      return { data: row, error: null };
    },
  };
  const db = { from: () => builder } as unknown as SupabaseClient;
  return { db, calls };
}

const COMPANY_ROW: CompanyRow = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "Acme",
  industry: null,
  plan_tier: "free",
  juror_weights: null,
  created_at: "2026-08-31T00:00:00.000Z",
};

describe("updateCompanyJurorWeights (scaffold write path)", () => {
  it("writes a validated config, scoped to the given company id", async () => {
    const { db, calls } = fakeCompaniesDb(COMPANY_ROW);
    await updateCompanyJurorWeights(db, COMPANY_ROW.id, {
      brand_voice_guardian: 0.5,
    });
    expect(calls.id).toBe(COMPANY_ROW.id);
    expect(calls.updated).toEqual({ juror_weights: { brand_voice_guardian: 0.5 } });
  });

  it("clears the config to the default when passed null", async () => {
    const { db, calls } = fakeCompaniesDb(COMPANY_ROW);
    await updateCompanyJurorWeights(db, COMPANY_ROW.id, null);
    expect(calls.updated).toEqual({ juror_weights: null });
  });

  it("rejects an invalid config before touching the database", async () => {
    const { db, calls } = fakeCompaniesDb(COMPANY_ROW);
    await expect(
      updateCompanyJurorWeights(db, COMPANY_ROW.id, {
        brand_voice_guardian: -1,
      }),
    ).rejects.toThrow();
    expect(calls.updated).toBeUndefined();
  });
});
