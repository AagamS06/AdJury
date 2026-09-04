import { describe, it, expect } from "vitest";
import {
  CONTENT_TYPE_OPTIONS,
  MAX_CONTENT_LENGTH,
  PERSONA_LABELS,
  submitReview,
  validateReviewForm,
} from "@/lib/reviews/review-form";
import { PERSONA_NAMES, type ReviewResult } from "@/lib/schema/juror";

/**
 * Client-side submission-form logic for `/review` (DailyPlan Day 8), exercised
 * without a browser or a network. Validation mirrors the server contract; the
 * fetch mapping is tested with an injected `fetch` stub.
 */

const VALID_FIELDS = {
  content_text: "  Introducing our new sleep aid — clinically studied.  ",
  content_type: "ad_copy",
  platform: "instagram",
};

/** A minimal, schema-valid review payload for the success path. */
function sampleReview(): ReviewResult {
  return {
    review_id: "rev-1",
    content_type: "ad_copy",
    platform: "instagram",
    model: "mock",
    created_at: "2026-09-04T00:00:00.000Z",
    aggregate_score: 7.4,
    verdict: "revise",
    jurors: PERSONA_NAMES.map((persona, i) => ({
      persona,
      status: "ok" as const,
      score: (i % 10) as number,
      confidence: "medium" as const,
      summary: "Looks reasonable.",
      issues: [],
      suggested_rewrite: "A slightly punchier version.",
    })),
  };
}

/** Build a `fetch`-shaped stub returning the given status + JSON body. */
function fetchStub(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
}

describe("validateReviewForm", () => {
  it("accepts valid fields, trims content, and keeps the platform", () => {
    const result = validateReviewForm(VALID_FIELDS);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.content_text).toBe(
      "Introducing our new sleep aid — clinically studied.",
    );
    expect(result.data.content_type).toBe("ad_copy");
    expect(result.data.platform).toBe("instagram");
  });

  it("maps an empty platform to null", () => {
    const result = validateReviewForm({ ...VALID_FIELDS, platform: "" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.platform).toBeNull();
  });

  it("rejects empty / whitespace-only content with a field error", () => {
    const result = validateReviewForm({ ...VALID_FIELDS, content_text: "   " });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.fieldErrors.content_text).toBeTruthy();
  });

  it("rejects content over the max length", () => {
    const result = validateReviewForm({
      ...VALID_FIELDS,
      content_text: "x".repeat(MAX_CONTENT_LENGTH + 1),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.fieldErrors.content_text).toBeTruthy();
  });

  it("rejects a missing content type with a specific message", () => {
    const result = validateReviewForm({ ...VALID_FIELDS, content_type: "" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.fieldErrors.content_type).toBe("Choose a content type.");
  });

  it("rejects an unknown content type value", () => {
    const result = validateReviewForm({
      ...VALID_FIELDS,
      content_type: "blog_post",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.fieldErrors.content_type).toBeTruthy();
  });
});

describe("submitReview", () => {
  it("returns the parsed review on a 201 with a valid payload", async () => {
    const outcome = await submitReview(
      { content_text: "hi", content_type: "email", platform: null },
      fetchStub(201, sampleReview()),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.review.jurors).toHaveLength(PERSONA_NAMES.length);
    expect(outcome.review.verdict).toBe("revise");
  });

  it("surfaces the API error message on a 4xx/5xx", async () => {
    const outcome = await submitReview(
      { content_text: "hi", content_type: "email", platform: null },
      fetchStub(401, { error: "You must be signed in to submit a review." }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected failure");
    expect(outcome.message).toBe("You must be signed in to submit a review.");
  });

  it("reports a generic error when a success payload is malformed", async () => {
    const outcome = await submitReview(
      { content_text: "hi", content_type: "email", platform: null },
      fetchStub(201, { not: "a review" }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected failure");
    expect(outcome.message).toMatch(/unexpected response/i);
  });

  it("reports a network error when fetch rejects", async () => {
    const rejectingFetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const outcome = await submitReview(
      { content_text: "hi", content_type: "email", platform: null },
      rejectingFetch,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected failure");
    expect(outcome.message).toMatch(/network error/i);
  });
});

describe("form metadata", () => {
  it("labels all four schema content types", () => {
    expect(CONTENT_TYPE_OPTIONS.map((o) => o.value)).toEqual([
      "ad_copy",
      "social_post",
      "email",
      "landing_page",
    ]);
  });

  it("has a label for every persona", () => {
    for (const name of PERSONA_NAMES) {
      expect(PERSONA_LABELS[name]).toBeTruthy();
    }
  });
});
