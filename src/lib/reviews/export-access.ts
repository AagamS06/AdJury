/**
 * Export authorization + rate limiting (DailyPlan Day 40 — "Export authz":
 * `/api/export` tenancy + auth checks; rate-limit exports. DoD: only owners can
 * export their data).
 *
 * The two export routes — `GET /api/reviews/[id]/export` (Day 36/38) and
 * `GET /api/reviews/export` (Day 37) — are already **tenant-safe by
 * construction**: both resolve the data through the Day 6 read cores
 * (`getReviewForCompany` / `listReviewsForCompany`), which take the company from
 * the server-resolved session (never the URL/client — Rules.md §5), read through
 * the request-scoped anon client so RLS is the primary guard, return 401 when
 * unauthenticated, and collapse an absent-or-other-company review to 404 (never
 * reveal cross-tenant existence — Rules.md §6). So "only owners can export their
 * data" holds today: a review belongs to a company, and only an authenticated
 * member of that company can read — hence export — it. Export access
 * deliberately mirrors **read** access (any authenticated member of the owning
 * company), not the admin role, so an export stays consistent with the on-screen
 * views it serializes — the history page and review-detail page are
 * member-accessible (`requireSession`, not `requireAdmin`), and Day 37's
 * "filtered export matches the view" would break if export were admin-only.
 *
 * What Day 40 adds on top is a **per-plan export rate limit** — a cost/abuse
 * guard (Rules.md §1 cost discipline) so a script can't hammer the export
 * endpoints to scrape a tenant's data or run up serialization cost. The pure
 * decision math is reused from `rate-limit.ts` (`evaluateRateLimit`), so the
 * reset/retry semantics are identical to the review limiter and already covered
 * by its tests; this module owns the export-specific *policy*, the per-company
 * usage *store*, and the thin orchestration.
 *
 * Unlike reviews (counted from the `reviews` table), exports have no persisted
 * rows to count, so usage is tracked in a lightweight in-memory sliding window
 * keyed by company. That is **best-effort**: it is per-instance and resets on a
 * cold start, so it throttles a burst from one running instance rather than
 * enforcing a hard global quota. See the Blocked/needs-infra note in the PR —
 * a durable store (Redis / a Postgres `export_events` table) is the production
 * upgrade; the store is injected behind `ExportRateStore` so swapping it in is a
 * one-line change with no route edits.
 */
import type { SessionContext } from "@/lib/auth/session";
import {
  evaluateRateLimit,
  type RateLimitDecision,
  type RateLimitPolicy,
  type RateLimitUsage,
} from "@/lib/rate-limit";
import type { PlanTier } from "@/types/db";

/** One hour in milliseconds — the export rate-limit window. */
export const HOUR_MS = 60 * 60 * 1000;

/**
 * Exports allowed per plan tier within the rolling window. Exports are cheap
 * relative to a review (pure serialization, no model fan-out), so the ceilings
 * are generous — this guards scraping/abuse bursts, not AI spend. First-pass
 * sizing; tune as real usage lands. `enterprise` is high rather than unlimited
 * so a runaway integration still can't export without bound.
 */
export const EXPORT_RATE_LIMITS: Record<PlanTier, RateLimitPolicy> = {
  free: { limit: 60, windowMs: HOUR_MS },
  pro: { limit: 600, windowMs: HOUR_MS },
  enterprise: { limit: 6000, windowMs: HOUR_MS },
};

/**
 * Resolve the export policy for a plan, falling back to the most restrictive
 * (`free`) for an unknown/missing tier — fail closed on an unexpected plan value
 * rather than granting a higher allowance (mirrors `resolveRateLimitPolicy`).
 */
export function resolveExportRateLimitPolicy(
  plan: PlanTier | null | undefined,
): RateLimitPolicy {
  return (plan && EXPORT_RATE_LIMITS[plan]) || EXPORT_RATE_LIMITS.free;
}

/**
 * Per-company export usage store. Records the timestamps (ms) of allowed exports
 * and reports usage within a rolling window. Injected into `checkExportRateLimit`
 * so the decision logic stays testable without shared global state, and so a
 * durable backend can replace the default in-memory one without touching routes.
 */
export interface ExportRateStore {
  /**
   * Prior allowed exports for the company within [`windowStartMs`, now]. Prunes
   * entries older than `windowStartMs`. Does NOT record the current request — the
   * caller records only if the request is allowed, so a blocked request never
   * consumes a slot or extends the window.
   */
  peek(companyId: string, windowStartMs: number): RateLimitUsage;
  /** Record one allowed export for the company at `nowMs`. */
  record(companyId: string, nowMs: number): void;
}

/**
 * In-memory sliding-window store. Best-effort and per-instance (see the module
 * doc) — a single `Map<companyId, number[]>` of ascending timestamps, pruned on
 * every access so it can't grow without bound.
 */
export function createInMemoryExportRateStore(): ExportRateStore {
  const hits = new Map<string, number[]>();

  function prune(companyId: string, windowStartMs: number): number[] {
    const all = hits.get(companyId);
    if (!all || all.length === 0) return [];
    // Timestamps are appended in time order, so the kept tail is contiguous.
    const kept = all.filter((ts) => ts >= windowStartMs);
    if (kept.length === 0) {
      hits.delete(companyId);
    } else if (kept.length !== all.length) {
      hits.set(companyId, kept);
    }
    return kept;
  }

  return {
    peek(companyId, windowStartMs) {
      const kept = prune(companyId, windowStartMs);
      return { count: kept.length, oldest: isoOrNull(kept[0]) };
    },
    record(companyId, nowMs) {
      const existing = hits.get(companyId) ?? [];
      existing.push(nowMs);
      hits.set(companyId, existing);
    },
  };
}

function isoOrNull(ms: number | undefined): string | null {
  return ms === undefined ? null : new Date(ms).toISOString();
}

/**
 * Process-wide default store. Export routes share this instance so a company's
 * export rate is tracked across requests to either export endpoint.
 */
export const inMemoryExportRateStore: ExportRateStore =
  createInMemoryExportRateStore();

export type ExportRateLimitResult =
  | { ok: true }
  | { ok: false; status: 429; error: string; rateLimit: RateLimitDecision };

export interface ExportRateLimitDeps {
  /** The authenticated session (the caller gates this on a non-null session). */
  session: SessionContext;
  /** Injected for deterministic reset/retry math in tests; defaults to now. */
  now?: Date;
  /** Injected store; defaults to the process-wide in-memory one. */
  store?: ExportRateStore;
}

/**
 * Decide whether an export may run for the session's company and, if so, record
 * it against the window. The current request is not counted until it is allowed,
 * so `count < limit` admits it (a company at the limit is blocked) — identical
 * semantics to the review limiter. Pure given the injected `store`/`now`.
 */
export function checkExportRateLimit(
  deps: ExportRateLimitDeps,
): ExportRateLimitResult {
  const now = deps.now ?? new Date();
  const store = deps.store ?? inMemoryExportRateStore;
  const policy = resolveExportRateLimitPolicy(deps.session.company.plan_tier);
  const windowStartMs = now.getTime() - policy.windowMs;

  const usage = store.peek(deps.session.companyId, windowStartMs);
  const decision = evaluateRateLimit(policy, usage, now);
  if (!decision.allowed) {
    return {
      ok: false,
      status: 429,
      error: exportRateLimitMessage(decision),
      rateLimit: decision,
    };
  }

  store.record(deps.session.companyId, now.getTime());
  return { ok: true };
}

/**
 * Plain-language, actionable 429 message (Rules.md §6). Names the limit and,
 * when known, when the caller can try again — never leaks internal detail. The
 * window wording tracks `EXPORT_RATE_LIMITS` (one hour).
 */
export function exportRateLimitMessage(decision: RateLimitDecision): string {
  const base = `You've reached your plan's export limit (${decision.limit} per hour).`;
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

/**
 * Standard rate-limit response headers for a decision (Rules.md §6 — surface the
 * limit + reset info). Returned as a plain record so the framework-agnostic lib
 * stays free of `next/server`; the route spreads it into the response.
 */
export function exportRateLimitHeaders(
  decision: RateLimitDecision,
): Record<string, string> {
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(decision.limit),
    "X-RateLimit-Remaining": String(decision.remaining),
  };
  if (decision.resetAt) headers["X-RateLimit-Reset"] = decision.resetAt;
  if (decision.retryAfterSeconds !== null) {
    headers["Retry-After"] = String(decision.retryAfterSeconds);
  }
  return headers;
}
