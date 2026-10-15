import { describe, it, expect } from "vitest";
import type { SessionContext } from "@/lib/auth/session";
import {
  checkReadRateLimit,
  createInMemoryReadRateStore,
  MINUTE_MS,
  READ_RATE_LIMITS,
  readRateLimitHeaders,
  readRateLimitMessage,
  resolveReadRateLimitPolicy,
  type ReadRateStore,
} from "@/lib/reviews/read-access";
import type { CompanyRow, PlanTier } from "@/types/db";

/**
 * Read rate limiting (DailyPlan Day 47 — Week 7 abuse protections). The read
 * limiter mirrors the export limiter (Day 40) over the SAME shared primitives
 * (the generic `SlidingWindowStore` + `evaluateRateLimit`), so the reset/retry
 * math is already covered by `rate-limit.test.ts` and the store behaviour by
 * `export-access.test.ts`. This suite pins the read-specific policy (a one-minute
 * burst window), the plan fallback, and the orchestration — block at the limit,
 * blocked-doesn't-consume-a-slot, per-company isolation — plus the message/headers.
 */

function makeSession(companyId: string, plan: PlanTier): SessionContext {
  const company: CompanyRow = {
    id: companyId,
    name: `Company ${companyId}`,
    industry: null,
    plan_tier: plan,
    juror_weights: null,
    onboarded_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
  };
  return {
    authUserId: `user-${companyId}`,
    email: `admin@${companyId}.example`,
    companyId,
    role: "admin",
    company,
  };
}

/** Exhaust a company's window by recording `n` allowed reads at `at`. */
function fill(store: ReadRateStore, companyId: string, n: number, at: number) {
  for (let i = 0; i < n; i += 1) store.record(companyId, at);
}

describe("resolveReadRateLimitPolicy", () => {
  it("returns the per-plan policy for a known tier", () => {
    expect(resolveReadRateLimitPolicy("free")).toEqual(READ_RATE_LIMITS.free);
    expect(resolveReadRateLimitPolicy("pro")).toEqual(READ_RATE_LIMITS.pro);
    expect(resolveReadRateLimitPolicy("enterprise")).toEqual(
      READ_RATE_LIMITS.enterprise,
    );
  });

  it("fails closed to the most restrictive (free) for unknown/missing tiers", () => {
    expect(resolveReadRateLimitPolicy(null)).toEqual(READ_RATE_LIMITS.free);
    expect(resolveReadRateLimitPolicy(undefined)).toEqual(READ_RATE_LIMITS.free);
    expect(resolveReadRateLimitPolicy("legacy" as PlanTier)).toEqual(
      READ_RATE_LIMITS.free,
    );
  });

  it("uses a one-minute window with free < pro < enterprise ceilings", () => {
    expect(READ_RATE_LIMITS.free.windowMs).toBe(MINUTE_MS);
    expect(READ_RATE_LIMITS.free.limit).toBeLessThan(READ_RATE_LIMITS.pro.limit);
    expect(READ_RATE_LIMITS.pro.limit).toBeLessThan(
      READ_RATE_LIMITS.enterprise.limit,
    );
  });
});

describe("checkReadRateLimit", () => {
  const now = new Date("2026-10-14T12:00:00.000Z");

  it("allows a read under the limit and records it", () => {
    const store = createInMemoryReadRateStore();
    const session = makeSession("co-a", "free");

    const result = checkReadRateLimit({ session, now, store });

    expect(result.ok).toBe(true);
    expect(store.peek("co-a", now.getTime() - MINUTE_MS).count).toBe(1);
  });

  it("blocks once the window is full and returns a 429 decision with reset info", () => {
    const store = createInMemoryReadRateStore();
    const session = makeSession("co-a", "free");
    const limit = READ_RATE_LIMITS.free.limit;

    fill(store, "co-a", limit, now.getTime() - 10 * 1000); // 10s ago, in window

    const result = checkReadRateLimit({ session, now, store });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected blocked");
    expect(result.status).toBe(429);
    expect(result.rateLimit.limit).toBe(limit);
    expect(result.rateLimit.remaining).toBe(0);
    expect(result.rateLimit.resetAt).not.toBeNull();
    expect(result.rateLimit.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.error).toContain(String(limit));
    expect(result.error).toContain("per minute");
  });

  it("does not consume a slot when blocked (window only holds allowed reads)", () => {
    const store = createInMemoryReadRateStore();
    const session = makeSession("co-a", "free");
    const limit = READ_RATE_LIMITS.free.limit;
    const filledAt = now.getTime() - 30 * 1000; // 30s ago, still in window

    fill(store, "co-a", limit, filledAt);

    const blocked = checkReadRateLimit({ session, now, store });
    expect(blocked.ok).toBe(false);
    expect(store.peek("co-a", now.getTime() - MINUTE_MS).count).toBe(limit);

    // Once the original hits age out, the block did not extend the window.
    const later = new Date(filledAt + MINUTE_MS + 1000);
    const afterReset = checkReadRateLimit({ session, now: later, store });
    expect(afterReset.ok).toBe(true);
  });

  it("prunes reads that have aged out of the rolling window", () => {
    const store = createInMemoryReadRateStore();
    const session = makeSession("co-a", "free");

    // One hit two minutes ago — outside a one-minute window.
    store.record("co-a", now.getTime() - 2 * MINUTE_MS);
    expect(store.peek("co-a", now.getTime() - MINUTE_MS).count).toBe(0);

    const result = checkReadRateLimit({ session, now, store });
    expect(result.ok).toBe(true);
    expect(store.peek("co-a", now.getTime() - MINUTE_MS).count).toBe(1);
  });

  it("isolates usage per company (one tenant's reads never limit another)", () => {
    const store = createInMemoryReadRateStore();
    const limit = READ_RATE_LIMITS.free.limit;

    fill(store, "co-a", limit, now.getTime() - 5 * 1000);
    const a = checkReadRateLimit({ session: makeSession("co-a", "free"), now, store });
    expect(a.ok).toBe(false);

    const b = checkReadRateLimit({ session: makeSession("co-b", "free"), now, store });
    expect(b.ok).toBe(true);
  });

  it("gives a higher-tier company a larger allowance from the same store", () => {
    const store = createInMemoryReadRateStore();
    const freeLimit = READ_RATE_LIMITS.free.limit;

    fill(store, "co-pro", freeLimit, now.getTime() - 5 * 1000);
    const pro = checkReadRateLimit({ session: makeSession("co-pro", "pro"), now, store });
    expect(pro.ok).toBe(true);
  });
});

describe("readRateLimitMessage", () => {
  it("names the limit and a retry hint when a reset is known", () => {
    const msg = readRateLimitMessage({
      allowed: false,
      limit: 60,
      remaining: 0,
      resetAt: "2026-10-14T12:01:00.000Z",
      retryAfterSeconds: 45,
    });
    expect(msg).toContain("60 per minute");
    expect(msg).toContain("1 minute(s)");
    expect(msg).toContain("upgrade");
  });

  it("falls back to a generic retry when no reset is known", () => {
    const msg = readRateLimitMessage({
      allowed: false,
      limit: 60,
      remaining: 0,
      resetAt: null,
      retryAfterSeconds: null,
    });
    expect(msg).toContain("60 per minute");
    expect(msg).toContain("try again later");
  });
});

describe("readRateLimitHeaders", () => {
  it("emits limit/remaining and, when present, reset + retry-after", () => {
    const headers = readRateLimitHeaders({
      allowed: false,
      limit: 60,
      remaining: 0,
      resetAt: "2026-10-14T12:01:00.000Z",
      retryAfterSeconds: 45,
    });
    expect(headers["X-RateLimit-Limit"]).toBe("60");
    expect(headers["X-RateLimit-Remaining"]).toBe("0");
    expect(headers["X-RateLimit-Reset"]).toBe("2026-10-14T12:01:00.000Z");
    expect(headers["Retry-After"]).toBe("45");
  });

  it("omits reset/retry-after headers when the decision has none", () => {
    const headers = readRateLimitHeaders({
      allowed: true,
      limit: 60,
      remaining: 59,
      resetAt: null,
      retryAfterSeconds: null,
    });
    expect(headers["X-RateLimit-Limit"]).toBe("60");
    expect(headers["X-RateLimit-Remaining"]).toBe("59");
    expect(headers).not.toHaveProperty("X-RateLimit-Reset");
    expect(headers).not.toHaveProperty("Retry-After");
  });
});
