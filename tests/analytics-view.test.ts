import { describe, it, expect } from "vitest";
import type {
  JurorTrend,
  JurorTrendPoint,
  ScoreTrendPoint,
  VerdictDistribution,
} from "@/lib/reviews/analytics";
import {
  buildJurorBreakdown,
  buildJurorTrendChart,
  buildScoreTrendChart,
  DEFAULT_CHART_DIMENSIONS,
  formatPeriodLabel,
  JUROR_CHART_DIMENSIONS,
  jurorTrendDescription,
  pickTickIndices,
  scoreTrendDescription,
  summarizeAnalyticsState,
  verdictShares,
} from "@/lib/reviews/analytics-view";
import { PERSONA_NAMES, type PersonaName } from "@/lib/schema/juror";

/**
 * Analytics dashboard view helpers (DailyPlan Day 32): the pure geometry and
 * label logic behind the score-trend chart. The chart is inline SVG, so the
 * numbers it draws from — coordinates, paths, ticks — are proved here (the
 * component just renders them). Mirrors the `scorecard-view`/`history-view`
 * pure-module test pattern.
 */

function point(
  period: string,
  averageScore: number | null,
  reviewCount = 1,
  scoredCount = averageScore === null ? 0 : 1,
): ScoreTrendPoint {
  return { period, reviewCount, scoredCount, averageScore };
}

describe("formatPeriodLabel", () => {
  it("formats a day bucket as 'Mon D'", () => {
    expect(formatPeriodLabel("2026-09-27", "day")).toBe("Sep 27");
    expect(formatPeriodLabel("2026-01-03", "day")).toBe("Jan 3");
  });

  it("formats a week bucket as its starting week", () => {
    expect(formatPeriodLabel("2026-09-21", "week")).toBe("Wk of Sep 21");
  });

  it("formats a month bucket as 'Mon YYYY'", () => {
    expect(formatPeriodLabel("2026-09", "month")).toBe("Sep 2026");
    expect(formatPeriodLabel("2026-12", "month")).toBe("Dec 2026");
  });
});

describe("pickTickIndices", () => {
  it("returns every index when there are at most maxTicks", () => {
    expect(pickTickIndices(0)).toEqual([]);
    expect(pickTickIndices(1)).toEqual([0]);
    expect(pickTickIndices(6)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("evenly spaces indices including both ends when there are more", () => {
    const idx = pickTickIndices(11, 6);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(10);
    expect(idx.length).toBeLessThanOrEqual(6);
    // Strictly increasing, unique.
    for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThan(idx[i - 1]);
  });
});

describe("buildScoreTrendChart", () => {
  it("reports no data for an empty trend and draws nothing", () => {
    const chart = buildScoreTrendChart([], "day");
    expect(chart.hasData).toBe(false);
    expect(chart.points).toEqual([]);
    expect(chart.linePath).toBe("");
    expect(chart.areaPath).toBe("");
    expect(chart.xTicks).toEqual([]);
  });

  it("always renders a fixed 0–10 y-axis", () => {
    const chart = buildScoreTrendChart([point("2026-09-01", 5)], "day");
    expect(chart.yTicks.map((t) => t.value)).toEqual([0, 2, 4, 6, 8, 10]);
    // Score 10 at the top, score 0 at the baseline.
    const top = chart.yTicks.find((t) => t.value === 10)!;
    const bottom = chart.yTicks.find((t) => t.value === 0)!;
    expect(top.y).toBe(DEFAULT_CHART_DIMENSIONS.padding.top);
    expect(bottom.y).toBe(chart.baselineY);
    expect(top.y).toBeLessThan(bottom.y);
  });

  it("centers a single point and draws no connecting line", () => {
    const chart = buildScoreTrendChart([point("2026-09-01", 8)], "day");
    expect(chart.hasData).toBe(true);
    expect(chart.points).toHaveLength(1);
    // plot.left 44 + width 656 / 2 = 372
    expect(chart.points[0].x).toBe(372);
    // score 8 → 16 + 0.2*224 = 60.8
    expect(chart.points[0].y).toBeCloseTo(60.8, 2);
    expect(chart.linePath).toBe("");
    expect(chart.areaPath).toBe("");
    expect(chart.xTicks).toHaveLength(1);
  });

  it("maps multiple points left-to-right and builds line + area paths", () => {
    const chart = buildScoreTrendChart(
      [
        point("2026-09-01", 0),
        point("2026-09-02", 5),
        point("2026-09-03", 10),
      ],
      "day",
    );
    expect(chart.points.map((p) => p.x)).toEqual([44, 372, 700]);
    expect(chart.points.map((p) => p.y)).toEqual([240, 128, 16]);
    expect(chart.linePath).toBe("M 44 240 L 372 128 L 700 16");
    // Area closes back down to the baseline (y=240) at both ends.
    expect(chart.areaPath.startsWith("M 44 240")).toBe(true);
    expect(chart.areaPath.endsWith("L 700 240 Z")).toBe(true);
  });

  it("plots only scored buckets (a null-average bucket leaves no point)", () => {
    const chart = buildScoreTrendChart(
      [
        point("2026-09-01", 6, 2, 1),
        point("2026-09-02", null, 1, 0), // a day with reviews but none scored
        point("2026-09-03", 4, 1, 1),
      ],
      "day",
    );
    expect(chart.points.map((p) => p.period)).toEqual([
      "2026-09-01",
      "2026-09-03",
    ]);
    // The two plotted points span the full width.
    expect(chart.points[0].x).toBe(44);
    expect(chart.points[1].x).toBe(700);
    expect(chart.points[0].label).toBe("Sep 1");
    expect(chart.points[0].reviewCount).toBe(2);
    expect(chart.points[0].scoredCount).toBe(1);
  });
});

describe("scoreTrendDescription", () => {
  it("describes the empty case", () => {
    const chart = buildScoreTrendChart([], "day");
    expect(scoreTrendDescription(chart)).toMatch(/no score trend/i);
  });

  it("describes a single point", () => {
    const chart = buildScoreTrendChart([point("2026-09-01", 7)], "day");
    expect(scoreTrendDescription(chart)).toBe(
      "Average score 7.0 out of 10 for Sep 1.",
    );
  });

  it("names the trend direction across multiple points", () => {
    const up = buildScoreTrendChart(
      [point("2026-09-01", 4), point("2026-09-02", 8)],
      "day",
    );
    expect(scoreTrendDescription(up)).toMatch(/trending up/);

    const down = buildScoreTrendChart(
      [point("2026-09-01", 8), point("2026-09-02", 4)],
      "day",
    );
    expect(scoreTrendDescription(down)).toMatch(/trending down/);

    const level = buildScoreTrendChart(
      [point("2026-09-01", 6), point("2026-09-02", 6)],
      "day",
    );
    expect(scoreTrendDescription(level)).toMatch(/trending level/);
  });
});

describe("verdictShares", () => {
  it("projects counts, percentages, labels and tones in pass/revise/fail order", () => {
    const dist: VerdictDistribution = { pass: 6, revise: 3, fail: 1, total: 10 };
    const shares = verdictShares(dist);
    expect(shares.map((s) => s.verdict)).toEqual(["pass", "revise", "fail"]);
    expect(shares.map((s) => s.count)).toEqual([6, 3, 1]);
    expect(shares.map((s) => s.pct)).toEqual([60, 30, 10]);
    expect(shares.map((s) => s.label)).toEqual(["Pass", "Revise", "Fail"]);
    expect(shares.map((s) => s.tone)).toEqual(["success", "warning", "danger"]);
  });

  it("reports 0% for every verdict when there are no verdicted reviews", () => {
    const dist: VerdictDistribution = { pass: 0, revise: 0, fail: 0, total: 0 };
    expect(verdictShares(dist).every((s) => s.pct === 0)).toBe(true);
  });
});

// ── per-juror breakdown (Day 33) ─────────────────────────────────────────────

function jpoint(
  period: string,
  averageScore: number | null,
  scoredCount = averageScore === null ? 0 : 1,
): JurorTrendPoint {
  return { period, scoredCount, averageScore };
}

function jtrend(
  persona: PersonaName,
  points: JurorTrendPoint[],
  overallAverage: number | null,
  scoredCount: number,
): JurorTrend {
  return { persona, points, overallAverage, scoredCount };
}

describe("buildJurorTrendChart", () => {
  it("reports no data for a juror that never scored", () => {
    const chart = buildJurorTrendChart(
      jtrend("seo_discoverability", [], null, 0),
      "day",
    );
    expect(chart.hasData).toBe(false);
    expect(chart.points).toEqual([]);
    expect(chart.linePath).toBe("");
    expect(chart.areaPath).toBe("");
    expect(chart.xTicks).toEqual([]);
  });

  it("uses the shorter juror dimensions and the fixed 0–10 y-axis", () => {
    const chart = buildJurorTrendChart(
      jtrend("brand_voice_guardian", [jpoint("2026-09-01", 5)], 5, 1),
      "day",
    );
    expect(chart.dimensions).toEqual(JUROR_CHART_DIMENSIONS);
    expect(chart.yTicks.map((t) => t.value)).toEqual([0, 2, 4, 6, 8, 10]);
    // score 10 at the top padding, score 0 at the baseline.
    expect(chart.yTicks.find((t) => t.value === 10)!.y).toBe(
      JUROR_CHART_DIMENSIONS.padding.top,
    );
    expect(chart.yTicks.find((t) => t.value === 0)!.y).toBe(chart.baselineY);
  });

  it("centers a single point and draws no connecting line", () => {
    const chart = buildJurorTrendChart(
      jtrend("target_audience_fit", [jpoint("2026-09-01", 5)], 5, 1),
      "day",
    );
    expect(chart.points).toHaveLength(1);
    // plot.left 36 + width 664 / 2 = 368
    expect(chart.points[0].x).toBe(368);
    // score 5 → 12 + 0.5*138 = 81
    expect(chart.points[0].y).toBeCloseTo(81, 2);
    expect(chart.points[0].scoredCount).toBe(1);
    expect(chart.linePath).toBe("");
  });

  it("maps multiple points left-to-right and builds line + area paths", () => {
    const chart = buildJurorTrendChart(
      jtrend(
        "stop_scrolling",
        [jpoint("2026-09-01", 0), jpoint("2026-09-02", 4), jpoint("2026-09-03", 10)],
        4.7,
        3,
      ),
      "day",
    );
    expect(chart.points.map((p) => p.x)).toEqual([36, 368, 700]);
    // score 0 → 150 (baseline), 4 → 94.8, 10 → 12
    expect(chart.points.map((p) => p.y)).toEqual([150, 94.8, 12]);
    expect(chart.linePath).toBe("M 36 150 L 368 94.8 L 700 12");
    expect(chart.areaPath.startsWith("M 36 150")).toBe(true);
    expect(chart.areaPath.endsWith("L 700 150 Z")).toBe(true);
  });

  it("plots only buckets the juror scored (a null-average bucket leaves no point)", () => {
    const chart = buildJurorTrendChart(
      jtrend(
        "compliance_legal_flagger",
        [
          jpoint("2026-09-01", 6),
          jpoint("2026-09-02", null, 0), // present but unscored → dropped
          jpoint("2026-09-03", 8),
        ],
        7,
        2,
      ),
      "day",
    );
    expect(chart.points.map((p) => p.period)).toEqual([
      "2026-09-01",
      "2026-09-03",
    ]);
    expect(chart.points.map((p) => p.label)).toEqual(["Sep 1", "Sep 3"]);
    expect(chart.points[0].x).toBe(36);
    expect(chart.points[1].x).toBe(700);
  });
});

describe("jurorTrendDescription", () => {
  it("names the lens in the empty case", () => {
    const chart = buildJurorTrendChart(
      jtrend("seo_discoverability", [], null, 0),
      "day",
    );
    expect(jurorTrendDescription(chart, "SEO / Discoverability")).toMatch(
      /no trend to show/i,
    );
    expect(jurorTrendDescription(chart, "SEO / Discoverability")).toContain(
      "SEO / Discoverability",
    );
  });

  it("describes a single point with the lens name", () => {
    const chart = buildJurorTrendChart(
      jtrend("brand_voice_guardian", [jpoint("2026-09-01", 7)], 7, 1),
      "day",
    );
    expect(jurorTrendDescription(chart, "Brand Voice Guardian")).toBe(
      "Brand Voice Guardian scored 7.0 out of 10 for Sep 1.",
    );
  });

  it("names the trend direction across multiple points", () => {
    const up = buildJurorTrendChart(
      jtrend(
        "brand_voice_guardian",
        [jpoint("2026-09-01", 4), jpoint("2026-09-02", 8)],
        6,
        2,
      ),
      "day",
    );
    expect(jurorTrendDescription(up, "Brand Voice Guardian")).toMatch(
      /trending up/,
    );

    const down = buildJurorTrendChart(
      jtrend(
        "brand_voice_guardian",
        [jpoint("2026-09-01", 8), jpoint("2026-09-02", 4)],
        6,
        2,
      ),
      "day",
    );
    expect(jurorTrendDescription(down, "Brand Voice Guardian")).toMatch(
      /trending down/,
    );

    const level = buildJurorTrendChart(
      jtrend(
        "brand_voice_guardian",
        [jpoint("2026-09-01", 6), jpoint("2026-09-02", 6)],
        6,
        2,
      ),
      "day",
    );
    expect(jurorTrendDescription(level, "Brand Voice Guardian")).toMatch(
      /trending level/,
    );
  });
});

// ── analytics display states (Day 34) ───────────────────────────────────────

describe("summarizeAnalyticsState", () => {
  it("reports `empty` with a CTA headline when there are no reviews", () => {
    const state = summarizeAnalyticsState({ totalReviews: 0, scoreTrend: [] });
    expect(state.kind).toBe("empty");
    expect(state.totalReviews).toBe(0);
    expect(state.scoredReviews).toBe(0);
    expect(state.scoredPeriods).toBe(0);
    expect(state.headline).toMatch(/no analytics/i);
    expect(state.detail).not.toBeNull();
  });

  it("reports `unscored` when reviews exist but none were scored", () => {
    // Two reviews on two days, neither scored (e.g. every juror errored).
    const state = summarizeAnalyticsState({
      totalReviews: 2,
      scoreTrend: [
        point("2026-09-01", null, 1, 0),
        point("2026-09-02", null, 1, 0),
      ],
    });
    expect(state.kind).toBe("unscored");
    expect(state.scoredReviews).toBe(0);
    expect(state.scoredPeriods).toBe(0);
    expect(state.headline).toMatch(/no scored reviews/i);
    expect(state.detail).not.toBeNull();
  });

  it("reports `low-data` when only a single period is scored (no trend line)", () => {
    const state = summarizeAnalyticsState({
      totalReviews: 3,
      scoreTrend: [
        point("2026-09-01", 7, 2, 2), // one bucket, two scored reviews
        point("2026-09-02", null, 1, 0),
      ],
    });
    expect(state.kind).toBe("low-data");
    expect(state.scoredReviews).toBe(2);
    expect(state.scoredPeriods).toBe(1);
    expect(state.headline).toMatch(/getting started/i);
    expect(state.detail).toMatch(/trend line/i);
  });

  it("reports `ready` with no copy once two or more periods are scored", () => {
    const state = summarizeAnalyticsState({
      totalReviews: 2,
      scoreTrend: [point("2026-09-01", 6), point("2026-09-02", 8)],
    });
    expect(state.kind).toBe("ready");
    expect(state.scoredReviews).toBe(2);
    expect(state.scoredPeriods).toBe(2);
    expect(state.headline).toBeNull();
    expect(state.detail).toBeNull();
  });

  it("counts scored reviews across buckets even when periods are few", () => {
    // Several scored reviews but all in one bucket → still low-data (one point).
    const state = summarizeAnalyticsState({
      totalReviews: 5,
      scoreTrend: [point("2026-09-01", 7.4, 5, 5)],
    });
    expect(state.kind).toBe("low-data");
    expect(state.scoredReviews).toBe(5);
    expect(state.scoredPeriods).toBe(1);
  });
});

describe("buildJurorBreakdown", () => {
  it("returns one row per juror, preserving the input (canonical) order", () => {
    const trends: JurorTrend[] = PERSONA_NAMES.map((persona) =>
      jtrend(persona, [jpoint("2026-09-01", 8)], 8, 1),
    );
    const rows = buildJurorBreakdown(trends, "day");
    expect(rows.map((r) => r.persona)).toEqual([...PERSONA_NAMES]);
    // Labels come from the shared persona labels (human names).
    expect(rows[0].label).toBe("Brand Voice Guardian");
    expect(rows[3].label).toBe("SEO / Discoverability");
    expect(rows.every((r) => r.chart.hasData)).toBe(true);
  });

  it("maps a scored juror's overall average to a score chip tone + tier word", () => {
    const [row] = buildJurorBreakdown(
      [jtrend("brand_voice_guardian", [jpoint("2026-09-01", 9.2)], 9.2, 1)],
      "day",
    );
    expect(row.overallAverage).toBe(9.2);
    expect(row.scoredCount).toBe(1);
    expect(row.tone).toBe("success");
    expect(row.tierLabel).toBe("Excellent");
  });

  it("reads neutral with no tier word for a juror that never scored", () => {
    const [row] = buildJurorBreakdown(
      [jtrend("compliance_legal_flagger", [], null, 0)],
      "day",
    );
    expect(row.overallAverage).toBeNull();
    expect(row.scoredCount).toBe(0);
    expect(row.tone).toBe("neutral");
    expect(row.tierLabel).toBeNull();
    expect(row.chart.hasData).toBe(false);
  });
});
