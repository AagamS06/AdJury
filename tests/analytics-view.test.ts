import { describe, it, expect } from "vitest";
import type {
  ScoreTrendPoint,
  VerdictDistribution,
} from "@/lib/reviews/analytics";
import {
  buildScoreTrendChart,
  DEFAULT_CHART_DIMENSIONS,
  formatPeriodLabel,
  pickTickIndices,
  scoreTrendDescription,
  verdictShares,
} from "@/lib/reviews/analytics-view";

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
