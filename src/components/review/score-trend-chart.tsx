import {
  buildScoreTrendChart,
  scoreTrendDescription,
  type ChartDimensions,
} from "@/lib/reviews/analytics-view";
import type { ScoreTrendPoint, TrendGranularity } from "@/lib/reviews/analytics";
import { TrendChartSvg } from "./trend-chart";

/**
 * Score-trend chart (DailyPlan Day 32): a company's average review score over
 * time, rendered as plain inline SVG (no charting dependency — Rules.md §2).
 *
 * Hook-free and presentational, like `<Scorecard>`: all geometry comes from the
 * pure, tested `buildScoreTrendChart` in `analytics-view.ts`, drawn by the
 * shared `<TrendChartSvg>` (Day 33 factored out the SVG so the company and
 * per-juror charts render identically). Meaning is never carried by the line
 * alone (Design.md §6) — the SVG has a `<title>`/`<desc>`, and an equivalent
 * data table lives below it (in a `<details>`), so keyboard and screen-reader
 * users get the same numbers.
 */
export function ScoreTrendChart({
  scoreTrend,
  granularity,
  dimensions,
  titleId = "score-trend-title",
  descId = "score-trend-desc",
}: {
  scoreTrend: ScoreTrendPoint[];
  granularity: TrendGranularity;
  dimensions?: ChartDimensions;
  titleId?: string;
  descId?: string;
}) {
  const chart = buildScoreTrendChart(scoreTrend, granularity, dimensions);
  const description = scoreTrendDescription(chart);

  return (
    <figure className="m-0">
      <TrendChartSvg
        chart={chart}
        title="Average review score over time"
        description={description}
        titleId={titleId}
        descId={descId}
      />

      <figcaption className="mt-2 text-center text-sm text-muted">
        Average review score (0–10) per {granularity}.
      </figcaption>

      {/* Accessible, non-visual equivalent of the chart (Design.md §6). */}
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium text-royal hover:text-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright">
          View data as a table
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">
              Average review score per {granularity}, with review counts.
            </caption>
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Period
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-semibold">
                  Avg score
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-semibold">
                  Scored
                </th>
                <th scope="col" className="py-2 text-right font-semibold">
                  Reviews
                </th>
              </tr>
            </thead>
            <tbody>
              {chart.points.map((p) => (
                <tr key={`row-${p.period}`} className="border-b border-border/60">
                  <th
                    scope="row"
                    className="py-2 pr-4 font-normal text-body"
                  >
                    {p.label}
                  </th>
                  <td className="py-2 pr-4 text-right font-medium tabular-nums text-ink">
                    {p.averageScore.toFixed(1)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums text-body">
                    {p.scoredCount}
                  </td>
                  <td className="py-2 text-right tabular-nums text-body">
                    {p.reviewCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
