/**
 * Generic in-memory sliding-window usage store (DailyPlan Day 47 — Week 7 abuse
 * protections; extracted so every limiter that can't count persisted rows shares
 * ONE implementation — Rules.md §7 "consistency is credibility").
 *
 * Background: the review limiter (Day 17) counts persisted rows in the `reviews`
 * table, so its window is authoritative and durable. The export limiter (Day 40)
 * and the read limiter (Day 47) guard endpoints that persist nothing to count, so
 * they track usage in a lightweight per-key rolling window instead. Day 40 first
 * grew this store inside `export-access.ts`; Day 47 lifts it out verbatim so the
 * export and read limiters are provably the same mechanism (the abuse audit pins
 * that they share this module) rather than two drifting copies.
 *
 * It is **best-effort**: per-process and in-memory, so it resets on a cold start
 * and only throttles a burst against one running instance — it is not a hard
 * global quota. A durable backend (Redis / a Postgres events table) is the
 * production upgrade, a one-line swap because callers depend only on the
 * `SlidingWindowStore` interface. See the Blocked/needs-infra note in the PR.
 */
import type { RateLimitUsage } from "@/lib/rate-limit";

/**
 * Per-key usage store. Records the timestamps (ms) of allowed events and reports
 * usage within a rolling window. Injected into the limiters so the decision logic
 * stays testable without shared global state, and so a durable backend can
 * replace the default in-memory one without touching routes.
 */
export interface SlidingWindowStore {
  /**
   * Prior allowed events for `key` within [`windowStartMs`, now]. Prunes entries
   * older than `windowStartMs`. Does NOT record the current request — the caller
   * records only if the request is allowed, so a blocked request never consumes a
   * slot or extends the window. `oldest` is the ISO timestamp of the earliest
   * in-window event (or null), which feeds `evaluateRateLimit`'s reset math.
   */
  peek(key: string, windowStartMs: number): RateLimitUsage;
  /** Record one allowed event for `key` at `nowMs`. */
  record(key: string, nowMs: number): void;
}

/**
 * In-memory sliding-window store (see the module doc for the best-effort
 * caveat) — a single `Map<key, number[]>` of ascending timestamps, pruned on
 * every access so it can't grow without bound.
 */
export function createInMemorySlidingWindowStore(): SlidingWindowStore {
  const hits = new Map<string, number[]>();

  function prune(key: string, windowStartMs: number): number[] {
    const all = hits.get(key);
    if (!all || all.length === 0) return [];
    // Timestamps are appended in time order, so the kept tail is contiguous.
    const kept = all.filter((ts) => ts >= windowStartMs);
    if (kept.length === 0) {
      hits.delete(key);
    } else if (kept.length !== all.length) {
      hits.set(key, kept);
    }
    return kept;
  }

  return {
    peek(key, windowStartMs) {
      const kept = prune(key, windowStartMs);
      return { count: kept.length, oldest: isoOrNull(kept[0]) };
    },
    record(key, nowMs) {
      const existing = hits.get(key) ?? [];
      existing.push(nowMs);
      hits.set(key, existing);
    },
  };
}

function isoOrNull(ms: number | undefined): string | null {
  return ms === undefined ? null : new Date(ms).toISOString();
}
