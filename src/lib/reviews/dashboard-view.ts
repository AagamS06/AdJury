/**
 * Pure presentation helpers for the dashboard home (DailyPlan Day 52).
 *
 * Kept out of the React page (like `history-view.ts` / `analytics-view.ts`) so
 * the key-metric logic — the headline tiles that summarise company activity — is
 * unit-testable in the node test env without a browser. The page maps these
 * tiles to markup and delegates the recent-reviews table to the existing
 * `HistoryList`, so the dashboard reuses the history row view-model rather than
 * inventing a second one (Rules.md §7).
 *
 * Every metric is derived only from the already-computed `CompanyAnalytics`, and
 * a value a review can't back up stays honest (Rules.md §6): an all-time average
 * with no scored review reads "—" (via `formatAggregate`), and a pass rate with
 * no verdicted review is `null` rather than a fabricated 0%.
 */
import type {
  CompanyAnalytics,
  VerdictDistribution,
} from "@/lib/reviews/analytics";
import { formatAggregate } from "@/lib/reviews/scorecard-view";

/** How many recent reviews the dashboard surfaces before linking to full history. */
export const RECENT_REVIEWS_LIMIT = 5;

/** A single headline metric tile on the dashboard home. */
export interface DashboardMetric {
  /** Stable key for React lists / tests. */
  key: string;
  label: string;
  /** Formatted display value ("—" when there's nothing to show). */
  value: string;
  /** Optional unit shown after the value (omitted when the value is "—"). */
  suffix?: string;
  /** One short supporting line under the value. */
  hint: string;
}

/**
 * Share of verdicted reviews that passed, as a whole-number percentage, or
 * `null` when no review has a verdict yet. Never-scored reviews carry no verdict
 * and so are excluded from the denominator (they're not failures — Rules.md §6).
 */
export function passRate(dist: VerdictDistribution): number | null {
  if (dist.total === 0) return null;
  return Math.round((dist.pass / dist.total) * 100);
}

/**
 * Build the dashboard's key-metric tiles from a company's analytics: how many
 * reviews have run, the average score across scored reviews, and the pass rate.
 * Together they answer "what has my company been doing?" at a glance (DoD:
 * dashboard summarizes company activity). Each tile stays truthful when there's
 * no data yet rather than implying a zero result.
 */
export function buildDashboardMetrics(
  analytics: CompanyAnalytics,
): DashboardMetric[] {
  const { totalReviews, overallAverageScore, verdictDistribution } = analytics;
  const rate = passRate(verdictDistribution);

  return [
    {
      key: "reviews",
      label: "Reviews",
      value: String(totalReviews),
      hint: totalReviews === 1 ? "review run so far" : "reviews run so far",
    },
    {
      key: "average-score",
      label: "Average score",
      value: formatAggregate(overallAverageScore),
      suffix: overallAverageScore === null ? undefined : "/ 10",
      hint:
        overallAverageScore === null
          ? "No scored reviews yet"
          : "across scored reviews",
    },
    {
      key: "pass-rate",
      label: "Pass rate",
      value: rate === null ? "—" : String(rate),
      suffix: rate === null ? undefined : "%",
      hint: rate === null ? "No verdicts yet" : "of reviews passed",
    },
  ];
}
