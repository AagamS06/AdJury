/**
 * Cost guardrails (DailyPlan Day 18; Architecture.md §5 "token budget
 * guardrails"; Rules.md §1 cost discipline, §3 no-PII/secret logging, §6 error
 * handling). Every review fans out to five model calls, so an unbounded input
 * size or an unlogged spend defeats the core cost mechanic. This module owns two
 * pure, node-testable layers; the API boundary (`createReview`) wires them so
 * they stay testable without a request or a live model:
 *
 *  1. A SIZE + TOKEN-BUDGET guard, run *before* the fan-out, that rejects
 *     oversized content cheaply (no model spend) with a plain-language message.
 *  2. A redacted USAGE estimate + logger, emitted after a review runs, so cost
 *     per review is observable WITHOUT ever logging the user's content, the
 *     model prompts/outputs, or any secret.
 *
 * Token counts here are ESTIMATES from a provider-agnostic ~4-chars-per-token
 * heuristic — used only for budgeting and observability, never billed. They are
 * deliberately coarse and err toward over-counting on the guard side.
 */

/** Rough characters-per-token for the estimate heuristic. */
export const CHARS_PER_TOKEN = 4;

/**
 * Max characters of submitted content. Single source of truth for the content
 * size cap — the request schema (`ReviewInputSchema`) and the submission form's
 * character counter both derive their limit from this constant.
 */
export const MAX_CONTENT_CHARS = 10_000;

/** Output-token ceiling requested per juror call (caps the model's `max_tokens`). */
export const MAX_OUTPUT_TOKENS_PER_JUROR = 1_024;

/**
 * Estimated fixed prompt overhead per juror (system prompt + scaffolding around
 * the content). A coarse constant; the point is that the fan-out cost scales
 * with the juror count, not just the content length.
 */
export const PROMPT_OVERHEAD_TOKENS_PER_JUROR = 400;

/**
 * Ceiling on the estimated TOTAL input tokens across a whole review's fan-out
 * (content + per-juror overhead + any brand context, × juror count). Sized with
 * clear headroom above a max-length (`MAX_CONTENT_CHARS`) five-juror review so
 * it never contradicts the advertised content limit; it exists to catch a
 * genuinely oversized fan-out once brand context is threaded in (Day 27) or the
 * juror set grows. Cost discipline is a feature (Rules.md §1).
 */
export const MAX_REVIEW_INPUT_TOKENS = 20_000;

/** Estimate tokens for a string with the shared heuristic (never negative). */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Result of the content SIZE guard: either the accepted content's measured size
 * or a rejection carrying a specific, plain-language message plus the limit and
 * the observed value (Rules.md §6 — reject bad input at the boundary with a
 * specific message).
 */
export type ContentSizeDecision =
  | { ok: true; chars: number }
  | {
      ok: false;
      code: "empty" | "too_long";
      message: string;
      limit: number;
      actual: number;
    };

/**
 * Enforce the content size limit. Trims first (leading/trailing whitespace is
 * not content), rejects empty or over-cap content. Structural and cheap — it
 * runs before the token-budget estimate and before any model spend.
 */
export function checkContentSize(content: string): ContentSizeDecision {
  const chars = content.trim().length;
  if (chars === 0) {
    return { ok: false, code: "empty", message: "Content is required.", limit: 1, actual: 0 };
  }
  if (chars > MAX_CONTENT_CHARS) {
    return {
      ok: false,
      code: "too_long",
      message: `Content is too long (${chars.toLocaleString()} characters). Please shorten it to ${MAX_CONTENT_CHARS.toLocaleString()} characters or fewer.`,
      limit: MAX_CONTENT_CHARS,
      actual: chars,
    };
  }
  return { ok: true, chars };
}

/** Inputs that drive a review's estimated token cost. */
export interface ReviewTokenInputs {
  /** Estimated tokens for the submitted content itself. */
  contentTokens: number;
  /** Number of juror calls the content fans out to. */
  jurorCount: number;
  /** Estimated tokens of brand context injected into each juror (0 today; Day 27). */
  brandContextTokens?: number;
}

/**
 * Estimate the total INPUT tokens across a review's fan-out: each juror sees the
 * content, the per-juror prompt overhead, and any brand context, so the cost
 * scales with the juror count.
 */
export function estimateReviewInputTokens(inputs: ReviewTokenInputs): number {
  const jurorCount = Math.max(0, Math.floor(inputs.jurorCount));
  const contentTokens = Math.max(0, Math.floor(inputs.contentTokens));
  const brandContextTokens = Math.max(0, Math.floor(inputs.brandContextTokens ?? 0));
  const perJuror = contentTokens + PROMPT_OVERHEAD_TOKENS_PER_JUROR + brandContextTokens;
  return perJuror * jurorCount;
}

/** Result of the token-budget guard. */
export type TokenBudgetDecision =
  | { ok: true; estimatedInputTokens: number; limit: number }
  | {
      ok: false;
      code: "over_budget";
      message: string;
      limit: number;
      actual: number;
    };

/**
 * Enforce the per-review token budget on the estimated fan-out cost. A generic,
 * plain-language message on rejection (Rules.md §6) — internal token numbers
 * stay in the decision for logging, not the user-facing copy.
 */
export function checkTokenBudget(inputs: ReviewTokenInputs): TokenBudgetDecision {
  const estimatedInputTokens = estimateReviewInputTokens(inputs);
  if (estimatedInputTokens > MAX_REVIEW_INPUT_TOKENS) {
    return {
      ok: false,
      code: "over_budget",
      message:
        "This review is too large to process. Please shorten the content and try again.",
      limit: MAX_REVIEW_INPUT_TOKENS,
      actual: estimatedInputTokens,
    };
  }
  return { ok: true, estimatedInputTokens, limit: MAX_REVIEW_INPUT_TOKENS };
}

/** Estimated usage for one review — the numbers we log for cost observability. */
export interface ReviewUsageEstimate {
  jurorCount: number;
  contentTokens: number;
  /** Estimated input tokens across all juror calls. */
  estimatedInputTokens: number;
  /** Upper bound on output tokens across all juror calls. */
  maxOutputTokens: number;
}

/** Compute the usage estimate for a review from its content and juror count. */
export function estimateReviewUsage(
  content: string,
  jurorCount: number,
  brandContextTokens = 0,
): ReviewUsageEstimate {
  const contentTokens = estimateTokens(content);
  const count = Math.max(0, Math.floor(jurorCount));
  return {
    jurorCount: count,
    contentTokens,
    estimatedInputTokens: estimateReviewInputTokens({
      contentTokens,
      jurorCount: count,
      brandContextTokens,
    }),
    maxOutputTokens: MAX_OUTPUT_TOKENS_PER_JUROR * count,
  };
}

/**
 * Redacted context for a usage log line. Deliberately carries only IDs, counts,
 * and derived scores — NEVER the user's content, the model prompts/outputs, or
 * any secret (Rules.md §3/§6). The types make that a compile-time property: any
 * field a caller might be tempted to add with content would not fit this shape.
 */
export interface ReviewUsageLogMeta {
  op: string;
  companyId: string;
  reviewId: string;
  model: string;
  isMock: boolean;
  verdict: string;
  aggregateScore: number | null;
  jurorsOk: number;
  jurorsError: number;
}

/** A flat, content-free record ready to log. */
export interface ReviewUsageLogRecord extends ReviewUsageLogMeta {
  jurorCount: number;
  contentTokens: number;
  estimatedInputTokens: number;
  maxOutputTokens: number;
}

/** Build the redacted usage record (pure, so the redaction is unit-testable). */
export function buildUsageLogRecord(
  usage: ReviewUsageEstimate,
  meta: ReviewUsageLogMeta,
): ReviewUsageLogRecord {
  return {
    ...meta,
    jurorCount: usage.jurorCount,
    contentTokens: usage.contentTokens,
    estimatedInputTokens: usage.estimatedInputTokens,
    maxOutputTokens: usage.maxOutputTokens,
  };
}

/**
 * Log a review's estimated usage for cost observability. Uses `console.info`
 * (usage is informational, not an error) and emits only the redacted record —
 * no content or secrets ever cross into the logs (Rules.md §3/§6).
 */
export function logReviewUsage(
  usage: ReviewUsageEstimate,
  meta: ReviewUsageLogMeta,
): void {
  console.info("review usage", buildUsageLogRecord(usage, meta));
}
