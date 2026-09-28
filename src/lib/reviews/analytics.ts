/**
 * Analytics data layer (DailyPlan Day 31): pure aggregation of a company's
 * reviews into score/verdict trends over time — per company and per juror.
 *
 * Two concerns live here, mirroring the `read-reviews.ts` split:
 *   1. Pure, node-testable aggregation functions that turn `ReviewWithScores[]`
 *      into a `CompanyAnalytics` time series. No DB, no session, no framework —
 *      this is the "aggregates compute correctly" contract the DoD names.
 *   2. An injectable endpoint core `getCompanyAnalytics` that gates on the
 *      session and maps DB failures to a status, so the Day 32 dashboard route
 *      wires the request-scoped read (RLS-guarded) without re-implementing the
 *      tenancy/error rules.
 *
 * Tenancy is non-negotiable (Rules.md §5): the company is taken from the
 * server-resolved session and passed to the query; the aggregation never sees a
 * client-supplied company. Aggregates exclude values a review can't back up —
 * a null `aggregate_score`, a null `verdict`, or an `error`/non-`ok` juror row
 * are omitted from the means rather than counted as zero (Rules.md §6).
 */
import type { SessionContext } from "@/lib/auth/session";
import type { AnalyticsQueryOptions } from "@/lib/db/queries";
import { PERSONA_NAMES, type PersonaName, type Verdict } from "@/lib/schema/juror";
import type { ReviewWithScores } from "@/types/db";

/** Time-bucket granularity for a trend series. */
export type TrendGranularity = "day" | "week" | "month";

/** One point in the company-wide score trend. */
export interface ScoreTrendPoint {
  /** Bucket key: `YYYY-MM-DD` (day / week-start Monday) or `YYYY-MM` (month). */
  period: string;
  /** Reviews created in this bucket (regardless of whether they were scored). */
  reviewCount: number;
  /** Reviews in this bucket with a non-null `aggregate_score`. */
  scoredCount: number;
  /** Mean of the scored reviews' aggregate scores (1 dp), or null if none scored. */
  averageScore: number | null;
}

/** One point in the company-wide verdict trend. */
export interface VerdictTrendPoint {
  period: string;
  pass: number;
  revise: number;
  fail: number;
  /** Reviews in this bucket that carry a verdict (pass + revise + fail). */
  total: number;
}

/** One point in a single juror's score trend. */
export interface JurorTrendPoint {
  period: string;
  /** `ok` persona_scores rows for this juror in this bucket. */
  scoredCount: number;
  /** Mean of this juror's scores in this bucket (1 dp), or null if none scored. */
  averageScore: number | null;
}

/** A single juror's trend across all buckets, plus its window-wide summary. */
export interface JurorTrend {
  persona: PersonaName;
  points: JurorTrendPoint[];
  /** Mean of this juror's scores across the whole window (1 dp), or null. */
  overallAverage: number | null;
  /** `ok` scores for this juror across the whole window. */
  scoredCount: number;
}

/** Verdict counts across the whole window. */
export interface VerdictDistribution {
  pass: number;
  revise: number;
  fail: number;
  /** Reviews with a verdict (pass + revise + fail); excludes never-scored reviews. */
  total: number;
}

/** The full analytics payload for a company over a window. */
export interface CompanyAnalytics {
  granularity: TrendGranularity;
  /** All reviews in the window, scored or not. */
  totalReviews: number;
  /** Mean aggregate score across scored reviews (1 dp), or null if none scored. */
  overallAverageScore: number | null;
  verdictDistribution: VerdictDistribution;
  /** Company-wide score trend, oldest bucket first. */
  scoreTrend: ScoreTrendPoint[];
  /** Company-wide verdict trend, oldest bucket first. */
  verdictTrend: VerdictTrendPoint[];
  /** One trend per juror, in canonical persona order. */
  jurorTrends: JurorTrend[];
}

const VERDICTS: readonly Verdict[] = ["pass", "revise", "fail"];

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Mean of a list of numbers to 1 dp, or null when the list is empty. */
function meanOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return round1(sum / values.length);
}

/** Pad a number to a fixed width with leading zeros (for sortable bucket keys). */
function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/**
 * Compute the sortable bucket key for a review's `created_at`, in UTC so it is
 * timezone-independent (deterministic in tests, matching `formatHistoryDate`).
 * Returns null for an unparseable timestamp so such a review is dropped from
 * the trend rather than corrupting a bucket.
 *   - day   → `YYYY-MM-DD`
 *   - week  → `YYYY-MM-DD` of that week's Monday (ISO week start)
 *   - month → `YYYY-MM`
 */
export function bucketPeriod(
  iso: string,
  granularity: TrendGranularity,
): string | null {
  const date = new Date(iso);
  const ms = date.getTime();
  if (Number.isNaN(ms)) return null;

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1; // 1-12

  if (granularity === "month") {
    return `${pad(year, 4)}-${pad(month, 2)}`;
  }

  if (granularity === "week") {
    // Shift back to the Monday of this UTC week (getUTCDay: 0=Sun..6=Sat).
    const dayOfWeek = date.getUTCDay();
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    const monday = new Date(ms - daysSinceMonday * 24 * 60 * 60 * 1000);
    return `${pad(monday.getUTCFullYear(), 4)}-${pad(
      monday.getUTCMonth() + 1,
      2,
    )}-${pad(monday.getUTCDate(), 2)}`;
  }

  // day
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(date.getUTCDate(), 2)}`;
}

/** The `ok` persona_scores rows of a review that carry a usable numeric score. */
function okScoredRows(data: ReviewWithScores) {
  return data.scores.filter(
    (s): s is typeof s & { score: number } =>
      s.status === "ok" && typeof s.score === "number",
  );
}

/**
 * Company-wide score trend: reviews grouped by time bucket, with the mean of
 * their (non-null) aggregate scores per bucket. Buckets are emitted oldest
 * first. Reviews with an unparseable timestamp are skipped.
 */
export function computeScoreTrend(
  reviews: ReviewWithScores[],
  granularity: TrendGranularity,
): ScoreTrendPoint[] {
  const buckets = new Map<string, { reviewCount: number; scores: number[] }>();
  for (const { review } of reviews) {
    const period = bucketPeriod(review.created_at, granularity);
    if (period === null) continue;
    const bucket = buckets.get(period) ?? { reviewCount: 0, scores: [] };
    bucket.reviewCount += 1;
    if (typeof review.aggregate_score === "number") {
      bucket.scores.push(review.aggregate_score);
    }
    buckets.set(period, bucket);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([period, b]) => ({
      period,
      reviewCount: b.reviewCount,
      scoredCount: b.scores.length,
      averageScore: meanOrNull(b.scores),
    }));
}

/**
 * Company-wide verdict trend: per-bucket counts of pass/revise/fail. Reviews
 * without a verdict (never scored) contribute to no count. Buckets oldest first.
 */
export function computeVerdictTrend(
  reviews: ReviewWithScores[],
  granularity: TrendGranularity,
): VerdictTrendPoint[] {
  const buckets = new Map<string, VerdictTrendPoint>();
  for (const { review } of reviews) {
    const period = bucketPeriod(review.created_at, granularity);
    if (period === null) continue;
    const bucket =
      buckets.get(period) ??
      ({ period, pass: 0, revise: 0, fail: 0, total: 0 } as VerdictTrendPoint);
    if (review.verdict && VERDICTS.includes(review.verdict)) {
      bucket[review.verdict] += 1;
      bucket.total += 1;
    }
    buckets.set(period, bucket);
  }
  return [...buckets.values()].sort((a, b) =>
    a.period < b.period ? -1 : a.period > b.period ? 1 : 0,
  );
}

/**
 * Per-juror trend: for one persona, the mean of its `ok` scores per time bucket
 * plus a window-wide average. Error/non-`ok` juror rows are excluded from the
 * means (a failed juror is not a zero — Rules.md §6). Buckets oldest first.
 */
export function computeJurorTrend(
  reviews: ReviewWithScores[],
  persona: PersonaName,
  granularity: TrendGranularity,
): JurorTrend {
  const buckets = new Map<string, number[]>();
  const overall: number[] = [];
  for (const data of reviews) {
    const period = bucketPeriod(data.review.created_at, granularity);
    if (period === null) continue;
    const scores = okScoredRows(data)
      .filter((s) => s.persona_name === persona)
      .map((s) => s.score);
    if (scores.length === 0) continue;
    const existing = buckets.get(period) ?? [];
    existing.push(...scores);
    buckets.set(period, existing);
    overall.push(...scores);
  }
  const points = [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([period, scores]) => ({
      period,
      scoredCount: scores.length,
      averageScore: meanOrNull(scores),
    }));
  return {
    persona,
    points,
    overallAverage: meanOrNull(overall),
    scoredCount: overall.length,
  };
}

/** Verdict distribution across the whole window. */
export function computeVerdictDistribution(
  reviews: ReviewWithScores[],
): VerdictDistribution {
  const dist: VerdictDistribution = { pass: 0, revise: 0, fail: 0, total: 0 };
  for (const { review } of reviews) {
    if (review.verdict && VERDICTS.includes(review.verdict)) {
      dist[review.verdict] += 1;
      dist.total += 1;
    }
  }
  return dist;
}

export interface ComputeAnalyticsOptions {
  /** Time-bucket granularity for the trends (default `day`). */
  granularity?: TrendGranularity;
}

/**
 * Compose the full analytics payload from a company's reviews. Pure: the caller
 * supplies the already-scoped `ReviewWithScores[]`; this only aggregates.
 */
export function computeAnalytics(
  reviews: ReviewWithScores[],
  options: ComputeAnalyticsOptions = {},
): CompanyAnalytics {
  const granularity = options.granularity ?? "day";
  const overallScores = reviews
    .map((r) => r.review.aggregate_score)
    .filter((s): s is number => typeof s === "number");

  return {
    granularity,
    totalReviews: reviews.length,
    overallAverageScore: meanOrNull(overallScores),
    verdictDistribution: computeVerdictDistribution(reviews),
    scoreTrend: computeScoreTrend(reviews, granularity),
    verdictTrend: computeVerdictTrend(reviews, granularity),
    jurorTrends: PERSONA_NAMES.map((persona) =>
      computeJurorTrend(reviews, persona, granularity),
    ),
  };
}

// ── injectable endpoint core (Day 32 dashboard will wire the real read) ─────

export type GetAnalyticsResult =
  | { ok: true; status: 200; analytics: CompanyAnalytics }
  | { ok: false; status: 401 | 500; error: string };

export interface GetAnalyticsDeps {
  /** Server-resolved session, or null when the caller is unauthenticated. */
  session: SessionContext | null;
  /**
   * Fetch a company's reviews + scores for the window. Wired to
   * `listReviewsWithScoresByCompany(db, companyId, opts)`; injectable for testing.
   */
  fetch: (
    companyId: string,
    opts: AnalyticsQueryOptions,
  ) => Promise<ReviewWithScores[]>;
  /** Bucket granularity (default `day`). */
  granularity?: TrendGranularity;
  /** Only include reviews created at/after this ISO timestamp. */
  sinceIso?: string;
}

/**
 * Compute a company's analytics, tenant-safe. The company is taken from the
 * session (never the client — Rules.md §5); an unauthenticated caller gets 401
 * and never touches the DB, and a query failure is logged with redacted context
 * and mapped to a 500 with a plain-language message (Rules.md §6).
 */
export async function getCompanyAnalytics(
  deps: GetAnalyticsDeps,
): Promise<GetAnalyticsResult> {
  if (!deps.session) {
    return { ok: false, status: 401, error: "You must be signed in." };
  }

  let reviews: ReviewWithScores[];
  try {
    reviews = await deps.fetch(deps.session.companyId, {
      sinceIso: deps.sinceIso,
    });
  } catch (err) {
    console.error("analytics fetch failed", {
      op: "getCompanyAnalytics",
      companyId: deps.session.companyId,
      message: err instanceof Error ? err.message : "unknown error",
    });
    return {
      ok: false,
      status: 500,
      error: "We couldn't load your analytics. Please try again.",
    };
  }

  return {
    ok: true,
    status: 200,
    analytics: computeAnalytics(reviews, { granularity: deps.granularity }),
  };
}
