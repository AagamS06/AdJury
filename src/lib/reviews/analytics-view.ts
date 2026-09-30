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
  JurorTrend,
  ScoreTrendPoint,
  TrendGranularity,
  VerdictDistribution,
} from "@/lib/reviews/analytics";
import { PERSONA_LABELS } from "@/lib/reviews/review-form";
import {
  scoreTierLabel,
  scoreTone,
  verdictLabel,
  verdictTone,
  type Tone,
} from "@/lib/reviews/scorecard-view";
import type { PersonaName, Verdict } from "@/lib/schema/juror";

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

/** The plot rectangle (inside the axis padding) in SVG user units. */
export interface TrendPlot {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * The minimal geometry the shared `<TrendChartSvg>` renderer needs. Both the
 * company-wide `ScoreTrendChart` and a per-juror `JurorTrendChart` are
 * assignable to it (their points carry these fields plus their own extras), so
 * one SVG component draws both — the two charts can't drift apart (Rules.md §7).
 */
export interface RenderableTrendChart {
  dimensions: ChartDimensions;
  plot: TrendPlot;
  points: { period: string; x: number; y: number }[];
  linePath: string;
  areaPath: string;
  yTicks: YAxisTick[];
  xTicks: XAxisTick[];
}

/** The full geometry the SVG component renders for the company score trend. */
export interface ScoreTrendChart {
  dimensions: ChartDimensions;
  plot: TrendPlot;
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

/** A scored input row (its null-average buckets already filtered out). */
interface ScoredPeriod {
  period: string;
  averageScore: number;
}

/** The coordinates + paths + ticks shared by every 0–10 trend chart. */
interface TrendGeometry {
  dimensions: ChartDimensions;
  plot: TrendPlot;
  /** {x, y, label} for each scored input point, aligned with the input order. */
  coords: { x: number; y: number; label: string }[];
  linePath: string;
  areaPath: string;
  yTicks: YAxisTick[];
  xTicks: XAxisTick[];
  baselineY: number;
}

/**
 * The shared geometry core for every 0–10 trend chart (company score trend and
 * per-juror trend alike). Given the already-scored points, it computes the plot
 * rectangle, the fixed 0–10 y-axis, each point's coordinate, the polyline/area
 * paths (empty below two points), and evenly-spaced x-ticks. Keeping this in one
 * place means the two charts are pixel-for-pixel consistent (Rules.md §7).
 */
function computeTrendGeometry(
  scored: ScoredPeriod[],
  granularity: TrendGranularity,
  dimensions: ChartDimensions,
): TrendGeometry {
  const { width, height, padding } = dimensions;
  const plot: TrendPlot = {
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

  const n = scored.length;
  const xForIndex = (i: number): number => {
    if (n <= 1) return round2(plot.left + plot.width / 2);
    return round2(plot.left + (i / (n - 1)) * plot.width);
  };

  const coords = scored.map((p, i) => ({
    x: xForIndex(i),
    y: yForScore(p.averageScore),
    label: formatPeriodLabel(p.period, granularity),
  }));

  let linePath = "";
  let areaPath = "";
  if (coords.length >= 2) {
    linePath = coords
      .map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`)
      .join(" ");
    const first = coords[0];
    const last = coords[coords.length - 1];
    areaPath =
      `M ${first.x} ${baselineY} ` +
      coords.map((c) => `L ${c.x} ${c.y}`).join(" ") +
      ` L ${last.x} ${baselineY} Z`;
  }

  const xTicks: XAxisTick[] = pickTickIndices(coords.length).map((i) => ({
    x: coords[i].x,
    label: coords[i].label,
  }));

  return { dimensions, plot, coords, linePath, areaPath, yTicks, xTicks, baselineY };
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
  const scored = trend.filter(
    (p): p is ScoreTrendPoint & { averageScore: number } =>
      p.averageScore !== null,
  );
  const geo = computeTrendGeometry(scored, granularity, dimensions);

  const points: ScoreTrendChartPoint[] = scored.map((p, i) => ({
    period: p.period,
    label: geo.coords[i].label,
    averageScore: p.averageScore,
    reviewCount: p.reviewCount,
    scoredCount: p.scoredCount,
    x: geo.coords[i].x,
    y: geo.coords[i].y,
  }));

  return {
    dimensions: geo.dimensions,
    plot: geo.plot,
    hasData: points.length > 0,
    points,
    linePath: geo.linePath,
    areaPath: geo.areaPath,
    yTicks: geo.yTicks,
    xTicks: geo.xTicks,
    baselineY: geo.baselineY,
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

// ── per-juror breakdown (DailyPlan Day 33 — drill-down: trend per juror lens) ─

/**
 * A per-juror chart is shorter than the headline score trend (five of them
 * stack on the page) but shares the same fixed 0–10 y-axis so a juror's line is
 * read against the same scale as every other lens and the company trend.
 */
export const JUROR_CHART_DIMENSIONS: ChartDimensions = {
  width: 720,
  height: 180,
  padding: { top: 12, right: 20, bottom: 30, left: 36 },
};

/** One plotted point on a single juror's trend (only buckets it scored). */
export interface JurorTrendChartPoint {
  period: string;
  label: string;
  averageScore: number;
  /** `ok` scores for this juror in this bucket. */
  scoredCount: number;
  x: number;
  y: number;
}

/** The geometry the SVG component renders for one juror's score trend. */
export interface JurorTrendChart {
  dimensions: ChartDimensions;
  plot: TrendPlot;
  /** True when this juror scored at least one bucket. */
  hasData: boolean;
  points: JurorTrendChartPoint[];
  linePath: string;
  areaPath: string;
  yTicks: YAxisTick[];
  xTicks: XAxisTick[];
  baselineY: number;
}

/**
 * Build one juror's trend chart from the Day 31 `JurorTrend`. Like the company
 * score chart it plots only buckets the juror actually scored (an `error`/non-
 * `ok` row is already excluded upstream, so a failed juror never reads as a zero
 * — Rules.md §6) against the shared fixed 0–10 axis.
 */
export function buildJurorTrendChart(
  trend: JurorTrend,
  granularity: TrendGranularity,
  dimensions: ChartDimensions = JUROR_CHART_DIMENSIONS,
): JurorTrendChart {
  const scored = trend.points.filter(
    (p): p is (typeof trend.points)[number] & { averageScore: number } =>
      p.averageScore !== null,
  );
  const geo = computeTrendGeometry(scored, granularity, dimensions);

  const points: JurorTrendChartPoint[] = scored.map((p, i) => ({
    period: p.period,
    label: geo.coords[i].label,
    averageScore: p.averageScore,
    scoredCount: p.scoredCount,
    x: geo.coords[i].x,
    y: geo.coords[i].y,
  }));

  return {
    dimensions: geo.dimensions,
    plot: geo.plot,
    hasData: points.length > 0,
    points,
    linePath: geo.linePath,
    areaPath: geo.areaPath,
    yTicks: geo.yTicks,
    xTicks: geo.xTicks,
    baselineY: geo.baselineY,
  };
}

/**
 * A one-sentence, screen-reader summary of a single juror's trend, used as the
 * juror chart's SVG `<desc>` (Design.md §6). The lens `label` is the human juror
 * name so the description stands on its own out of context.
 */
export function jurorTrendDescription(
  chart: JurorTrendChart,
  label: string,
): string {
  if (!chart.hasData) {
    return `No scored results yet for ${label}, so there is no trend to show.`;
  }
  const first = chart.points[0];
  const last = chart.points[chart.points.length - 1];
  if (chart.points.length === 1) {
    return `${label} scored ${first.averageScore.toFixed(1)} out of 10 for ${first.label}.`;
  }
  const direction =
    last.averageScore > first.averageScore
      ? "up"
      : last.averageScore < first.averageScore
        ? "down"
        : "level";
  return (
    `${label} across ${chart.points.length} periods, ` +
    `from ${first.averageScore.toFixed(1)} out of 10 on ${first.label} ` +
    `to ${last.averageScore.toFixed(1)} on ${last.label} (trending ${direction}).`
  );
}

/** A per-juror row in the analytics drill-down: label, summary, and its trend. */
export interface JurorBreakdownRow {
  persona: PersonaName;
  /** Human juror name (reuses the submission-form labels). */
  label: string;
  /** Mean of this juror's scores across the window (1 dp), or null if none. */
  overallAverage: number | null;
  /** `ok` scores for this juror across the window. */
  scoredCount: number;
  /** Chip tone for the overall average; `neutral` when the juror never scored. */
  tone: Tone;
  /** Short tier word paired with the average (never colour alone — Design.md §6). */
  tierLabel: string | null;
  /** The juror's per-bucket trend chart geometry. */
  chart: JurorTrendChart;
}

/**
 * Project the Day 31 `jurorTrends` into per-juror drill-down rows, preserving
 * the canonical persona order. Each row reuses the scorecard's score→tone and
 * tier-label mapping so a juror's overall average reads exactly like a score
 * chip elsewhere in the app (Design.md §5); a juror that never scored in the
 * window reads neutral with no tier word rather than a fabricated band
 * (Rules.md §6).
 */
export function buildJurorBreakdown(
  jurorTrends: JurorTrend[],
  granularity: TrendGranularity,
  dimensions: ChartDimensions = JUROR_CHART_DIMENSIONS,
): JurorBreakdownRow[] {
  return jurorTrends.map((trend) => {
    const scored = trend.overallAverage !== null;
    return {
      persona: trend.persona,
      label: PERSONA_LABELS[trend.persona] ?? trend.persona,
      overallAverage: trend.overallAverage,
      scoredCount: trend.scoredCount,
      tone: scored ? scoreTone(trend.overallAverage as number) : "neutral",
      tierLabel: scored ? scoreTierLabel(trend.overallAverage as number) : null,
      chart: buildJurorTrendChart(trend, granularity, dimensions),
    };
  });
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
