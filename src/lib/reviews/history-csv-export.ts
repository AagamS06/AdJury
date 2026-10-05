/**
 * Pure CSV serialization for a company's review history (DailyPlan Day 37 —
 * CSV: history). Turns the `ReviewSummary[]` the history list already loads into
 * a well-formed, spreadsheet-friendly CSV string plus a safe download filename.
 *
 * Kept out of the route handler (like `csv-export.ts` and the other
 * `src/lib/reviews/*` view modules) so the serialization — the column layout and
 * the per-cell labels — is unit-testable in the node env without Next's request
 * plumbing or a live database. The download route (`/api/reviews/export`) only
 * resolves the tenant-scoped, filtered summaries via the existing read core and
 * wires the bytes + headers.
 *
 * "Matches the view": each row is built from the *same* label helpers the
 * history table renders (`contentTypeLabel` / `platformLabel` / `formatHistoryDate`
 * / `verdictLabel`), so an exported row reads exactly like its on-screen row. The
 * score cell follows the single-review export's convention — empty for a
 * never-scored review (never a fabricated 0 or an em-dash glyph in a numeric
 * column, Rules.md §6) — keeping the two CSV exports consistent.
 *
 * Shape: one header row then one row per review, in the list's order (the view's
 * newest-first). The thin `ReviewSummary` deliberately omits `content_text`
 * (Day 6), so the history export never leaks full review content — a per-review
 * export (Day 36) is the place to get the content and juror detail.
 */
import {
  CRLF,
  formatAggregateCell,
  sanitizeFilenamePart,
  toCsvRow,
  utcDateStamp,
} from "@/lib/reviews/csv";
import {
  contentTypeLabel,
  formatHistoryDate,
  platformLabel,
} from "@/lib/reviews/history-view";
import type { ReviewSummary } from "@/lib/reviews/read-reviews";
import { verdictLabel } from "@/lib/reviews/scorecard-view";

/** The CSV column headers, in order. Exported so tests pin the layout. */
export const HISTORY_CSV_HEADERS = [
  "Review ID",
  "Date",
  "Content type",
  "Platform",
  "Aggregate score",
  "Verdict",
] as const;

/** Serialize one review summary into its CSV row fields (pre-escaping). */
function summaryToFields(review: ReviewSummary): string[] {
  return [
    review.review_id,
    formatHistoryDate(review.created_at),
    contentTypeLabel(review.content_type),
    platformLabel(review.platform) ?? "",
    formatAggregateCell(review.aggregate_score),
    verdictLabel(review.verdict),
  ];
}

/**
 * Serialize a list of review summaries to a CSV string (no BOM — the route adds
 * one). Always emits the header row; an empty list yields a header-only file so
 * a filtered export with no matches is still a valid, clearly-empty CSV rather
 * than a zero-byte download.
 */
export function historyToCsv(reviews: ReviewSummary[]): string {
  const header = toCsvRow([...HISTORY_CSV_HEADERS]);
  const rows = reviews.map((review) => toCsvRow(summaryToFields(review)));
  return [header, ...rows].join(CRLF);
}

/**
 * A safe, dated download filename for the history CSV, e.g.
 * `adjury-review-history-2026-10-04.csv`. The date (UTC) is taken from `now`
 * (injectable for deterministic tests) and sanitized defensively.
 */
export function historyCsvFilename(now: Date = new Date()): string {
  const stamp = Number.isNaN(now.getTime())
    ? ""
    : `-${sanitizeFilenamePart(utcDateStamp(now))}`;
  return `adjury-review-history${stamp}.csv`;
}
