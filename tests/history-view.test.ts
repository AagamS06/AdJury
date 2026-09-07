import { describe, it, expect } from "vitest";
import type { ReviewSummary } from "@/lib/reviews/read-reviews";
import {
  contentTypeLabel,
  formatHistoryDate,
  platformLabel,
  reviewDetailHref,
  toHistoryRow,
} from "@/lib/reviews/history-view";

/**
 * Review history view helpers (DailyPlan Day 11). The row-projection and label
 * logic is pure, so it is proven here without a browser or a DB — the page and
 * component only wire these results into markup. Tenancy is proven at the data
 * layer (tests/reviews-read.test.ts, tests/reviews-tenancy.test.ts); this file
 * covers the presentation contract the history table depends on.
 */

const REVIEW_ID = "00000000-0000-0000-0000-000000000001";

function summary(overrides: Partial<ReviewSummary> = {}): ReviewSummary {
  return {
    review_id: REVIEW_ID,
    content_type: "ad_copy",
    platform: "instagram",
    aggregate_score: 7.2,
    verdict: "revise",
    created_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("formatHistoryDate", () => {
  it("formats an ISO timestamp deterministically from UTC parts", () => {
    expect(formatHistoryDate("2026-09-01T00:00:00.000Z")).toBe("Sep 1, 2026");
    expect(formatHistoryDate("2026-12-25T23:59:59.000Z")).toBe("Dec 25, 2026");
    expect(formatHistoryDate("2026-01-05T12:00:00.000Z")).toBe("Jan 5, 2026");
  });

  it("degrades an unparseable value to a neutral label", () => {
    expect(formatHistoryDate("not a date")).toBe("Unknown date");
  });
});

describe("contentTypeLabel", () => {
  it("maps known enum values to human labels", () => {
    expect(contentTypeLabel("ad_copy")).toBe("Ad copy");
    expect(contentTypeLabel("landing_page")).toBe("Landing page");
  });

  it("falls back to the raw value when unknown", () => {
    expect(contentTypeLabel("mystery")).toBe("mystery");
  });
});

describe("platformLabel", () => {
  it("maps known platforms to human labels", () => {
    expect(platformLabel("instagram")).toBe("Instagram");
    expect(platformLabel("x")).toBe("X (Twitter)");
  });

  it("returns null for null or empty (not platform-specific)", () => {
    expect(platformLabel(null)).toBeNull();
    expect(platformLabel("")).toBeNull();
    expect(platformLabel("   ")).toBeNull();
  });

  it("passes through an unknown free-form platform", () => {
    expect(platformLabel("reddit")).toBe("reddit");
  });
});

describe("reviewDetailHref", () => {
  it("points at the detail route (rendered in Day 12)", () => {
    expect(reviewDetailHref(REVIEW_ID)).toBe(`/review/${REVIEW_ID}`);
  });
});

describe("toHistoryRow", () => {
  it("projects a scored review with paired tone + tier labels", () => {
    const row = toHistoryRow(summary());
    expect(row).toEqual({
      reviewId: REVIEW_ID,
      href: `/review/${REVIEW_ID}`,
      date: "Sep 1, 2026",
      contentType: "Ad copy",
      platform: "Instagram",
      aggregate: "7.2",
      aggregateTone: "royal", // 7–8 band
      aggregateTierLabel: "Strong",
      verdict: "Revise",
      verdictTone: "warning",
    });
  });

  it("reads a never-scored review as neutral with no tier word", () => {
    const row = toHistoryRow(
      summary({ aggregate_score: null, verdict: null, platform: null }),
    );
    expect(row.aggregate).toBe("—");
    expect(row.aggregateTone).toBe("neutral");
    expect(row.aggregateTierLabel).toBeNull();
    expect(row.platform).toBeNull();
    expect(row.verdict).toBe("Not scored");
    expect(row.verdictTone).toBe("neutral");
  });

  it("maps score bands to their scorecard tones (pass/fail extremes)", () => {
    expect(toHistoryRow(summary({ aggregate_score: 9.5, verdict: "pass" }))).toMatchObject({
      aggregateTone: "success",
      aggregateTierLabel: "Excellent",
      verdictTone: "success",
    });
    expect(toHistoryRow(summary({ aggregate_score: 1.5, verdict: "fail" }))).toMatchObject({
      aggregateTone: "danger",
      aggregateTierLabel: "Failing",
      verdictTone: "danger",
    });
  });
});
