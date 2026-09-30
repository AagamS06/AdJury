import {
  buildJurorBreakdown,
  jurorTrendDescription,
} from "@/lib/reviews/analytics-view";
import type { JurorTrend, TrendGranularity } from "@/lib/reviews/analytics";
import { CHIP_CLASSES } from "./tone-classes";
import { TrendChartSvg } from "./trend-chart";

/**
 * Per-juror breakdown (DailyPlan Day 33): a drill-down showing how each of the
 * five juror lenses has trended over time, below the company-wide score trend.
 *
 * Hook-free and presentational, built from the Day 31 `jurorTrends` via the
 * pure, tested `buildJurorBreakdown` (so the numbers are proved without a
 * renderer). Each juror gets its own card with an overall-average score chip
 * (reusing the scorecard's score→tone mapping) and a compact trend chart drawn
 * by the shared `<TrendChartSvg>`. Meaning is never carried by the line or
 * colour alone (Design.md §6): every chip pairs its number with a tier word, and
 * each chart has a `<title>`/`<desc>` plus an equivalent data table in a
 * `<details>`. A juror with no scored reviews in the window shows a plain note
 * rather than an empty or fabricated chart (Rules.md §6).
 */
export function JurorBreakdown({
  jurorTrends,
  granularity,
}: {
  jurorTrends: JurorTrend[];
  granularity: TrendGranularity;
}) {
  const rows = buildJurorBreakdown(jurorTrends, granularity);

  return (
    <section className="rounded-md border border-border bg-surface p-5 shadow-[0_1px_2px_rgba(11,11,15,.06)]">
      <div className="max-w-2xl">
        <h2 className="text-lg font-semibold text-navy">Per-juror breakdown</h2>
        <p className="mt-1 text-sm text-muted">
          How each lens has scored your content over time. A juror&apos;s
          average excludes any review where that lens couldn&apos;t be scored.
        </p>
      </div>

      <div className="mt-6 space-y-6">
        {rows.map((row) => {
          const titleId = `juror-trend-${row.persona}-title`;
          const descId = `juror-trend-${row.persona}-desc`;
          const description = jurorTrendDescription(row.chart, row.label);

          return (
            <article
              key={row.persona}
              className="rounded-md border border-border bg-canvas/40 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-ink">
                    {row.label}
                  </h3>
                  <p className="mt-0.5 text-xs text-muted">
                    {row.scoredCount === 0
                      ? "Not scored in this window"
                      : `Scored in ${row.scoredCount} ${
                          row.scoredCount === 1 ? "review" : "reviews"
                        }`}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    className={`rounded-sm px-2.5 py-1 text-sm font-semibold tabular-nums ${
                      CHIP_CLASSES[row.tone]
                    }`}
                  >
                    {row.overallAverage === null
                      ? "—"
                      : row.overallAverage.toFixed(1)}
                    {row.overallAverage !== null && (
                      <span className="font-normal opacity-70"> / 10</span>
                    )}
                    {row.tierLabel && (
                      <span className="sr-only">, {row.tierLabel}</span>
                    )}
                  </span>
                  {row.tierLabel && (
                    <span
                      aria-hidden="true"
                      className="text-xs font-medium text-muted"
                    >
                      {row.tierLabel}
                    </span>
                  )}
                </div>
              </div>

              {row.chart.hasData ? (
                <div className="mt-4">
                  <TrendChartSvg
                    chart={row.chart}
                    title={`${row.label} score over time`}
                    description={description}
                    titleId={titleId}
                    descId={descId}
                  />

                  {/* Accessible, non-visual equivalent of the chart (Design.md §6). */}
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-medium text-royal hover:text-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright">
                      View data as a table
                    </summary>
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full border-collapse text-sm">
                        <caption className="sr-only">
                          {row.label} average score per {granularity}.
                        </caption>
                        <thead>
                          <tr className="border-b border-border text-left text-muted">
                            <th scope="col" className="py-2 pr-4 font-semibold">
                              Period
                            </th>
                            <th
                              scope="col"
                              className="py-2 pr-4 text-right font-semibold"
                            >
                              Avg score
                            </th>
                            <th
                              scope="col"
                              className="py-2 text-right font-semibold"
                            >
                              Scored
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {row.chart.points.map((p) => (
                            <tr
                              key={`row-${row.persona}-${p.period}`}
                              className="border-b border-border/60"
                            >
                              <th
                                scope="row"
                                className="py-2 pr-4 font-normal text-body"
                              >
                                {p.label}
                              </th>
                              <td className="py-2 pr-4 text-right font-medium tabular-nums text-ink">
                                {p.averageScore.toFixed(1)}
                              </td>
                              <td className="py-2 text-right tabular-nums text-body">
                                {p.scoredCount}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted">
                  No scored reviews yet for this lens. Once reviews return a
                  score from {row.label}, its trend will appear here.
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
