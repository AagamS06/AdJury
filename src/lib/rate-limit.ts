import type { PlanTier } from "@/types/db";

/**
 * Per-plan review rate limiting (Architecture.md §7, Rules.md §6, DailyPlan
 * Day 17). Cost discipline is a feature (Rules.md §1): each review fans out to
 * five model calls, so an unbounded submit rate would blow the AI budget. This
 * module owns the *policy* and the pure decision logic; the DB read (how many
 * reviews a company has run in the window) and the HTTP response are wired in
 * `createReview` / the route so this stays unit-testable without a database.
 *
 * The window is rolling: we count reviews created in the last `windowMs` and
 * allow the request only if that count is below the plan's limit. When blocked,
 * the earliest a slot frees up is when the oldest counted review ages out of the
 * window (oldest + windowMs), which is the reset time surfaced to the caller.
 */

/** One day in milliseconds — the default rolling window. */
export const DAY_MS = 24 * 60 * 60 * 1000;

export interface RateLimitPolicy {
  /** Maximum reviews allowed within the rolling window. */
  limit: number;
  /** Rolling window length in milliseconds. */
  windowMs: number;
}

/**
 * Reviews allowed per plan tier within the rolling window. A first-pass sizing
 * tuned for cost control (one small model × five prompts per review); tune as
 * real usage and pricing land. `enterprise` is generous rather than unlimited
 * so a runaway integration still can't produce infinite spend.
 */
export const PLAN_RATE_LIMITS: Record<PlanTier, RateLimitPolicy> = {
  free: { limit: 10, windowMs: DAY_MS },
  pro: { limit: 100, windowMs: DAY_MS },
  enterprise: { limit: 1000, windowMs: DAY_MS },
};

/**
 * Resolve the policy for a plan, falling back to the most restrictive (`free`)
 * for an unknown/missing tier — fail closed on an unexpected plan value rather
 * than granting a higher allowance.
 */
export function resolveRateLimitPolicy(
  plan: PlanTier | null | undefined,
): RateLimitPolicy {
  return (plan && PLAN_RATE_LIMITS[plan]) || PLAN_RATE_LIMITS.free;
}

/** Start of the current rolling window: `now - windowMs`. */
export function rateLimitWindowStart(policy: RateLimitPolicy, now: Date): Date {
  return new Date(now.getTime() - policy.windowMs);
}

/** Usage observed within the window (from the DB read in `queries.ts`). */
export interface RateLimitUsage {
  /** Reviews the company has created within the window. */
  count: number;
  /** ISO timestamp of the OLDEST review in the window, or null if none. */
  oldest: string | null;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** The plan's limit (echoed for the caller's headers/body). */
  limit: number;
  /** Slots left in the window; 0 when at/over the limit. */
  remaining: number;
  /** ISO timestamp when a slot next frees up, or null when usage is empty. */
  resetAt: string | null;
  /** Seconds to wait before retrying; null when the request is allowed. */
  retryAfterSeconds: number | null;
}

/**
 * Decide whether a review may run, given the plan's policy and the observed
 * usage. Pure and deterministic: `now` is injected so the reset math is
 * testable. The new review is not yet counted, so `count < limit` allows it
 * (a company with `count === limit` is blocked).
 */
export function evaluateRateLimit(
  policy: RateLimitPolicy,
  usage: RateLimitUsage,
  now: Date,
): RateLimitDecision {
  const count = Math.max(0, Math.floor(usage.count));
  const allowed = count < policy.limit;
  const remaining = Math.max(0, policy.limit - count);

  // Reset = when the oldest counted review leaves the rolling window.
  let resetAt: string | null = null;
  let resetMs: number | null = null;
  const oldestMs = usage.oldest ? Date.parse(usage.oldest) : NaN;
  if (Number.isFinite(oldestMs)) {
    resetMs = oldestMs + policy.windowMs;
    resetAt = new Date(resetMs).toISOString();
  } else if (!allowed) {
    // Blocked but no parseable oldest timestamp: fall back to a full window
    // out so the caller still gets an honest, non-null reset hint.
    resetMs = now.getTime() + policy.windowMs;
    resetAt = new Date(resetMs).toISOString();
  }

  const retryAfterSeconds =
    !allowed && resetMs !== null
      ? Math.max(1, Math.ceil((resetMs - now.getTime()) / 1000))
      : null;

  return { allowed, limit: policy.limit, remaining, resetAt, retryAfterSeconds };
}

/**
 * Plain-language, actionable 429 message (Rules.md §6). Names the limit and,
 * when known, when the caller can try again — never leaks internal detail.
 */
export function rateLimitMessage(decision: RateLimitDecision): string {
  const base = `You've reached your plan's review limit (${decision.limit} per 24 hours).`;
  if (decision.retryAfterSeconds && decision.retryAfterSeconds > 0) {
    const minutes = Math.ceil(decision.retryAfterSeconds / 60);
    const when =
      minutes >= 60
        ? `about ${Math.ceil(minutes / 60)} hour(s)`
        : `about ${minutes} minute(s)`;
    return `${base} Please try again in ${when}, or upgrade your plan for a higher limit.`;
  }
  return `${base} Please try again later, or upgrade your plan for a higher limit.`;
}
