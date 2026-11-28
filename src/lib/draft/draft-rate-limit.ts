/**
 * Draft-generation rate limiting (DailyPlan Day 90 — Week 13 buffer: the per-plan
 * draft limiter Day 89 flagged as a reviewed follow-up in the Day-47 abuse
 * inventory).
 *
 * The gap this closes: `POST /api/draft` (Day 89 — the Draft Assistant surface)
 * makes ONE real model call per request when a live key is configured
 * (`modelDraftGenerator`). That is genuine AI spend (Rules.md §1 — cost
 * discipline is a feature), yet the endpoint was the one cost-bearing `/api`
 * route with no per-plan limit — a reviewed, *declared* exemption in
 * `ABUSE_SURFACE_POSTURE`, never a silent gap. Day 90 promotes that follow-up:
 * the draft endpoint now enforces the same kind of per-plan limit every other
 * cost-bearing endpoint does, so "limits enforced consistently" (the Day-47 DoD)
 * holds for the generator too.
 *
 * This mirrors `export-access.ts` / `read-access.ts` exactly, over the SAME
 * shared primitives — the generic `SlidingWindowStore` and the shared
 * `evaluateRateLimit` / `rateLimitHeaders` / `composeRateLimitMessage` decision +
 * response helpers — so the four limiters (review, export, read, draft) are
 * provably one mechanism, not four drifting copies (Rules.md §7). The abuse
 * audit (`security/abuse-audit.ts`) pins that every cost-bearing endpoint wires
 * one of them.
 *
 * Window + ceilings: a draft is a single model call (vs a review's six-juror
 * fan-out), so it is an AI-cost cap like the review limiter rather than the cheap
 * burst guard the read/export limiters are — hence a **daily** rolling window,
 * matching `rate-limit.ts`. The per-plan ceilings sit modestly above the review
 * ceilings (a draft costs less than a six-call review, so a company can draft
 * more often than it reviews) while staying bounded and non-decreasing with tier,
 * so a runaway integration still can't produce unbounded spend.
 *
 * Unlike reviews (counted from the `reviews` table), a draft persists no row to
 * count, so usage is tracked in a lightweight per-company sliding window — the
 * SAME `SlidingWindowStore` the export/read limiters use. That is **best-effort**:
 * per-process and in-memory, so it resets on a cold start and only throttles a
 * burst against one running instance. A durable backend (Redis / a Postgres
 * events table) is the production upgrade, a one-line swap behind
 * `SlidingWindowStore` with no route edits. See the Blocked/needs-infra note in
 * the PR.
 */
import type { SessionContext } from "@/lib/auth/session";
import {
  composeRateLimitMessage,
  DAY_MS,
  evaluateRateLimit,
  rateLimitHeaders,
  type RateLimitDecision,
  type RateLimitPolicy,
} from "@/lib/rate-limit";
import {
  createInMemorySlidingWindowStore,
  type SlidingWindowStore,
} from "@/lib/security/rate-limit-store";
import type { PlanTier } from "@/types/db";

/**
 * Drafts allowed per plan tier within the rolling (daily) window. A draft is one
 * model call, so this is an AI-cost cap (like the review limiter) rather than the
 * generous burst guard the read/export limiters are; the ceilings sit modestly
 * above the review limiter's (a draft is cheaper than a six-call review) while
 * staying bounded. First-pass sizing; tune as real usage and pricing land.
 * `enterprise` is generous rather than unlimited so a runaway integration still
 * can't draft without bound.
 */
export const DRAFT_RATE_LIMITS: Record<PlanTier, RateLimitPolicy> = {
  free: { limit: 20, windowMs: DAY_MS },
  pro: { limit: 200, windowMs: DAY_MS },
  enterprise: { limit: 2000, windowMs: DAY_MS },
};

/**
 * Resolve the draft policy for a plan, falling back to the most restrictive
 * (`free`) for an unknown/missing tier — fail closed on an unexpected plan value
 * rather than granting a higher allowance (mirrors `resolveRateLimitPolicy` /
 * `resolveExportRateLimitPolicy` / `resolveReadRateLimitPolicy`).
 */
export function resolveDraftRateLimitPolicy(
  plan: PlanTier | null | undefined,
): RateLimitPolicy {
  return (plan && DRAFT_RATE_LIMITS[plan]) || DRAFT_RATE_LIMITS.free;
}

/** Per-company draft usage store (the shared generic sliding-window store). */
export type DraftRateStore = SlidingWindowStore;

/** Factory for an in-memory draft store (aliases the shared generic store). */
export const createInMemoryDraftRateStore = createInMemorySlidingWindowStore;

/**
 * Process-wide default store. The draft endpoint uses this instance so a
 * company's draft rate is tracked across requests, exactly as the export/read
 * limiters share one store across their endpoints.
 */
export const inMemoryDraftRateStore: DraftRateStore =
  createInMemoryDraftRateStore();

export type DraftRateLimitResult =
  | { ok: true }
  | { ok: false; status: 429; error: string; rateLimit: RateLimitDecision };

export interface DraftRateLimitDeps {
  /** The authenticated session (the caller gates this on a non-null session). */
  session: SessionContext;
  /** Injected for deterministic reset/retry math in tests; defaults to now. */
  now?: Date;
  /** Injected store; defaults to the process-wide in-memory one. */
  store?: DraftRateStore;
}

/**
 * Decide whether a draft may run for the session's company and, if so, record it
 * against the window. The current request is not counted until it is allowed, so
 * `count < limit` admits it (a company at the limit is blocked) — identical
 * semantics to the review + export + read limiters. Pure given the injected
 * `store`/`now`.
 */
export function checkDraftRateLimit(
  deps: DraftRateLimitDeps,
): DraftRateLimitResult {
  const now = deps.now ?? new Date();
  const store = deps.store ?? inMemoryDraftRateStore;
  const policy = resolveDraftRateLimitPolicy(deps.session.company.plan_tier);
  const windowStartMs = now.getTime() - policy.windowMs;

  const usage = store.peek(deps.session.companyId, windowStartMs);
  const decision = evaluateRateLimit(policy, usage, now);
  if (!decision.allowed) {
    return {
      ok: false,
      status: 429,
      error: draftRateLimitMessage(decision),
      rateLimit: decision,
    };
  }

  store.record(deps.session.companyId, now.getTime());
  return { ok: true };
}

/**
 * Plain-language, actionable 429 message (Rules.md §6). Names the limit and, when
 * known, when the caller can try again — never leaks internal detail. The window
 * wording tracks `DRAFT_RATE_LIMITS` (one day).
 */
export function draftRateLimitMessage(decision: RateLimitDecision): string {
  return composeRateLimitMessage(
    `You've reached your plan's draft limit (${decision.limit} per 24 hours).`,
    decision,
  );
}

/**
 * Standard rate-limit response headers for a decision (Rules.md §6). Delegates to
 * the shared `rateLimitHeaders` so the header shape is identical across every
 * limiter; kept as a named export for a stable route surface.
 */
export function draftRateLimitHeaders(
  decision: RateLimitDecision,
): Record<string, string> {
  return rateLimitHeaders(decision);
}
