/**
 * Pure CSV serialization for a single review (DailyPlan Day 36 — CSV: single
 * review). Turns a reconstructed `PersistedReview` into a well-formed,
 * spreadsheet-friendly CSV string plus a safe download filename.
 *
 * Kept out of the route handler (like the other `src/lib/reviews/*` view
 * modules) so the serialization — RFC 4180 escaping, the formula-injection
 * guard, the column layout — is unit-testable in the node test env without
 * Next's request plumbing or a live database. The download route
 * (`/api/reviews/[id]/export`) only resolves the tenant-scoped review via the
 * existing read core and wires the bytes + headers.
 *
 * Shape: one rectangular table. Review-level fields (id, date, content, score,
 * verdict) repeat on each juror row so the file opens cleanly in Excel / Google
 * Sheets as a single sheet — no mixed sections to confuse a parser. Labels are
 * the same human-readable ones the UI shows (reused from the history/scorecard
 * view helpers) so the report reads like the on-screen review. An errored juror
 * never emits a fake score (Rules.md §6): its score/confidence cells stay empty
 * and the failure reason goes in the summary column.
 */
import {
  CRLF,
  escapeCsvField,
  formatAggregateCell,
  sanitizeFilenamePart,
  toCsvRow,
  UTF8_BOM,
  utcDateStamp,
} from "@/lib/reviews/csv";
import {
  contentTypeLabel,
  formatHistoryDate,
  platformLabel,
} from "@/lib/reviews/history-view";
import { PERSONA_LABELS } from "@/lib/reviews/review-form";
import type { PersistedReview } from "@/lib/reviews/read-reviews";
import { severityLabel, verdictLabel } from "@/lib/reviews/scorecard-view";

// Re-exported so existing importers (and Day 36's tests) keep a stable surface
// while the escaping/BOM primitives themselves live in the shared `csv` module.
export { UTF8_BOM, escapeCsvField };

/** The CSV column headers, in order. Exported so tests pin the layout. */
export const REVIEW_CSV_HEADERS = [
  "Review ID",
  "Date",
  "Content type",
  "Platform",
  "Aggregate score",
  "Verdict",
  "Content",
  "Juror",
  "Status",
  "Score",
  "Confidence",
  "Summary",
  "Issue count",
  "Issues",
  "Suggested rewrite",
] as const;

/** Capitalize a confidence value for the (already-titled) Confidence column. */
function confidenceCell(confidence: "high" | "medium" | "low"): string {
  return confidence.charAt(0).toUpperCase() + confidence.slice(1);
}

/**
 * Serialize a juror's issues into one compact, single-line cell:
 * `Severity: "excerpt" — explanation`, joined with ` | `. Empty when there are
 * no issues. Kept single-line (no embedded newlines) for the widest tool
 * compatibility, even though the escaper would quote them correctly.
 */
function issuesCell(
  issues: { severity: "high" | "medium" | "low"; excerpt: string; explanation: string }[],
): string {
  return issues
    .map(
      (issue) =>
        `${severityLabel(issue.severity)}: ${issue.excerpt} — ${issue.explanation}`,
    )
    .join(" | ");
}

/**
 * Serialize a single review to a CSV string (no BOM — the route adds one).
 *
 * The header row is followed by one row per juror in the review's canonical
 * order. A review with no juror slots still emits a single data row so the
 * review-level fields are never lost.
 */
export function reviewToCsv(review: PersistedReview): string {
  const reviewFields = [
    review.review_id,
    formatHistoryDate(review.created_at),
    contentTypeLabel(review.content_type),
    platformLabel(review.platform) ?? "",
    formatAggregateCell(review.aggregate_score),
    verdictLabel(review.verdict),
    review.content_text,
  ];

  const header = toCsvRow([...REVIEW_CSV_HEADERS]);

  if (review.jurors.length === 0) {
    // No juror results: keep the review-level data, leave the juror columns blank.
    const emptyJuror = ["", "", "", "", "", "", "", ""];
    return [header, toCsvRow([...reviewFields, ...emptyJuror])].join(CRLF);
  }

  const rows = review.jurors.map((juror) => {
    const label = PERSONA_LABELS[juror.persona] ?? juror.persona;
    if (juror.status === "ok") {
      return toCsvRow([
        ...reviewFields,
        label,
        "Scored",
        String(juror.score),
        confidenceCell(juror.confidence),
        juror.summary,
        String(juror.issues.length),
        issuesCell(juror.issues),
        juror.suggested_rewrite,
      ]);
    }
    // Errored juror: no fabricated score; the reason goes in the summary column.
    return toCsvRow([
      ...reviewFields,
      label,
      "Error",
      "",
      "",
      juror.error,
      "",
      "",
      "",
    ]);
  });

  return [header, ...rows].join(CRLF);
}

/**
 * A safe, descriptive download filename for a single review's CSV, e.g.
 * `adjury-review-<id>-2026-10-01.csv`. The date (UTC) is omitted if
 * `created_at` is unparseable, so the name never contains "NaN".
 */
export function reviewCsvFilename(review: PersistedReview): string {
  const id = sanitizeFilenamePart(review.review_id) || "review";
  const parsed = new Date(review.created_at);
  if (Number.isNaN(parsed.getTime())) {
    return `adjury-review-${id}.csv`;
  }
  return `adjury-review-${id}-${utcDateStamp(parsed)}.csv`;
}
