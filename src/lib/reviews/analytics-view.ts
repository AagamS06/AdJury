/**
 * Pure presentation helpers for the analytics dashboard (DailyPlan Day 32).
 *
 * Kept out of the React component (like `history-view.ts` / `scorecard-view.ts`)
 * so the display logic — period-label formatting, the score-trend chart geometry,
 * and the verdict-share view-model — is unit-testable in the node test env
 * without a browser or an SVG renderer. The component maps this geometry to
 * inline SVG; the numbers themselves are proved here.
 *
 * The chart is plain inline SVG (no charting dependency — Rules.md §2): this
 * module turns the Day 31 `ScoreTrendPoint[]` into coordinates, a polyline path,
 * and axis ticks against a fixed 0–10 score scale, so the same data always maps
 * to the same picture. Meaning is never carried by the line alone (Design.md §6):
 * the component pairs it with an accessible data table built from these points.
 */
import type {
  ScoreTrendPoint,
  TrendGranularity,
  VerdictDistribution,
} from "@/lib/reviews/analytics";
import { verdictLabel, verdictTone, type Tone } from "@/lib/reviews/scorecard-view";
import type { Verdict } from "@/lib/schema/juror";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Scores are always on a fixed 0–10 scale, so the y-axis is stable across data. */
export const SCORE_MIN = 0;
export const SCORE_MAX = 10;

/**
 * Format a bucket key for an axis / table label. The key is already UTC-bucketed
 * by `bucketPeriod` (day/week → `YYYY-MM-DD`, month → `YYYY-MM`), so we parse the
 * parts directly rather than through `Date` — no timezone can shift the label.
 */
export function formatPeriodLabel(
  period: string,
  granularity: TrendGranularity,
): string {
  const [yearStr, monthStr, dayStr] = period.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const monthName = MONTHS[month - 1] ?? monthStr ?? "";
  if (granularity === "month" || dayStr === undefined) {
    return `${monthName} ${yearStr}`;
  }
  const day = Number(dayStr);
  if (granularity === "week") {
    // The bucket key is that week's Monday; label it as the week it starts.
    return `Wk of ${monthName} ${day}`;
  }
  return `${monthName} ${day}`;
}

/** Chart canvas geometry (SVG user units). The component scales it responsively. */
export interface ChartDimensions {
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
}

export const DEFAULT_CHART_DIMENSIONS: ChartDimensions = {
  width: 720,
  height: 280,
  padding: { top: 16, right: 20, bottom: 40, left: 44 },
};

/** One plotted point on the score trend (only buckets that were actually scored). */
export interface ScoreTrendChartPoint {
  period: string;
  label: string;
  averageScore: number;
  reviewCount: number;
  scoredCount: number;
  x: number;
  y: number;
}

export interface YAxisTick {
  value: number;
  y: number;
  label: string;
}

export interface XAxisTick {
  x: number;
  label: string;
}

/** The full geometry the SVG component renders. */
export interface ScoreTrendChart {
  dimensions: ChartDimensions;
  plot: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
  /** True when at least one bucket carried a mean score to plot. */
  hasData: boolean;
  points: ScoreTrendChartPoint[];
  /** Polyline `d` through the points; "" when fewer than two points. */
  linePath: string;
  /** Filled area under the line; "" when fewer than two points. */
  areaPath: string;
  yTicks: YAxisTick[];
  xTicks: XAxisTick[];
  /** y coordinate of score 0 (the chart baseline). */
  baselineY: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Choose up to `maxTicks` evenly spaced indices in [0, n), always incl. ends. */
export function pickTickIndices(n: number, maxTicks = 6): number[] {
  if (n <= 0) return [];
  if (n <= maxTicks) return Array.from({ length: n }, (_, i) => i);
  const step = (n - 1) / (maxTicks - 1);
  const seen = new Set<number>();
  for (let k = 0; k < maxTicks; k++) seen.add(Math.round(k * step));
  return [...seen].sort((a, b) => a - b);
}

/**
 * Build the score-trend chart geometry from the Day 31 trend points. Only
 * buckets with a non-null `averageScore` are plotted (a bucket where no review
 * was scored leaves no point — Rules.md §6: never draw a score we can't back up).
 * The y-axis is the fixed 0–10 score scale so charts are comparable over time.
 */
export function buildScoreTrendChart(
  trend: ScoreTrendPoint[],
  granularity: TrendGranularity,
  dimensions: ChartDimensions = DEFAULT_CHART_DIMENSIONS,
): ScoreTrendChart {
  const { width, height, padding } = dimensions;
  const plot = {
    left: padding.left,
    top: padding.top,
    right: width - padding.right,
    bottom: height - padding.bottom,
    width: width - padding.left - padding.right,
    height: height - padding.top - padding.bottom,
  };

  const yForScore = (score: number): number => {
    const clamped = Math.min(SCORE_MAX, Math.max(SCORE_MIN, score));
    const t = (clamped - SCORE_MIN) / (SCORE_MAX - SCORE_MIN);
    return round2(plot.top + (1 - t) * plot.height);
  };
  const baselineY = yForScore(SCORE_MIN);

  const yTicks: YAxisTick[] = [0, 2, 4, 6, 8, 10].map((value) => ({
    value,
    y: yForScore(value),
    label: String(value),
  }));

  const scored = trend.filter(
    (p): p is ScoreTrendPoint & { averageScore: number } =>
      p.averageScore !== null,
  );
  const n = scored.length;

  const xForIndex = (i: number): number => {
    if (n <= 1) return round2(plot.left + plot.width / 2);
    return round2(plot.left + (i / (n - 1)) * plot.width);
  };

  const points: ScoreTrendChartPoint[] = scored.map((p, i) => ({
    period: p.period,
    label: formatPeriodLabel(p.period, granularity),
    averageScore: p.averageScore,
    reviewCount: p.reviewCount,
    scoredCount: p.scoredCount,
    x: xForIndex(i),
    y: yForScore(p.averageScore),
  }));

  let linePath = "";
  let areaPath = "";
  if (points.length >= 2) {
    linePath = points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
      .join(" ");
    const first = points[0];
    const last = points[points.length - 1];
    areaPath =
      `M ${first.x} ${baselineY} ` +
      points.map((p) => `L ${p.x} ${p.y}`).join(" ") +
      ` L ${last.x} ${baselineY} Z`;
  }

  const xTicks: XAxisTick[] = pickTickIndices(points.length).map((i) => ({
    x: points[i].x,
    label: points[i].label,
  }));

  return {
    dimensions,
    plot,
    hasData: points.length > 0,
    points,
    linePath,
    areaPath,
    yTicks,
    xTicks,
    baselineY,
  };
}

/**
 * A one-sentence, screen-reader summary of the score trend, used as the SVG's
 * `<desc>` so the chart's meaning is available without seeing it (Design.md §6).
 */
export function scoreTrendDescription(chart: ScoreTrendChart): string {
  if (!chart.hasData) {
    return "No scored reviews yet, so there is no score trend to show.";
  }
  const first = chart.points[0];
  const last = chart.points[chart.points.length - 1];
  if (chart.points.length === 1) {
    return `Average score ${first.averageScore.toFixed(1)} out of 10 for ${first.label}.`;
  }
  const direction =
    last.averageScore > first.averageScore
      ? "up"
      : last.averageScore < first.averageScore
        ? "down"
        : "level";
  return (
    `Average score across ${chart.points.length} periods, ` +
    `from ${first.averageScore.toFixed(1)} out of 10 on ${first.label} ` +
    `to ${last.averageScore.toFixed(1)} on ${last.label} (trending ${direction}).`
  );
}

/** One verdict's share of the window, for the distribution summary tiles. */
export interface VerdictShareView {
  verdict: Verdict;
  label: string;
  tone: Tone;
  count: number;
  /** Whole-number percentage of verdicted reviews; 0 when none. */
  pct: number;
}

const VERDICT_ORDER: readonly Verdict[] = ["pass", "revise", "fail"];

/**
 * Project the window's verdict distribution into display rows (pass/revise/fail),
 * reusing the scorecard's verdict label/tone so the analytics tiles read exactly
 * like a scorecard's verdict pill (Design.md §5). Colour is always paired with
 * the verdict word (Design.md §6).
 */
export function verdictShares(dist: VerdictDistribution): VerdictShareView[] {
  return VERDICT_ORDER.map((verdict) => {
    const count = dist[verdict];
    return {
      verdict,
      label: verdictLabel(verdict),
      tone: verdictTone(verdict),
      count,
      pct: dist.total > 0 ? Math.round((count / dist.total) * 100) : 0,
    };
  });
}
