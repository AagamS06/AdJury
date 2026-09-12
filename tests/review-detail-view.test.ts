import { describe, it, expect } from "vitest";
import type {
  GetReviewResult,
  PersistedReview,
} from "@/lib/reviews/read-reviews";
import { reviewDetailState } from "@/lib/reviews/review-detail-view";

/**
 * Review detail view mapper (DailyPlan Day 12). The reconstruction + tenancy is
 * proven in tests/reviews-read.test.ts (getReviewForCompany, 404-not-403); this
 * file pins the pure branch the Server Component renders from — success shows the
 * scorecard, 401/404 collapse to a single "not found" (no cross-tenant leak,
 * Rules.md §5/§6), and 500 stays a distinct retry message.
 */

const REVIEW_ID = "00000000-0000-0000-0000-000000000001";

function persisted(overrides: Partial<PersistedReview> = {}): PersistedReview {
  return {
    review_id: REVIEW_ID,
    content_type: "ad_copy",
    platform: "instagram",
    created_at: "2026-09-01T00:00:00.000Z",
    aggregate_score: 7.2,
    verdict: "revise",
    jurors: [],
    content_text: "Introducing our new sleep supplement.",
    ...overrides,
  };
}

describe("reviewDetailState", () => {
  it("maps a successful result to the review state, carrying the review through", () => {
    const review = persisted();
    const result: GetReviewResult = { ok: true, status: 200, review };

    const state = reviewDetailState(result);

    expect(state).toEqual({ kind: "review", review });
    // Same object reference — no needless copy of the reconstructed review.
    if (state.kind === "review") expect(state.review).toBe(review);
  });

  it("maps a 404 to not-found", () => {
    const result: GetReviewResult = {
      ok: false,
      status: 404,
      error: "Review not found.",
    };

    expect(reviewDetailState(result)).toEqual({ kind: "not-found" });
  });

  it("maps a 401 to not-found (never reveal whether the id exists)", () => {
    const result: GetReviewResult = {
      ok: false,
      status: 401,
      error: "You must be signed in.",
    };

    expect(reviewDetailState(result)).toEqual({ kind: "not-found" });
  });

  it("maps a 500 to a distinct error state that keeps the retry message", () => {
    const result: GetReviewResult = {
      ok: false,
      status: 500,
      error: "We couldn't load that review. Please try again.",
    };

    expect(reviewDetailState(result)).toEqual({
      kind: "error",
      message: "We couldn't load that review. Please try again.",
    });
  });
});
