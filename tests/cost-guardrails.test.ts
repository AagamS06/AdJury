import { describe, it, expect, vi } from "vitest";
import {
  buildUsageLogRecord,
  checkContentSize,
  checkTokenBudget,
  estimateReviewInputTokens,
  estimateReviewUsage,
  estimateTokens,
  logReviewUsage,
  CHARS_PER_TOKEN,
  MAX_CONTENT_CHARS,
  MAX_OUTPUT_TOKENS_PER_JUROR,
  MAX_REVIEW_INPUT_TOKENS,
  PROMPT_OVERHEAD_TOKENS_PER_JUROR,
  type ReviewUsageEstimate,
  type ReviewUsageLogMeta,
} from "@/lib/ai/cost";

/**
 * Cost guardrails (DailyPlan Day 18). Pure logic — no request, no model, no DB.
 * Proves the DoD: oversized content is rejected, the token budget is enforced,
 * and the usage log carries no PII/secrets.
 */

describe("estimateTokens", () => {
  it("is 0 for empty and rounds up chars / CHARS_PER_TOKEN", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a")).toBe(1); // ceil(1/4)
    expect(estimateTokens("a".repeat(CHARS_PER_TOKEN))).toBe(1);
    expect(estimateTokens("a".repeat(CHARS_PER_TOKEN + 1))).toBe(2);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});

describe("checkContentSize", () => {
  it("accepts normal content and reports its trimmed length", () => {
    const decision = checkContentSize("  Buy our thing.  ");
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.chars).toBe("Buy our thing.".length);
  });

  it("rejects empty and whitespace-only content as `empty`", () => {
    expect(checkContentSize("")).toMatchObject({ ok: false, code: "empty" });
    expect(checkContentSize("   \n\t ")).toMatchObject({ ok: false, code: "empty" });
  });

  it("accepts content exactly at the char cap", () => {
    expect(checkContentSize("x".repeat(MAX_CONTENT_CHARS)).ok).toBe(true);
  });

  it("rejects content one char over the cap as `too_long` with the limit + actual", () => {
    const decision = checkContentSize("x".repeat(MAX_CONTENT_CHARS + 1));
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe("too_long");
      expect(decision.limit).toBe(MAX_CONTENT_CHARS);
      expect(decision.actual).toBe(MAX_CONTENT_CHARS + 1);
      // A specific, actionable, plain-language message (Rules.md §6).
      expect(decision.message).toMatch(/too long/i);
      expect(decision.message).toContain(MAX_CONTENT_CHARS.toLocaleString());
    }
  });

  it("ignores surrounding whitespace when measuring against the cap", () => {
    // Under the cap once trimmed, even though the raw string is over it.
    const raw = " ".repeat(50) + "x".repeat(MAX_CONTENT_CHARS) + " ".repeat(50);
    expect(checkContentSize(raw).ok).toBe(true);
  });
});

describe("estimateReviewInputTokens", () => {
  it("scales content + overhead + brand context by the juror count", () => {
    const est = estimateReviewInputTokens({
      contentTokens: 100,
      jurorCount: 5,
      brandContextTokens: 20,
    });
    expect(est).toBe((100 + PROMPT_OVERHEAD_TOKENS_PER_JUROR + 20) * 5);
  });

  it("treats a missing brand-context value as 0 and floors negatives", () => {
    expect(estimateReviewInputTokens({ contentTokens: 100, jurorCount: 2 })).toBe(
      (100 + PROMPT_OVERHEAD_TOKENS_PER_JUROR) * 2,
    );
    expect(
      estimateReviewInputTokens({ contentTokens: -5, jurorCount: -3, brandContextTokens: -9 }),
    ).toBe(0);
  });
});

describe("checkTokenBudget", () => {
  it("allows a max-length five-juror review (headroom above the char cap)", () => {
    const decision = checkTokenBudget({
      contentTokens: estimateTokens("x".repeat(MAX_CONTENT_CHARS)),
      jurorCount: 5,
      brandContextTokens: 0,
    });
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.estimatedInputTokens).toBeLessThanOrEqual(MAX_REVIEW_INPUT_TOKENS);
  });

  it("rejects a fan-out over budget (e.g. once brand context is added) as `over_budget`", () => {
    const decision = checkTokenBudget({
      contentTokens: estimateTokens("x".repeat(MAX_CONTENT_CHARS)),
      jurorCount: 5,
      brandContextTokens: 2_000,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe("over_budget");
      expect(decision.limit).toBe(MAX_REVIEW_INPUT_TOKENS);
      expect(decision.actual).toBeGreaterThan(MAX_REVIEW_INPUT_TOKENS);
      // Generic, plain-language message — no internal token numbers leaked to the user.
      expect(decision.message).toMatch(/too large/i);
      expect(decision.message).not.toContain(String(decision.actual));
    }
  });

  it("allows a fan-out exactly at the budget", () => {
    // Solve for contentTokens so the estimate lands on the limit with 1 juror.
    const contentTokens = MAX_REVIEW_INPUT_TOKENS - PROMPT_OVERHEAD_TOKENS_PER_JUROR;
    const decision = checkTokenBudget({ contentTokens, jurorCount: 1 });
    expect(decision.ok).toBe(true);
  });
});

describe("estimateReviewUsage", () => {
  it("assembles content tokens, fan-out input tokens, and the output ceiling", () => {
    const content = "x".repeat(400); // 100 content tokens
    const usage = estimateReviewUsage(content, 5);
    expect(usage.jurorCount).toBe(5);
    expect(usage.contentTokens).toBe(100);
    expect(usage.estimatedInputTokens).toBe((100 + PROMPT_OVERHEAD_TOKENS_PER_JUROR) * 5);
    expect(usage.maxOutputTokens).toBe(MAX_OUTPUT_TOKENS_PER_JUROR * 5);
  });
});

describe("usage logging (redacted)", () => {
  const usage: ReviewUsageEstimate = {
    jurorCount: 5,
    contentTokens: 100,
    estimatedInputTokens: 2_500,
    maxOutputTokens: 5_120,
  };
  const meta: ReviewUsageLogMeta = {
    op: "createReview",
    companyId: "company-123",
    reviewId: "review-abc",
    model: "claude-haiku-4-5 (mock)",
    isMock: true,
    verdict: "revise",
    aggregateScore: 7.2,
    jurorsOk: 5,
    jurorsError: 0,
  };

  it("builds a flat record carrying only IDs, counts, and scores", () => {
    const record = buildUsageLogRecord(usage, meta);
    expect(record).toMatchObject({
      op: "createReview",
      companyId: "company-123",
      reviewId: "review-abc",
      jurorCount: 5,
      contentTokens: 100,
      estimatedInputTokens: 2_500,
      maxOutputTokens: 5_120,
      verdict: "revise",
      aggregateScore: 7.2,
    });
  });

  it("never includes the user's content or a secret (the redaction contract)", () => {
    const record = buildUsageLogRecord(usage, meta);
    const serialized = JSON.stringify(record);
    // The sensitive content string and a would-be secret must not appear anywhere.
    expect(serialized).not.toContain("Buy our miracle cure now");
    expect(serialized).not.toContain("sk-secret-key");
    // Only the known, safe keys are present.
    expect(Object.keys(record).sort()).toEqual(
      [
        "aggregateScore",
        "companyId",
        "contentTokens",
        "estimatedInputTokens",
        "isMock",
        "jurorCount",
        "jurorsError",
        "jurorsOk",
        "maxOutputTokens",
        "model",
        "op",
        "reviewId",
        "verdict",
      ].sort(),
    );
  });

  it("logs via console.info with the redacted record", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    logReviewUsage(usage, meta);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith("review usage", buildUsageLogRecord(usage, meta));
    spy.mockRestore();
  });
});
