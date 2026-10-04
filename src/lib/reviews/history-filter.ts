/**
 * Pure filtering for the review history (DailyPlan Day 37 — the "filtered" in
 * "export filtered review history to CSV").
 *
 * The history view (DailyPlan Day 11) lists a company's reviews by content type,
 * platform, date and verdict. This module turns URL query params into a
 * normalized `HistoryFilter` and applies it to the same `ReviewSummary[]` the
 * view loads — so a filtered export and a (future, Day 41) filtered view filter
 * the *same* loaded set the *same* way, and an export with no active filter is
 * byte-for-byte the full history view ("filtered export matches the view").
 *
 * Kept out of any route/component so it is unit-testable in the node env: the
 * route only reads `request.url`'s params and hands them here.
 */
import type { ReviewSummary } from "@/lib/reviews/read-reviews";
import {
  CONTENT_TYPE_OPTIONS,
  PLATFORM_OPTIONS,
} from "@/lib/reviews/review-form";
import type { ContentType } from "@/types/db";
import type { Verdict } from "@/lib/schema/juror";

/** Sentinel verdict for a review that was never scored (`verdict === null`). */
export const UNSCORED_VERDICT = "unscored" as const;
/** Sentinel platform for a review with no platform (`platform === null`). */
export const NO_PLATFORM = "none" as const;

export type VerdictFilter = Verdict | typeof UNSCORED_VERDICT;

/**
 * A normalized set of history filters. Every field is optional; an absent field
 * means "don't filter on this dimension". Only well-formed, known values survive
 * parsing — an unrecognized param is dropped rather than silently matching
 * nothing, so a bad query never turns an export into a confusing empty file.
 */
export interface HistoryFilter {
  contentType?: ContentType;
  /** A known platform value, or `NO_PLATFORM` to match reviews with no platform. */
  platform?: string;
  verdict?: VerdictFilter;
  /** Inclusive lower bound on `created_at` (epoch ms, start of the UTC day). */
  fromMs?: number;
  /** Inclusive upper bound on `created_at` (epoch ms, end of the UTC day). */
  toMs?: number;
}

const CONTENT_TYPE_VALUES = new Set<string>(
  CONTENT_TYPE_OPTIONS.map((o) => o.value),
);
// The curated platform values (excluding the "" / general option, which maps to
// NO_PLATFORM). `platform` is free-form in the contract, so an unknown non-empty
// value is still accepted as an exact-match filter.
const KNOWN_PLATFORM_VALUES = new Set<string>(
  PLATFORM_OPTIONS.map((o) => o.value).filter((v) => v !== ""),
);
const VERDICT_VALUES = new Set<string>(["pass", "revise", "fail"]);

/** Is any dimension of this filter active? */
export function isHistoryFilterActive(filter: HistoryFilter): boolean {
  return (
    filter.contentType !== undefined ||
    filter.platform !== undefined ||
    filter.verdict !== undefined ||
    filter.fromMs !== undefined ||
    filter.toMs !== undefined
  );
}

/** Parse a `YYYY-MM-DD` date into the epoch-ms bounds of that UTC day. */
function parseUtcDayBounds(
  value: string,
): { startMs: number; endMs: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const startMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  // Reject non-real dates (e.g. 2026-02-31 rolls over to March).
  const check = new Date(startMs);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  const endMs = Date.UTC(year, month - 1, day, 23, 59, 59, 999);
  return { startMs, endMs };
}

/**
 * Build a `HistoryFilter` from URL query params. Recognizes:
 *   - `content_type` — one of the four content-type enum values
 *   - `platform` — a known platform value, or `none` for "not platform-specific"
 *   - `verdict` — `pass` | `revise` | `fail` | `unscored`
 *   - `from` / `to` — inclusive `YYYY-MM-DD` date bounds (UTC) on `created_at`
 *
 * Unknown/malformed values are ignored (dropped from the filter), so the export
 * degrades to a wider result rather than a misleading empty one.
 */
export function parseHistoryFilters(
  params: URLSearchParams,
): HistoryFilter {
  const filter: HistoryFilter = {};

  const contentType = params.get("content_type");
  if (contentType && CONTENT_TYPE_VALUES.has(contentType)) {
    filter.contentType = contentType as ContentType;
  }

  const platform = params.get("platform");
  if (platform) {
    if (platform === NO_PLATFORM) {
      filter.platform = NO_PLATFORM;
    } else if (KNOWN_PLATFORM_VALUES.has(platform)) {
      filter.platform = platform;
    } else if (platform.trim() !== "") {
      // Free-form platform value: exact match against stored value.
      filter.platform = platform.trim();
    }
  }

  const verdict = params.get("verdict");
  if (verdict === UNSCORED_VERDICT) {
    filter.verdict = UNSCORED_VERDICT;
  } else if (verdict && VERDICT_VALUES.has(verdict)) {
    filter.verdict = verdict as Verdict;
  }

  const from = params.get("from");
  if (from) {
    const bounds = parseUtcDayBounds(from);
    if (bounds) filter.fromMs = bounds.startMs;
  }

  const to = params.get("to");
  if (to) {
    const bounds = parseUtcDayBounds(to);
    if (bounds) filter.toMs = bounds.endMs;
  }

  return filter;
}

/** Does one review summary satisfy the filter? */
function matchesFilter(review: ReviewSummary, filter: HistoryFilter): boolean {
  if (filter.contentType && review.content_type !== filter.contentType) {
    return false;
  }

  if (filter.platform !== undefined) {
    if (filter.platform === NO_PLATFORM) {
      // "No platform" matches null or a blank stored value.
      if (review.platform !== null && review.platform.trim() !== "") {
        return false;
      }
    } else if (review.platform !== filter.platform) {
      return false;
    }
  }

  if (filter.verdict !== undefined) {
    if (filter.verdict === UNSCORED_VERDICT) {
      if (review.verdict !== null) return false;
    } else if (review.verdict !== filter.verdict) {
      return false;
    }
  }

  if (filter.fromMs !== undefined || filter.toMs !== undefined) {
    const ms = new Date(review.created_at).getTime();
    // An unparseable timestamp can't satisfy a date-range filter.
    if (Number.isNaN(ms)) return false;
    if (filter.fromMs !== undefined && ms < filter.fromMs) return false;
    if (filter.toMs !== undefined && ms > filter.toMs) return false;
  }

  return true;
}

/**
 * Apply a `HistoryFilter` to a list of review summaries, preserving order. An
 * empty/inactive filter returns the list unchanged (reference-stable for the
 * common "export everything the view shows" case).
 */
export function filterReviewSummaries(
  reviews: ReviewSummary[],
  filter: HistoryFilter,
): ReviewSummary[] {
  if (!isHistoryFilterActive(filter)) return reviews;
  return reviews.filter((review) => matchesFilter(review, filter));
}
