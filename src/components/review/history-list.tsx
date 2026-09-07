import Link from "next/link";
import type { ReviewSummary } from "@/lib/reviews/read-reviews";
import { toHistoryRow } from "@/lib/reviews/history-view";
import { CHIP_CLASSES, PILL_CLASSES } from "./tone-classes";

/**
 * HistoryList (DailyPlan Day 11, Design.md §5 "Tables/history"): the company's
 * past reviews as a quiet, bordered table — date, content type/platform, the
 * aggregate score, and the verdict — each row linking to its detail page.
 *
 * A pure, hook-free presentational component: it takes the thin `ReviewSummary`
 * list the server page already loaded (company-scoped, no `content_text`) and
 * renders it. Display logic lives in `history-view.ts`; colour → Tailwind lives
 * in `tone-classes.ts`. Colour never travels alone (Design.md §6): the score
 * chip carries its number and a tier word, the verdict pill carries its word.
 */
export function HistoryList({ reviews }: { reviews: ReviewSummary[] }) {
  if (reviews.length === 0) {
    return <HistoryEmpty />;
  }

  const rows = reviews.map(toHistoryRow);

  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface shadow-[0_1px_2px_rgba(11,11,15,.06)]">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">
            Your company&apos;s past reviews, newest first.
          </caption>
          <thead>
            <tr className="border-b border-border bg-canvas text-xs uppercase tracking-wide text-muted">
              <th scope="col" className="px-4 py-3 font-semibold">
                Content
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Date
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Score
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Verdict
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.reviewId}
                className="border-b border-border last:border-b-0 odd:bg-surface even:bg-canvas/40 hover:bg-canvas"
              >
                <td className="px-4 py-3">
                  <Link
                    href={row.href}
                    className="font-medium text-royal hover:text-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
                  >
                    {row.contentType}
                    <span className="sr-only"> — view review</span>
                  </Link>
                  {row.platform && (
                    <span className="mt-0.5 block text-xs text-muted">
                      {row.platform}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-body">
                  {row.date}
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className={`rounded-sm px-2 py-0.5 text-sm font-semibold tabular-nums ${CHIP_CLASSES[row.aggregateTone]}`}
                    >
                      {row.aggregate}
                      <span className="font-normal opacity-70"> / 10</span>
                      {row.aggregateTierLabel && (
                        <span className="sr-only">, {row.aggregateTierLabel}</span>
                      )}
                    </span>
                    {row.aggregateTierLabel && (
                      <span
                        aria-hidden="true"
                        className="hidden text-xs font-medium text-muted sm:inline"
                      >
                        {row.aggregateTierLabel}
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${PILL_CLASSES[row.verdictTone]}`}
                  >
                    <span className="sr-only">Verdict: </span>
                    {row.verdict}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Empty state: no reviews yet — point the user at the submission flow. */
function HistoryEmpty() {
  return (
    <div className="rounded-md border border-dashed border-border bg-surface p-10 text-center">
      <h2 className="text-lg font-semibold text-navy">No reviews yet</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
        When you run marketing content past the five jurors, each review will
        appear here for your whole company.
      </p>
      <Link
        href="/review"
        className="mt-4 inline-block rounded-sm bg-royal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
      >
        Run your first review
      </Link>
    </div>
  );
}
