import type { RenderableTrendChart } from "@/lib/reviews/analytics-view";

/**
 * Shared inline-SVG renderer for every 0–10 trend chart (the company score
 * trend and each per-juror trend — DailyPlan Days 32/33). Plain SVG, no
 * charting dependency (Rules.md §2).
 *
 * Hook-free and presentational: all geometry comes from the pure, tested
 * builders in `analytics-view.ts`, so the numbers the chart draws are proved
 * without a renderer. Both `ScoreTrendChart` and `JurorTrendChart` are
 * assignable to `RenderableTrendChart`, so this one component draws both and the
 * two charts can't drift apart (Rules.md §7).
 *
 * Meaning is never carried by the line alone (Design.md §6): the SVG has a
 * `<title>`/`<desc>`, and callers pair it with an equivalent data table. Colour
 * comes via `currentColor` + a Tailwind `text-*` token so the palette stays in
 * one place (Design.md §2).
 */
export function TrendChartSvg({
  chart,
  title,
  description,
  titleId,
  descId,
  accentClassName = "text-royal",
}: {
  chart: RenderableTrendChart;
  title: string;
  description: string;
  titleId: string;
  descId: string;
  /** Tailwind `text-*` token for the line/area/points (default Royal Blue). */
  accentClassName?: string;
}) {
  const { plot } = chart;
  const single = chart.points.length === 1;

  return (
    <svg
      role="img"
      aria-labelledby={`${titleId} ${descId}`}
      viewBox={`0 0 ${chart.dimensions.width} ${chart.dimensions.height}`}
      className="h-auto w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <title id={titleId}>{title}</title>
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
          className={accentClassName}
          d={chart.areaPath}
          fill="currentColor"
          fillOpacity={0.08}
          aria-hidden="true"
        />
      )}
      {chart.linePath && (
        <path
          className={accentClassName}
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
      <g className={accentClassName} aria-hidden="true">
        {chart.points.map((p) => (
          <circle
            key={`pt-${p.period}`}
            cx={p.x}
            cy={p.y}
            r={single ? 4 : 3}
            fill="currentColor"
          />
        ))}
      </g>
    </svg>
  );
}
