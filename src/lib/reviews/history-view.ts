/**
 * Pure presentation helpers for the review history list (DailyPlan Day 11).
 *
 * Kept out of the React component (like `review-form.ts` / `scorecard-view.ts`)
 * so the display logic — date formatting, content-type/platform labels, and the
 * row view-model — is unit-testable in the node test env without a browser.
 *
 * The row builder composes a thin `ReviewSummary` (from `read-reviews.ts`) into
 * the display fields the table renders, reusing the scorecard tone/label helpers
 * so a history row's verdict pill and score chip read exactly like the scorecard
 * (Design.md §5). Meaning is never carried by colour alone (Design.md §6): every
 * tone ships with a paired text label (verdict word, score tier word).
 */
import type { ReviewSummary } from "@/lib/reviews/read-reviews";
import {
  CONTENT_TYPE_OPTIONS,
  PLATFORM_OPTIONS,
} from "@/lib/reviews/review-form";
import {
  formatAggregate,
  scoreTierLabel,
  scoreTone,
  verdictLabel,
  verdictTone,
  type Tone,
} from "@/lib/reviews/scorecard-view";

/** Detail-page route for a review (rendered in Day 12; the link target today). */
export function reviewDetailHref(reviewId: string): string {
  return `/review/${reviewId}`;
}

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

/**
 * Format a review's `created_at` for the history list. Built from UTC parts
 * (not `toLocaleDateString`) so it is deterministic across test/runtime locales
 * and timezones. An unparseable value degrades to a neutral label rather than
 * rendering "Invalid Date".
 */
export function formatHistoryDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown date";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** Content-type enum value → human label (reuses the submission-form options). */
export function contentTypeLabel(value: string): string {
  return CONTENT_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

/**
 * Platform value → human label. `null`/empty means "not platform-specific" and
 * returns `null` so the row can omit it. An unknown free-form value falls back
 * to itself (platform is a free-form column in the contract).
 */
export function platformLabel(value: string | null): string | null {
  if (value === null || value.trim() === "") return null;
  return PLATFORM_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

/** A single history row prepared for rendering. */
export interface HistoryRowView {
  reviewId: string;
  href: string;
  date: string;
  contentType: string;
  platform: string | null;
  /** Aggregate score formatted for display ("—" when never scored). */
  aggregate: string;
  /** Tone for the score chip; `neutral` when the review was never scored. */
  aggregateTone: Tone;
  /** Paired text label for the score tone; `null` when never scored. */
  aggregateTierLabel: string | null;
  verdict: string;
  verdictTone: Tone;
}

/**
 * Project a `ReviewSummary` into a `HistoryRowView`. A review with a null
 * aggregate (never scored) reads as neutral with no tier word rather than being
 * forced into a score band — the same honesty the scorecard applies (Rules.md
 * §6: never claim a result we can't back up).
 */
export function toHistoryRow(summary: ReviewSummary): HistoryRowView {
  const scored = summary.aggregate_score !== null;
  return {
    reviewId: summary.review_id,
    href: reviewDetailHref(summary.review_id),
    date: formatHistoryDate(summary.created_at),
    contentType: contentTypeLabel(summary.content_type),
    platform: platformLabel(summary.platform),
    aggregate: formatAggregate(summary.aggregate_score),
    aggregateTone: scored ? scoreTone(summary.aggregate_score as number) : "neutral",
    aggregateTierLabel: scored
      ? scoreTierLabel(summary.aggregate_score as number)
      : null,
    verdict: verdictLabel(summary.verdict),
    verdictTone: verdictTone(summary.verdict),
  };
}
