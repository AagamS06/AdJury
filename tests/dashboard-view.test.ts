import { describe, it, expect } from "vitest";
import type {
  CompanyAnalytics,
  VerdictDistribution,
} from "@/lib/reviews/analytics";
import {
  buildDashboardMetrics,
  passRate,
  RECENT_REVIEWS_LIMIT,
} from "@/lib/reviews/dashboard-view";

/**
 * Dashboard home view helpers (DailyPlan Day 52): the pure key-metric logic
 * behind the landing dashboard's tiles. Mirrors the `analytics-view` /
 * `history-view` pure-module test pattern — the React page just renders these
 * values, so the numbers (and their honest empty states) are proved here.
 */

function dist(
  pass: number,
  revise: number,
  fail: number,
): VerdictDistribution {
  return { pass, revise, fail, total: pass + revise + fail };
}

function analytics(
  overrides: Partial<CompanyAnalytics> = {},
): CompanyAnalytics {
  return {
    granularity: "day",
    totalReviews: 0,
    overallAverageScore: null,
    verdictDistribution: dist(0, 0, 0),
    scoreTrend: [],
    verdictTrend: [],
    jurorTrends: [],
    ...overrides,
  };
}

describe("passRate", () => {
  it("is null when no review carries a verdict", () => {
    expect(passRate(dist(0, 0, 0))).toBeNull();
  });

  it("is the whole-number percentage of verdicted reviews that passed", () => {
    expect(passRate(dist(3, 1, 0))).toBe(75);
    expect(passRate(dist(1, 1, 2))).toBe(25);
    expect(passRate(dist(5, 0, 0))).toBe(100);
    expect(passRate(dist(0, 2, 3))).toBe(0);
  });

  it("rounds to the nearest whole percent", () => {
    // 1 of 3 = 33.33% → 33
    expect(passRate(dist(1, 1, 1))).toBe(33);
    // 2 of 3 = 66.66% → 67
    expect(passRate(dist(2, 1, 0))).toBe(67);
  });
});

describe("buildDashboardMetrics", () => {
  it("returns reviews, average score, and pass rate in order", () => {
    const metrics = buildDashboardMetrics(
      analytics({
        totalReviews: 4,
        overallAverageScore: 7.3,
        verdictDistribution: dist(3, 1, 0),
      }),
    );
    expect(metrics.map((m) => m.key)).toEqual([
      "reviews",
      "average-score",
      "pass-rate",
    ]);
  });

  it("summarizes an active company's activity", () => {
    const [reviews, score, rate] = buildDashboardMetrics(
      analytics({
        totalReviews: 4,
        overallAverageScore: 7.3,
        verdictDistribution: dist(3, 1, 0),
      }),
    );

    expect(reviews.value).toBe("4");
    expect(reviews.hint).toBe("reviews run so far");

    expect(score.value).toBe("7.3");
    expect(score.suffix).toBe("/ 10");
    expect(score.hint).toBe("across scored reviews");

    expect(rate.value).toBe("75");
    expect(rate.suffix).toBe("%");
    expect(rate.hint).toBe("of reviews passed");
  });

  it("stays honest when there is no data (never a fabricated zero)", () => {
    const [reviews, score, rate] = buildDashboardMetrics(analytics());

    // Zero reviews is a real count; the score/pass-rate have nothing to back a
    // number so they read "—" with no unit (Rules.md §6).
    expect(reviews.value).toBe("0");
    expect(reviews.hint).toBe("reviews run so far");

    expect(score.value).toBe("—");
    expect(score.suffix).toBeUndefined();
    expect(score.hint).toBe("No scored reviews yet");

    expect(rate.value).toBe("—");
    expect(rate.suffix).toBeUndefined();
    expect(rate.hint).toBe("No verdicts yet");
  });

  it("uses the singular hint for exactly one review", () => {
    const [reviews] = buildDashboardMetrics(
      analytics({ totalReviews: 1 }),
    );
    expect(reviews.value).toBe("1");
    expect(reviews.hint).toBe("review run so far");
  });

  it("shows a pass rate even before every review is scored", () => {
    // Reviews can exist with no aggregate score yet (unscored), but still carry
    // a verdict in the distribution the pass rate reads from.
    const [, score, rate] = buildDashboardMetrics(
      analytics({
        totalReviews: 2,
        overallAverageScore: null,
        verdictDistribution: dist(1, 0, 1),
      }),
    );
    expect(score.value).toBe("—");
    expect(rate.value).toBe("50");
  });
});

describe("RECENT_REVIEWS_LIMIT", () => {
  it("surfaces a small, bounded number of recent reviews", () => {
    expect(RECENT_REVIEWS_LIMIT).toBe(5);
  });
});
