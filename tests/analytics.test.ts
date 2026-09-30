import { describe, it, expect, vi } from "vitest";
import type { SessionContext } from "@/lib/auth/session";
import type { AnalyticsQueryOptions } from "@/lib/db/queries";
import { PERSONA_NAMES, type PersonaName, type Verdict } from "@/lib/schema/juror";
import {
  bucketPeriod,
  computeAnalytics,
  computeJurorTrend,
  computeScoreTrend,
  computeVerdictDistribution,
  computeVerdictTrend,
  getCompanyAnalytics,
} from "@/lib/reviews/analytics";
import type {
  PersonaScoreRow,
  ReviewRow,
  ReviewWithScores,
} from "@/types/db";

/**
 * Analytics data layer (DailyPlan Day 31): score/verdict trends over time, per
 * company and per juror. The pure aggregation functions are proved to compute
 * the right buckets and means (the DoD), and the injectable core is proved to
 * be tenant-safe (company from the session, 401/500 mapping) with fakes — no DB.
 */

const COMPANY_ID = "22222222-2222-2222-2222-222222222222";

const SESSION: SessionContext = {
  authUserId: "11111111-1111-1111-1111-111111111111",
  email: "admin@acme.test",
  companyId: COMPANY_ID,
  role: "admin",
  company: {
    id: COMPANY_ID,
    name: "Acme",
    industry: null,
    plan_tier: "free",
    juror_weights: null,
    onboarded_at: "2026-08-31T00:00:00.000Z",
    created_at: "2026-08-31T00:00:00.000Z",
  },
};

let reviewSeq = 0;

/** Build one persona_scores row (ok by default; pass score:null for an error slot). */
function scoreRow(
  persona: PersonaName,
  score: number | null,
  overrides: Partial<PersonaScoreRow> = {},
): PersonaScoreRow {
  const ok = score !== null;
  return {
    id: `score-${persona}-${reviewSeq}`,
    review_id: `review-${reviewSeq}`,
    persona_name: persona,
    score,
    confidence: ok ? "high" : null,
    feedback_text: ok ? "ok" : "invalid JSON after retry",
    issues_json: [],
    suggested_rewrite: ok ? "improved" : null,
    status: ok ? "ok" : "error",
    ...overrides,
  };
}

interface ReviewSpec {
  created_at: string;
  aggregate_score?: number | null;
  verdict?: Verdict | null;
  /** Per-juror scores; a null value produces an error slot for that juror. */
  jurorScores?: Partial<Record<PersonaName, number | null>>;
}

/** Build a `ReviewWithScores` from a compact spec. */
function review(spec: ReviewSpec): ReviewWithScores {
  reviewSeq += 1;
  const id = `review-${reviewSeq}`;
  const reviewRow: ReviewRow = {
    id,
    company_id: COMPANY_ID,
    submitted_by: SESSION.authUserId,
    content_text: "Some marketing content.",
    content_type: "ad_copy",
    platform: "instagram",
    aggregate_score: spec.aggregate_score ?? null,
    verdict: spec.verdict ?? null,
    created_at: spec.created_at,
  };
  const scores: PersonaScoreRow[] = spec.jurorScores
    ? (Object.entries(spec.jurorScores) as [PersonaName, number | null][]).map(
        ([persona, score]) => ({
          ...scoreRow(persona, score),
          review_id: id,
        }),
      )
    : [];
  return { review: reviewRow, scores };
}

// ── bucketPeriod ────────────────────────────────────────────────────────────

describe("bucketPeriod", () => {
  it("buckets by UTC day", () => {
    expect(bucketPeriod("2026-09-01T13:45:00.000Z", "day")).toBe("2026-09-01");
    // Just before UTC midnight still belongs to the same UTC day.
    expect(bucketPeriod("2026-09-01T23:59:59.000Z", "day")).toBe("2026-09-01");
  });

  it("buckets by month", () => {
    expect(bucketPeriod("2026-09-30T00:00:00.000Z", "month")).toBe("2026-09");
    expect(bucketPeriod("2026-10-01T00:00:00.000Z", "month")).toBe("2026-10");
  });

  it("buckets by week to that week's Monday (UTC)", () => {
    // 2026-09-01 is a Tuesday → Monday is 2026-08-31.
    expect(bucketPeriod("2026-09-01T00:00:00.000Z", "week")).toBe("2026-08-31");
    // 2026-09-06 is a Sunday → still the same week starting 2026-08-31.
    expect(bucketPeriod("2026-09-06T12:00:00.000Z", "week")).toBe("2026-08-31");
    // 2026-09-07 is the next Monday → new bucket.
    expect(bucketPeriod("2026-09-07T00:00:00.000Z", "week")).toBe("2026-09-07");
  });

  it("returns null for an unparseable timestamp", () => {
    expect(bucketPeriod("not-a-date", "day")).toBeNull();
  });
});

// ── computeScoreTrend ────────────────────────────────────────────────────────

describe("computeScoreTrend", () => {
  it("groups by bucket, averages non-null scores, and orders oldest-first", () => {
    const reviews = [
      review({ created_at: "2026-09-02T09:00:00.000Z", aggregate_score: 6 }),
      review({ created_at: "2026-09-01T09:00:00.000Z", aggregate_score: 8 }),
      review({ created_at: "2026-09-01T18:00:00.000Z", aggregate_score: 7 }),
    ];
    const trend = computeScoreTrend(reviews, "day");
    expect(trend).toEqual([
      { period: "2026-09-01", reviewCount: 2, scoredCount: 2, averageScore: 7.5 },
      { period: "2026-09-02", reviewCount: 1, scoredCount: 1, averageScore: 6 },
    ]);
  });

  it("counts a never-scored review but excludes its null score from the mean", () => {
    const reviews = [
      review({ created_at: "2026-09-01T09:00:00.000Z", aggregate_score: 8 }),
      review({ created_at: "2026-09-01T10:00:00.000Z", aggregate_score: null }),
    ];
    const trend = computeScoreTrend(reviews, "day");
    expect(trend).toEqual([
      { period: "2026-09-01", reviewCount: 2, scoredCount: 1, averageScore: 8 },
    ]);
  });

  it("yields averageScore null for a bucket with no scored reviews", () => {
    const reviews = [
      review({ created_at: "2026-09-01T09:00:00.000Z", aggregate_score: null }),
    ];
    expect(computeScoreTrend(reviews, "day")[0].averageScore).toBeNull();
  });

  it("skips reviews with an unparseable timestamp", () => {
    const reviews = [
      review({ created_at: "garbage", aggregate_score: 5 }),
      review({ created_at: "2026-09-01T09:00:00.000Z", aggregate_score: 9 }),
    ];
    const trend = computeScoreTrend(reviews, "day");
    expect(trend).toHaveLength(1);
    expect(trend[0].period).toBe("2026-09-01");
  });
});

// ── computeVerdictTrend / distribution ───────────────────────────────────────

describe("computeVerdictTrend", () => {
  it("counts verdicts per bucket and excludes never-scored reviews", () => {
    const reviews = [
      review({ created_at: "2026-09-01T09:00:00.000Z", verdict: "pass" }),
      review({ created_at: "2026-09-01T10:00:00.000Z", verdict: "revise" }),
      review({ created_at: "2026-09-01T11:00:00.000Z", verdict: null }),
      review({ created_at: "2026-09-02T09:00:00.000Z", verdict: "fail" }),
    ];
    const trend = computeVerdictTrend(reviews, "day");
    expect(trend).toEqual([
      { period: "2026-09-01", pass: 1, revise: 1, fail: 0, total: 2 },
      { period: "2026-09-02", pass: 0, revise: 0, fail: 1, total: 1 },
    ]);
  });
});

describe("computeVerdictDistribution", () => {
  it("sums verdicts across the window, ignoring null verdicts", () => {
    const reviews = [
      review({ created_at: "2026-09-01T00:00:00.000Z", verdict: "pass" }),
      review({ created_at: "2026-09-02T00:00:00.000Z", verdict: "pass" }),
      review({ created_at: "2026-09-03T00:00:00.000Z", verdict: "fail" }),
      review({ created_at: "2026-09-04T00:00:00.000Z", verdict: null }),
    ];
    expect(computeVerdictDistribution(reviews)).toEqual({
      pass: 2,
      revise: 0,
      fail: 1,
      total: 3,
    });
  });
});

// ── computeJurorTrend ────────────────────────────────────────────────────────

describe("computeJurorTrend", () => {
  it("averages a single juror's ok scores per bucket and overall", () => {
    const reviews = [
      review({
        created_at: "2026-09-01T09:00:00.000Z",
        jurorScores: { brand_voice_guardian: 8, seo_discoverability: 4 },
      }),
      review({
        created_at: "2026-09-01T10:00:00.000Z",
        jurorScores: { brand_voice_guardian: 6 },
      }),
      review({
        created_at: "2026-09-02T09:00:00.000Z",
        jurorScores: { brand_voice_guardian: 5 },
      }),
    ];
    const trend = computeJurorTrend(reviews, "brand_voice_guardian", "day");
    expect(trend.persona).toBe("brand_voice_guardian");
    expect(trend.points).toEqual([
      { period: "2026-09-01", scoredCount: 2, averageScore: 7 },
      { period: "2026-09-02", scoredCount: 1, averageScore: 5 },
    ]);
    // Overall mean over the three scores: (8 + 6 + 5) / 3 = 6.333 → 6.3.
    expect(trend.overallAverage).toBe(6.3);
    expect(trend.scoredCount).toBe(3);
  });

  it("excludes an errored juror row from the mean (not counted as zero)", () => {
    const reviews = [
      review({
        created_at: "2026-09-01T09:00:00.000Z",
        jurorScores: { compliance_legal_flagger: 9 },
      }),
      review({
        created_at: "2026-09-01T10:00:00.000Z",
        jurorScores: { compliance_legal_flagger: null }, // error slot
      }),
    ];
    const trend = computeJurorTrend(reviews, "compliance_legal_flagger", "day");
    expect(trend.points).toEqual([
      { period: "2026-09-01", scoredCount: 1, averageScore: 9 },
    ]);
    expect(trend.overallAverage).toBe(9);
    expect(trend.scoredCount).toBe(1);
  });

  it("returns an empty trend with null overall when the juror never scored", () => {
    const reviews = [
      review({
        created_at: "2026-09-01T09:00:00.000Z",
        jurorScores: { brand_voice_guardian: 7 },
      }),
    ];
    const trend = computeJurorTrend(reviews, "stop_scrolling", "day");
    expect(trend.points).toEqual([]);
    expect(trend.overallAverage).toBeNull();
    expect(trend.scoredCount).toBe(0);
  });
});

// ── computeAnalytics ─────────────────────────────────────────────────────────

describe("computeAnalytics", () => {
  it("composes the full payload with one trend per juror in canonical order", () => {
    const reviews = [
      review({
        created_at: "2026-09-01T09:00:00.000Z",
        aggregate_score: 8,
        verdict: "pass",
        jurorScores: {
          brand_voice_guardian: 8,
          compliance_legal_flagger: 9,
          target_audience_fit: 7,
          seo_discoverability: 6,
          stop_scrolling: 10,
        },
      }),
      review({
        created_at: "2026-09-02T09:00:00.000Z",
        aggregate_score: 6,
        verdict: "revise",
        jurorScores: {
          brand_voice_guardian: 6,
          compliance_legal_flagger: 6,
          target_audience_fit: 6,
          seo_discoverability: 6,
          stop_scrolling: 6,
        },
      }),
    ];
    const analytics = computeAnalytics(reviews);

    expect(analytics.granularity).toBe("day");
    expect(analytics.totalReviews).toBe(2);
    expect(analytics.overallAverageScore).toBe(7); // (8 + 6) / 2
    expect(analytics.verdictDistribution).toEqual({
      pass: 1,
      revise: 1,
      fail: 0,
      total: 2,
    });
    expect(analytics.scoreTrend).toHaveLength(2);
    expect(analytics.verdictTrend).toHaveLength(2);
    expect(analytics.jurorTrends.map((t) => t.persona)).toEqual([
      ...PERSONA_NAMES,
    ]);
  });

  it("honors a month granularity", () => {
    const reviews = [
      review({ created_at: "2026-09-10T00:00:00.000Z", aggregate_score: 8 }),
      review({ created_at: "2026-09-20T00:00:00.000Z", aggregate_score: 6 }),
      review({ created_at: "2026-10-01T00:00:00.000Z", aggregate_score: 4 }),
    ];
    const analytics = computeAnalytics(reviews, { granularity: "month" });
    expect(analytics.granularity).toBe("month");
    expect(analytics.scoreTrend.map((p) => p.period)).toEqual([
      "2026-09",
      "2026-10",
    ]);
    expect(analytics.scoreTrend[0].averageScore).toBe(7); // (8 + 6) / 2
  });

  it("returns a well-formed empty payload for no reviews (Day 34 low-data states)", () => {
    const analytics = computeAnalytics([]);
    expect(analytics.totalReviews).toBe(0);
    expect(analytics.overallAverageScore).toBeNull();
    expect(analytics.verdictDistribution).toEqual({
      pass: 0,
      revise: 0,
      fail: 0,
      total: 0,
    });
    expect(analytics.scoreTrend).toEqual([]);
    expect(analytics.verdictTrend).toEqual([]);
    expect(analytics.jurorTrends).toHaveLength(PERSONA_NAMES.length);
    for (const trend of analytics.jurorTrends) {
      expect(trend.points).toEqual([]);
      expect(trend.overallAverage).toBeNull();
    }
  });
});

// ── getCompanyAnalytics (injectable core) ────────────────────────────────────

describe("getCompanyAnalytics", () => {
  it("returns 200 analytics scoped to the session company", async () => {
    const calls: Array<{ companyId: string; opts: AnalyticsQueryOptions }> = [];
    const fetch = async (companyId: string, opts: AnalyticsQueryOptions) => {
      calls.push({ companyId, opts });
      return [
        review({ created_at: "2026-09-01T00:00:00.000Z", aggregate_score: 8, verdict: "pass" }),
      ];
    };

    const result = await getCompanyAnalytics({
      session: SESSION,
      fetch,
      sinceIso: "2026-08-01T00:00:00.000Z",
    });

    expect(result).toMatchObject({ ok: true, status: 200 });
    if (!result.ok) throw new Error("expected ok");
    expect(result.analytics.totalReviews).toBe(1);
    // Tenancy: company from the session, window passed through.
    expect(calls).toEqual([
      { companyId: COMPANY_ID, opts: { sinceIso: "2026-08-01T00:00:00.000Z" } },
    ]);
  });

  it("rejects an unauthenticated caller with 401 and never queries", async () => {
    const fetch = vi.fn();
    const result = await getCompanyAnalytics({ session: null, fetch });
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns 500 without leaking detail when the query throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = async () => {
      throw new Error("db.listReviewsWithScoresByCompany failed [XX000]: boom");
    };
    const result = await getCompanyAnalytics({ session: SESSION, fetch });
    expect(result).toMatchObject({ ok: false, status: 500 });
    if (result.ok) throw new Error("expected error");
    expect(result.error).not.toContain("boom");
    spy.mockRestore();
  });
});
