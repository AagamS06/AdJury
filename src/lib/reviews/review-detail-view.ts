/**
 * Pure presentation logic for the review detail page (DailyPlan Day 12).
 *
 * The page at `/review/[id]` reconstructs a stored review's full scorecard from
 * the DB. All of the reconstruction (fetch + `reviewWithScoresToPersisted`) and
 * its tenancy/error mapping already live in the Day 6 read core
 * (`getReviewForCompany`), so this module only maps that core's `GetReviewResult`
 * to a small discriminated view-state the Server Component renders. Keeping the
 * branch here — instead of inline in the async component — makes it unit-testable
 * in the node env, mirroring the `review-form.ts` / `scorecard-view.ts` split.
 *
 * The three states mirror the read core's outcomes (Rules.md §6):
 *   - `review`     → 200: render the scorecard.
 *   - `not-found`  → 401/404: the review is absent, belongs to another company,
 *                    or the caller is unauthenticated. All read identically so we
 *                    never reveal cross-tenant existence (Rules.md §5/§6). The
 *                    page renders a real 404 for this state.
 *   - `error`      → 500: a transient load failure; surface a retry message
 *                    rather than a 404 (the review may well exist).
 */
import type {
  GetReviewResult,
  PersistedReview,
} from "@/lib/reviews/read-reviews";

export type ReviewDetailState =
  | { kind: "review"; review: PersistedReview }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

/**
 * Map a `getReviewForCompany` result to the detail page's view-state.
 *
 * A 401 (unauthenticated) collapses into `not-found` alongside the 404: the page
 * is already gated by `requireSession()`, so a 401 here can only mean the session
 * could not be re-resolved, and treating it as "not found" keeps the page from
 * leaking whether the id exists. A 500 stays a distinct `error` state so a
 * transient DB failure shows a retry message instead of a misleading 404.
 */
export function reviewDetailState(result: GetReviewResult): ReviewDetailState {
  if (result.ok) {
    return { kind: "review", review: result.review };
  }
  if (result.status === 500) {
    return { kind: "error", message: result.error };
  }
  return { kind: "not-found" };
}
