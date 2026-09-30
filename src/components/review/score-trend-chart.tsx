import {
  buildScoreTrendChart,
  scoreTrendDescription,
  type ChartDimensions,
} from "@/lib/reviews/analytics-view";
import type { ScoreTrendPoint, TrendGranularity } from "@/lib/reviews/analytics";

/**
 * Score-trend chart (DailyPlan Day 32): a company's average review score over
 * time, rendered as plain inline SVG (no charting dependency — Rules.md §2).
 *
 * Hook-free and presentational, like `<Scorecard>`: all geometry comes from the
 * pure, tested `buildScoreTrendChart` in `analytics-view.ts`. Meaning is never
 * carried by the line alone (Design.md §6) — the SVG has a `<title>`/`<desc>`,
 * and an equivalent data table lives below it (in a `<details>`), so keyboard and
 * screen-reader users get the same numbers. Colour comes via `currentColor` +
 * Tailwind `text-*` tokens so the palette stays in one place (Design.md §2).
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
  const { plot } = chart;
  const description = scoreTrendDescription(chart);

  return (
    <figure className="m-0">
      <svg
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
        viewBox={`0 0 ${chart.dimensions.width} ${chart.dimensions.height}`}
        className="h-auto w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <title id={titleId}>Average review score over time</title>
        <desc id={descId}>{description}</desc>

        {/* Horizontal gridlines + y-axis score labels (0–10). */}
        <g className="text-border" aria-hidden="true">
          {chart.yTicks.map((tick) => (
            <line
              key={`grid-${tick.value}`}
              x1={plot.left}
              y1={tick.y}
              x2={plot.right}
              y2={tick.y}
              stroke="currentColor"
              strokeWidth={1}
            />
          ))}
        </g>
        <g className="text-muted" aria-hidden="true" fontSize={11}>
          {chart.yTicks.map((tick) => (
            <text
              key={`ylabel-${tick.value}`}
              x={plot.left - 8}
              y={tick.y}
              textAnchor="end"
              dominantBaseline="middle"
              fill="currentColor"
            >
              {tick.label}
            </text>
          ))}
        </g>

        {/* x-axis date labels. */}
        <g className="text-muted" aria-hidden="true" fontSize={11}>
          {chart.xTicks.map((tick, i) => (
            <text
              key={`xlabel-${i}`}
              x={tick.x}
              y={plot.bottom + 18}
              textAnchor="middle"
              fill="currentColor"
            >
              {tick.label}
            </text>
          ))}
        </g>

        {/* Filled area + trend line (2+ points). */}
        {chart.areaPath && (
          <path
            className="text-royal"
            d={chart.areaPath}
            fill="currentColor"
            fillOpacity={0.08}
            aria-hidden="true"
          />
        )}
        {chart.linePath && (
          <path
            className="text-royal"
            d={chart.linePath}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            aria-hidden="true"
          />
        )}

        {/* Data points. */}
        <g className="text-royal" aria-hidden="true">
          {chart.points.map((p) => (
            <circle
              key={`pt-${p.period}`}
              cx={p.x}
              cy={p.y}
              r={chart.points.length === 1 ? 4 : 3}
              fill="currentColor"
            />
          ))}
        </g>
      </svg>

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
