import { describe, it, expect } from "vitest";
import {
  filterReviewSummaries,
  isHistoryFilterActive,
  NO_PLATFORM,
  parseHistoryFilters,
  UNSCORED_VERDICT,
  type HistoryFilter,
} from "@/lib/reviews/history-filter";
import type { ReviewSummary } from "@/lib/reviews/read-reviews";

/**
 * History filtering (DailyPlan Day 37 — the "filtered" in "export filtered
 * review history to CSV"). Pins the pure query-param parsing (only known values
 * survive) and the predicate (content type / platform / verdict / date range),
 * and the key invariant for "filtered export matches the view": an inactive
 * filter returns the list unchanged.
 */

let seq = 0;
function summary(overrides: Partial<ReviewSummary> = {}): ReviewSummary {
  seq += 1;
  return {
    review_id: `r${seq}`,
    content_type: "ad_copy",
    platform: "instagram",
    aggregate_score: 7.2,
    verdict: "revise",
    created_at: "2026-10-01T12:00:00.000Z",
    ...overrides,
  };
}

function params(obj: Record<string, string>): URLSearchParams {
  return new URLSearchParams(obj);
}

describe("parseHistoryFilters", () => {
  it("returns an empty, inactive filter for no params", () => {
    const filter = parseHistoryFilters(params({}));
    expect(filter).toEqual({});
    expect(isHistoryFilterActive(filter)).toBe(false);
  });

  it("parses a known content type and ignores an unknown one", () => {
    expect(parseHistoryFilters(params({ content_type: "email" }))).toEqual({
      contentType: "email",
    });
    expect(parseHistoryFilters(params({ content_type: "bogus" }))).toEqual({});
  });

  it("parses platform: known value, the NO_PLATFORM sentinel, and free-form", () => {
    expect(parseHistoryFilters(params({ platform: "linkedin" }))).toEqual({
      platform: "linkedin",
    });
    expect(parseHistoryFilters(params({ platform: NO_PLATFORM }))).toEqual({
      platform: NO_PLATFORM,
    });
    expect(parseHistoryFilters(params({ platform: "pinterest" }))).toEqual({
      platform: "pinterest",
    });
    // Blank free-form value is dropped.
    expect(parseHistoryFilters(params({ platform: "   " }))).toEqual({});
  });

  it("parses a verdict and the unscored sentinel; ignores junk", () => {
    expect(parseHistoryFilters(params({ verdict: "pass" }))).toEqual({
      verdict: "pass",
    });
    expect(parseHistoryFilters(params({ verdict: UNSCORED_VERDICT }))).toEqual({
      verdict: UNSCORED_VERDICT,
    });
    expect(parseHistoryFilters(params({ verdict: "maybe" }))).toEqual({});
  });

  it("parses from/to as inclusive UTC-day bounds and rejects bad dates", () => {
    const filter = parseHistoryFilters(params({ from: "2026-10-01", to: "2026-10-03" }));
    expect(filter.fromMs).toBe(Date.UTC(2026, 9, 1, 0, 0, 0, 0));
    expect(filter.toMs).toBe(Date.UTC(2026, 9, 3, 23, 59, 59, 999));

    // Non-real / malformed dates are dropped.
    expect(parseHistoryFilters(params({ from: "2026-02-31" })).fromMs).toBeUndefined();
    expect(parseHistoryFilters(params({ from: "10/01/2026" })).fromMs).toBeUndefined();
    expect(parseHistoryFilters(params({ to: "2026-13-01" })).toMs).toBeUndefined();
  });

  it("composes several dimensions into one active filter", () => {
    const filter = parseHistoryFilters(
      params({ content_type: "social_post", verdict: "fail", platform: NO_PLATFORM }),
    );
    expect(filter).toEqual({
      contentType: "social_post",
      verdict: "fail",
      platform: NO_PLATFORM,
    });
    expect(isHistoryFilterActive(filter)).toBe(true);
  });
});

describe("filterReviewSummaries", () => {
  it("returns the list unchanged (same reference) for an inactive filter", () => {
    const list = [summary(), summary()];
    const out = filterReviewSummaries(list, {});
    expect(out).toBe(list); // "export everything the view shows"
  });

  it("filters by content type", () => {
    const list = [
      summary({ content_type: "ad_copy" }),
      summary({ content_type: "email" }),
    ];
    const out = filterReviewSummaries(list, { contentType: "email" });
    expect(out.map((r) => r.content_type)).toEqual(["email"]);
  });

  it("filters by verdict, and by the unscored sentinel", () => {
    const list = [
      summary({ verdict: "pass" }),
      summary({ verdict: "fail" }),
      summary({ verdict: null, aggregate_score: null }),
    ];
    expect(filterReviewSummaries(list, { verdict: "fail" }).map((r) => r.verdict)).toEqual([
      "fail",
    ]);
    expect(
      filterReviewSummaries(list, { verdict: UNSCORED_VERDICT }).map((r) => r.verdict),
    ).toEqual([null]);
  });

  it("filters by platform, with NO_PLATFORM matching null/blank", () => {
    const list = [
      summary({ platform: "instagram" }),
      summary({ platform: null }),
      summary({ platform: "   " }),
    ];
    expect(
      filterReviewSummaries(list, { platform: "instagram" }).map((r) => r.platform),
    ).toEqual(["instagram"]);
    expect(filterReviewSummaries(list, { platform: NO_PLATFORM })).toHaveLength(2);
  });

  it("filters by an inclusive date range on created_at", () => {
    const list = [
      summary({ review_id: "sep30", created_at: "2026-09-30T23:59:59.000Z" }),
      summary({ review_id: "oct01", created_at: "2026-10-01T00:00:00.000Z" }),
      summary({ review_id: "oct03end", created_at: "2026-10-03T23:59:59.999Z" }),
      summary({ review_id: "oct04", created_at: "2026-10-04T00:00:00.000Z" }),
    ];
    const filter: HistoryFilter = {
      fromMs: Date.UTC(2026, 9, 1, 0, 0, 0, 0),
      toMs: Date.UTC(2026, 9, 3, 23, 59, 59, 999),
    };
    expect(filterReviewSummaries(list, filter).map((r) => r.review_id)).toEqual([
      "oct01",
      "oct03end",
    ]);
  });

  it("drops a review with an unparseable date when a date range is active", () => {
    const list = [summary({ created_at: "not-a-date" })];
    expect(filterReviewSummaries(list, { fromMs: 0 })).toHaveLength(0);
  });

  it("applies multiple dimensions together (AND)", () => {
    const list = [
      summary({ content_type: "email", verdict: "pass" }),
      summary({ content_type: "email", verdict: "fail" }),
      summary({ content_type: "ad_copy", verdict: "pass" }),
    ];
    const out = filterReviewSummaries(list, {
      contentType: "email",
      verdict: "pass",
    });
    expect(out).toHaveLength(1);
    expect(out[0].content_type).toBe("email");
    expect(out[0].verdict).toBe("pass");
  });
});
