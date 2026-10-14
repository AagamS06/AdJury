/**
 * Read rate limiting (DailyPlan Day 47 — Week 7 abuse protections: "review rate
 * limits + basic abuse safeguards end-to-end. DoD: limits enforced consistently").
 *
 * The gap this closes: the two JSON READ endpoints — `GET /api/reviews` (history
 * list) and `GET /api/reviews/[id]` (one review) — had NO rate limit, while their
 * export siblings (`/api/reviews/export`, `/api/reviews/[id]/export`) have had a
 * per-plan limit since Day 40. A review's export serializes the *same* tenant
 * data the JSON read returns, so an abuser could simply hit the un-limited JSON
 * endpoints to scrape or hammer a tenant's data and bypass the export guard
 * entirely. "Limits enforced consistently" means every tenant-data endpoint — not
 * just the export ones — enforces a per-plan limit. (The app's own pages are
 * server components that call the read cores directly and do NOT go through these
 * HTTP routes, so this limit guards the raw API surface against abuse without
 * throttling normal in-app navigation.)
 *
 * This mirrors `export-access.ts` exactly, over the SAME shared primitives — the
 * generic `SlidingWindowStore` and the shared `evaluateRateLimit` /
 * `rateLimitHeaders` / `composeRateLimitMessage` decision + response helpers — so
 * the three limiters (review, export, read) are provably one mechanism, not three
 * drifting copies (Rules.md §7). The abuse audit (`security/abuse-audit.ts`) pins
 * that every cost-bearing endpoint wires one of them.
 *
 * Reads are cheap (a tenant-scoped DB read + JSON, no model fan-out), so this is a
 * burst/scraping guard, not an AI-cost cap: a short **1-minute** rolling window
 * with generous per-plan ceilings that no legitimate integration would hit but a
 * tight scraping loop would. Like the export store it is **best-effort** and
 * per-instance (see `rate-limit-store.ts`); a durable backend is the production
 * upgrade, injected behind `SlidingWindowStore` with no route edits.
 */
import type { SessionContext } from "@/lib/auth/session";
import {
  composeRateLimitMessage,
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

/** One minute in milliseconds — the read rate-limit (burst) window. */
export const MINUTE_MS = 60 * 1000;

/**
 * Reads allowed per plan tier within the rolling window. Reads are cheap (no
 * model fan-out), so the ceilings are generous — this guards scraping/DoS bursts,
 * not AI spend. First-pass sizing; tune as real usage lands. `enterprise` is high
 * rather than unlimited so a runaway integration still can't read without bound.
 */
export const READ_RATE_LIMITS: Record<PlanTier, RateLimitPolicy> = {
  free: { limit: 60, windowMs: MINUTE_MS },
  pro: { limit: 300, windowMs: MINUTE_MS },
  enterprise: { limit: 1200, windowMs: MINUTE_MS },
};

/**
 * Resolve the read policy for a plan, falling back to the most restrictive
 * (`free`) for an unknown/missing tier — fail closed on an unexpected plan value
 * rather than granting a higher allowance (mirrors `resolveRateLimitPolicy` /
 * `resolveExportRateLimitPolicy`).
 */
export function resolveReadRateLimitPolicy(
  plan: PlanTier | null | undefined,
): RateLimitPolicy {
  return (plan && READ_RATE_LIMITS[plan]) || READ_RATE_LIMITS.free;
}

/** Per-company read usage store (the shared generic sliding-window store). */
export type ReadRateStore = SlidingWindowStore;

/** Factory for an in-memory read store (aliases the shared generic store). */
export const createInMemoryReadRateStore = createInMemorySlidingWindowStore;

/**
 * Process-wide default store. Both read routes share this instance so a company's
 * read rate is tracked across requests to either read endpoint — one shared
 * budget, exactly as the export limiter shares one across both export endpoints.
 */
export const inMemoryReadRateStore: ReadRateStore = createInMemoryReadRateStore();

export type ReadRateLimitResult =
  | { ok: true }
  | { ok: false; status: 429; error: string; rateLimit: RateLimitDecision };

export interface ReadRateLimitDeps {
  /** The authenticated session (the caller gates this on a non-null session). */
  session: SessionContext;
  /** Injected for deterministic reset/retry math in tests; defaults to now. */
  now?: Date;
  /** Injected store; defaults to the process-wide in-memory one. */
  store?: ReadRateStore;
}

/**
 * Decide whether a read may run for the session's company and, if so, record it
 * against the window. The current request is not counted until it is allowed, so
 * `count < limit` admits it (a company at the limit is blocked) — identical
 * semantics to the review + export limiters. Pure given the injected `store`/`now`.
 */
export function checkReadRateLimit(
  deps: ReadRateLimitDeps,
): ReadRateLimitResult {
  const now = deps.now ?? new Date();
  const store = deps.store ?? inMemoryReadRateStore;
  const policy = resolveReadRateLimitPolicy(deps.session.company.plan_tier);
  const windowStartMs = now.getTime() - policy.windowMs;

  const usage = store.peek(deps.session.companyId, windowStartMs);
  const decision = evaluateRateLimit(policy, usage, now);
  if (!decision.allowed) {
    return {
      ok: false,
      status: 429,
      error: readRateLimitMessage(decision),
      rateLimit: decision,
    };
  }

  store.record(deps.session.companyId, now.getTime());
  return { ok: true };
}

/**
 * Plain-language, actionable 429 message (Rules.md §6). Names the limit and, when
 * known, when the caller can try again — never leaks internal detail. The window
 * wording tracks `READ_RATE_LIMITS` (one minute).
 */
export function readRateLimitMessage(decision: RateLimitDecision): string {
  return composeRateLimitMessage(
    `You've reached your plan's request limit (${decision.limit} per minute).`,
    decision,
  );
}

/**
 * Standard rate-limit response headers for a decision (Rules.md §6). Delegates to
 * the shared `rateLimitHeaders` so the header shape is identical across every
 * limiter; kept as a named export for a stable route surface.
 */
export function readRateLimitHeaders(
  decision: RateLimitDecision,
): Record<string, string> {
  return rateLimitHeaders(decision);
}
