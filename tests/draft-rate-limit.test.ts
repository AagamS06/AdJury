import { describe, it, expect } from "vitest";
import type { SessionContext } from "@/lib/auth/session";
import { DAY_MS } from "@/lib/rate-limit";
import {
  checkDraftRateLimit,
  createInMemoryDraftRateStore,
  DRAFT_RATE_LIMITS,
  draftRateLimitHeaders,
  draftRateLimitMessage,
  resolveDraftRateLimitPolicy,
  type DraftRateStore,
} from "@/lib/draft/draft-rate-limit";
import type { CompanyRow, PlanTier } from "@/types/db";

/**
 * Draft-generation rate limiting (DailyPlan Day 90 — Week 13 buffer: the per-plan
 * draft limiter Day 89 flagged as a reviewed follow-up). The draft limiter
 * mirrors the export/read limiters over the SAME shared primitives (the generic
 * `SlidingWindowStore` + `evaluateRateLimit`), so the reset/retry math is already
 * covered by `rate-limit.test.ts` and the store behaviour by
 * `export-access.test.ts`. This suite pins the draft-specific policy (a daily
 * AI-cost window), the plan fallback, and the orchestration — block at the limit,
 * blocked-doesn't-consume-a-slot, per-company isolation, per-tier allowance —
 * plus the message/headers.
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

/** Exhaust a company's window by recording `n` allowed drafts at `at`. */
function fill(store: DraftRateStore, companyId: string, n: number, at: number) {
  for (let i = 0; i < n; i += 1) store.record(companyId, at);
}

describe("resolveDraftRateLimitPolicy", () => {
  it("returns the per-plan policy for a known tier", () => {
    expect(resolveDraftRateLimitPolicy("free")).toEqual(DRAFT_RATE_LIMITS.free);
    expect(resolveDraftRateLimitPolicy("pro")).toEqual(DRAFT_RATE_LIMITS.pro);
    expect(resolveDraftRateLimitPolicy("enterprise")).toEqual(
      DRAFT_RATE_LIMITS.enterprise,
    );
  });

  it("fails closed to the most restrictive (free) for unknown/missing tiers", () => {
    expect(resolveDraftRateLimitPolicy(null)).toEqual(DRAFT_RATE_LIMITS.free);
    expect(resolveDraftRateLimitPolicy(undefined)).toEqual(DRAFT_RATE_LIMITS.free);
    expect(resolveDraftRateLimitPolicy("legacy" as PlanTier)).toEqual(
      DRAFT_RATE_LIMITS.free,
    );
  });

  it("uses a daily window with free < pro < enterprise ceilings", () => {
    expect(DRAFT_RATE_LIMITS.free.windowMs).toBe(DAY_MS);
    expect(DRAFT_RATE_LIMITS.free.limit).toBeLessThan(DRAFT_RATE_LIMITS.pro.limit);
    expect(DRAFT_RATE_LIMITS.pro.limit).toBeLessThan(
      DRAFT_RATE_LIMITS.enterprise.limit,
    );
  });
});

describe("checkDraftRateLimit", () => {
  const now = new Date("2026-11-27T12:00:00.000Z");

  it("allows a draft under the limit and records it", () => {
    const store = createInMemoryDraftRateStore();
    const session = makeSession("co-a", "free");

    const result = checkDraftRateLimit({ session, now, store });

    expect(result.ok).toBe(true);
    expect(store.peek("co-a", now.getTime() - DAY_MS).count).toBe(1);
  });

  it("blocks once the window is full and returns a 429 decision with reset info", () => {
    const store = createInMemoryDraftRateStore();
    const session = makeSession("co-a", "free");
    const limit = DRAFT_RATE_LIMITS.free.limit;

    fill(store, "co-a", limit, now.getTime() - 60 * 60 * 1000); // 1h ago, in window

    const result = checkDraftRateLimit({ session, now, store });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected blocked");
    expect(result.status).toBe(429);
    expect(result.rateLimit.limit).toBe(limit);
    expect(result.rateLimit.remaining).toBe(0);
    expect(result.rateLimit.resetAt).not.toBeNull();
    expect(result.rateLimit.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.error).toContain(String(limit));
    expect(result.error).toContain("per 24 hours");
  });

  it("does not consume a slot when blocked (window only holds allowed drafts)", () => {
    const store = createInMemoryDraftRateStore();
    const session = makeSession("co-a", "free");
    const limit = DRAFT_RATE_LIMITS.free.limit;
    const filledAt = now.getTime() - 2 * 60 * 60 * 1000; // 2h ago, still in window

    fill(store, "co-a", limit, filledAt);

    const blocked = checkDraftRateLimit({ session, now, store });
    expect(blocked.ok).toBe(false);
    expect(store.peek("co-a", now.getTime() - DAY_MS).count).toBe(limit);

    // Once the original hits age out, the block did not extend the window.
    const later = new Date(filledAt + DAY_MS + 1000);
    const afterReset = checkDraftRateLimit({ session, now: later, store });
    expect(afterReset.ok).toBe(true);
  });

  it("prunes drafts that have aged out of the rolling window", () => {
    const store = createInMemoryDraftRateStore();
    const session = makeSession("co-a", "free");

    // One hit two days ago — outside a one-day window.
    store.record("co-a", now.getTime() - 2 * DAY_MS);
    expect(store.peek("co-a", now.getTime() - DAY_MS).count).toBe(0);

    const result = checkDraftRateLimit({ session, now, store });
    expect(result.ok).toBe(true);
    expect(store.peek("co-a", now.getTime() - DAY_MS).count).toBe(1);
  });

  it("isolates usage per company (one tenant's drafts never limit another)", () => {
    const store = createInMemoryDraftRateStore();
    const limit = DRAFT_RATE_LIMITS.free.limit;

    fill(store, "co-a", limit, now.getTime() - 60 * 1000);
    const a = checkDraftRateLimit({ session: makeSession("co-a", "free"), now, store });
    expect(a.ok).toBe(false);

    const b = checkDraftRateLimit({ session: makeSession("co-b", "free"), now, store });
    expect(b.ok).toBe(true);
  });

  it("gives a higher-tier company a larger allowance from the same store", () => {
    const store = createInMemoryDraftRateStore();
    const freeLimit = DRAFT_RATE_LIMITS.free.limit;

    fill(store, "co-pro", freeLimit, now.getTime() - 60 * 1000);
    const pro = checkDraftRateLimit({ session: makeSession("co-pro", "pro"), now, store });
    expect(pro.ok).toBe(true);
  });
});

describe("draftRateLimitMessage", () => {
  it("names the limit and a retry hint when a reset is known", () => {
    const msg = draftRateLimitMessage({
      allowed: false,
      limit: 20,
      remaining: 0,
      resetAt: "2026-11-28T12:00:00.000Z",
      retryAfterSeconds: 3600,
    });
    expect(msg).toContain("20 per 24 hours");
    expect(msg).toContain("hour(s)");
    expect(msg).toContain("upgrade");
  });

  it("falls back to a generic retry when no reset is known", () => {
    const msg = draftRateLimitMessage({
      allowed: false,
      limit: 20,
      remaining: 0,
      resetAt: null,
      retryAfterSeconds: null,
    });
    expect(msg).toContain("20 per 24 hours");
    expect(msg).toContain("try again later");
  });
});

describe("draftRateLimitHeaders", () => {
  it("emits limit/remaining and, when present, reset + retry-after", () => {
    const headers = draftRateLimitHeaders({
      allowed: false,
      limit: 20,
      remaining: 0,
      resetAt: "2026-11-28T12:00:00.000Z",
      retryAfterSeconds: 3600,
    });
    expect(headers["X-RateLimit-Limit"]).toBe("20");
    expect(headers["X-RateLimit-Remaining"]).toBe("0");
    expect(headers["X-RateLimit-Reset"]).toBe("2026-11-28T12:00:00.000Z");
    expect(headers["Retry-After"]).toBe("3600");
  });

  it("omits reset/retry-after headers when the decision has none", () => {
    const headers = draftRateLimitHeaders({
      allowed: true,
      limit: 20,
      remaining: 19,
      resetAt: null,
      retryAfterSeconds: null,
    });
    expect(headers["X-RateLimit-Limit"]).toBe("20");
    expect(headers["X-RateLimit-Remaining"]).toBe("19");
    expect(headers).not.toHaveProperty("X-RateLimit-Reset");
    expect(headers).not.toHaveProperty("Retry-After");
  });
});
