import { describe, it, expect } from "vitest";
import type { SessionContext } from "@/lib/auth/session";
import {
  checkExportRateLimit,
  createInMemoryExportRateStore,
  EXPORT_RATE_LIMITS,
  exportRateLimitHeaders,
  exportRateLimitMessage,
  HOUR_MS,
  resolveExportRateLimitPolicy,
  type ExportRateStore,
} from "@/lib/reviews/export-access";
import type { CompanyRow, PlanTier } from "@/types/db";

/**
 * Export authz + rate limiting (DailyPlan Day 40 — "Export authz": tenancy/auth
 * checks + rate-limit exports). The tenancy/auth of the two export routes is
 * already proven by the Day 6 read-core tests (`reviews-read.test.ts`: 401
 * unauth, 404-not-403 cross-tenant), which export mirrors — so this suite pins
 * the new piece: the per-plan export rate limiter. The underlying reset/retry
 * math is `evaluateRateLimit` (already covered by `rate-limit.test.ts`); here we
 * pin the export policy, the sliding-window store, and the orchestration — that
 * a blocked request never consumes a slot and companies are isolated.
 */

function makeSession(
  companyId: string,
  plan: PlanTier,
): SessionContext {
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

/** Exhaust a company's window by recording `n` allowed exports at `at`. */
function fill(store: ExportRateStore, companyId: string, n: number, at: number) {
  for (let i = 0; i < n; i += 1) store.record(companyId, at);
}

describe("resolveExportRateLimitPolicy", () => {
  it("returns the per-plan policy for a known tier", () => {
    expect(resolveExportRateLimitPolicy("free")).toEqual(EXPORT_RATE_LIMITS.free);
    expect(resolveExportRateLimitPolicy("pro")).toEqual(EXPORT_RATE_LIMITS.pro);
    expect(resolveExportRateLimitPolicy("enterprise")).toEqual(
      EXPORT_RATE_LIMITS.enterprise,
    );
  });

  it("fails closed to the most restrictive (free) for unknown/missing tiers", () => {
    expect(resolveExportRateLimitPolicy(null)).toEqual(EXPORT_RATE_LIMITS.free);
    expect(resolveExportRateLimitPolicy(undefined)).toEqual(EXPORT_RATE_LIMITS.free);
    expect(resolveExportRateLimitPolicy("legacy" as PlanTier)).toEqual(
      EXPORT_RATE_LIMITS.free,
    );
  });

  it("uses a one-hour window with free < pro < enterprise ceilings", () => {
    expect(EXPORT_RATE_LIMITS.free.windowMs).toBe(HOUR_MS);
    expect(EXPORT_RATE_LIMITS.free.limit).toBeLessThan(EXPORT_RATE_LIMITS.pro.limit);
    expect(EXPORT_RATE_LIMITS.pro.limit).toBeLessThan(
      EXPORT_RATE_LIMITS.enterprise.limit,
    );
  });
});

describe("checkExportRateLimit", () => {
  const now = new Date("2026-10-07T12:00:00.000Z");

  it("allows an export under the limit and records it", () => {
    const store = createInMemoryExportRateStore();
    const session = makeSession("co-a", "free");

    const result = checkExportRateLimit({ session, now, store });

    expect(result.ok).toBe(true);
    // The allowed export was recorded: the window now shows one hit.
    const usage = store.peek("co-a", now.getTime() - HOUR_MS);
    expect(usage.count).toBe(1);
  });

  it("blocks once the window is full and returns a 429 decision with reset info", () => {
    const store = createInMemoryExportRateStore();
    const session = makeSession("co-a", "free");
    const limit = EXPORT_RATE_LIMITS.free.limit;

    // Fill the window to exactly the limit, oldest first.
    fill(store, "co-a", limit, now.getTime() - 5 * 60 * 1000);

    const result = checkExportRateLimit({ session, now, store });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected blocked");
    expect(result.status).toBe(429);
    expect(result.rateLimit.limit).toBe(limit);
    expect(result.rateLimit.remaining).toBe(0);
    expect(result.rateLimit.resetAt).not.toBeNull();
    expect(result.rateLimit.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.error).toContain(String(limit));
  });

  it("does not consume a slot when blocked (window only holds allowed exports)", () => {
    const store = createInMemoryExportRateStore();
    const session = makeSession("co-a", "free");
    const limit = EXPORT_RATE_LIMITS.free.limit;
    const filledAt = now.getTime() - 50 * 60 * 1000; // 50 min ago, still in window

    fill(store, "co-a", limit, filledAt);

    // A blocked attempt must not append a hit...
    const blocked = checkExportRateLimit({ session, now, store });
    expect(blocked.ok).toBe(false);
    expect(store.peek("co-a", now.getTime() - HOUR_MS).count).toBe(limit);

    // ...so once the original hits age out, the company is allowed again
    // (the block did not extend the window past `filledAt + windowMs`).
    const later = new Date(filledAt + HOUR_MS + 1000);
    const afterReset = checkExportRateLimit({ session, now: later, store });
    expect(afterReset.ok).toBe(true);
  });

  it("prunes exports that have aged out of the rolling window", () => {
    const store = createInMemoryExportRateStore();
    const session = makeSession("co-a", "free");

    // One hit two hours ago — outside a one-hour window.
    store.record("co-a", now.getTime() - 2 * HOUR_MS);
    expect(store.peek("co-a", now.getTime() - HOUR_MS).count).toBe(0);

    // A fresh export is therefore allowed and counts as the only in-window hit.
    const result = checkExportRateLimit({ session, now, store });
    expect(result.ok).toBe(true);
    expect(store.peek("co-a", now.getTime() - HOUR_MS).count).toBe(1);
  });

  it("isolates usage per company (one tenant's exports never limit another)", () => {
    const store = createInMemoryExportRateStore();
    const limit = EXPORT_RATE_LIMITS.free.limit;

    // Company A is maxed out...
    fill(store, "co-a", limit, now.getTime() - 60 * 1000);
    const a = checkExportRateLimit({ session: makeSession("co-a", "free"), now, store });
    expect(a.ok).toBe(false);

    // ...but company B is untouched.
    const b = checkExportRateLimit({ session: makeSession("co-b", "free"), now, store });
    expect(b.ok).toBe(true);
  });

  it("gives a higher-tier company a larger allowance from the same store", () => {
    const store = createInMemoryExportRateStore();
    const freeLimit = EXPORT_RATE_LIMITS.free.limit;

    // `freeLimit` exports in the window blocks a free company but not a pro one.
    fill(store, "co-pro", freeLimit, now.getTime() - 60 * 1000);
    const pro = checkExportRateLimit({ session: makeSession("co-pro", "pro"), now, store });
    expect(pro.ok).toBe(true);
  });
});

describe("exportRateLimitMessage", () => {
  it("names the limit and a retry hint when a reset is known", () => {
    const msg = exportRateLimitMessage({
      allowed: false,
      limit: 60,
      remaining: 0,
      resetAt: "2026-10-07T13:00:00.000Z",
      retryAfterSeconds: 1800,
    });
    expect(msg).toContain("60 per hour");
    expect(msg).toContain("30 minute(s)");
    expect(msg).toContain("upgrade");
  });

  it("falls back to a generic retry when no reset is known", () => {
    const msg = exportRateLimitMessage({
      allowed: false,
      limit: 60,
      remaining: 0,
      resetAt: null,
      retryAfterSeconds: null,
    });
    expect(msg).toContain("60 per hour");
    expect(msg).toContain("try again later");
  });
});

describe("exportRateLimitHeaders", () => {
  it("emits limit/remaining and, when present, reset + retry-after", () => {
    const headers = exportRateLimitHeaders({
      allowed: false,
      limit: 60,
      remaining: 0,
      resetAt: "2026-10-07T13:00:00.000Z",
      retryAfterSeconds: 1800,
    });
    expect(headers["X-RateLimit-Limit"]).toBe("60");
    expect(headers["X-RateLimit-Remaining"]).toBe("0");
    expect(headers["X-RateLimit-Reset"]).toBe("2026-10-07T13:00:00.000Z");
    expect(headers["Retry-After"]).toBe("1800");
  });

  it("omits reset/retry-after headers when the decision has none", () => {
    const headers = exportRateLimitHeaders({
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
