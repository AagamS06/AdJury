import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionContext } from "@/lib/auth/session";
import { getReviewRateUsage, type InsertReviewParams } from "@/lib/db/queries";
import {
  DAY_MS,
  PLAN_RATE_LIMITS,
  evaluateRateLimit,
  rateLimitMessage,
  rateLimitWindowStart,
  resolveRateLimitPolicy,
} from "@/lib/rate-limit";
import { createReview } from "@/lib/reviews/create-review";
import type { PlanTier, ReviewWithScores } from "@/types/db";

/**
 * Per-plan rate limiting (DailyPlan Day 17).
 *
 * Three layers are proven here:
 *  1. The pure policy + decision logic (`resolveRateLimitPolicy`,
 *     `rateLimitWindowStart`, `evaluateRateLimit`, `rateLimitMessage`) — allow
 *     vs. block, reset math, plan fallback, message shape.
 *  2. `createReview` enforces the limit BEFORE running the jurors: an over-limit
 *     company gets a 429 with reset info and never persists; a usage-read
 *     failure fails open.
 *  3. The `getReviewRateUsage` DB helper applies the company_id + window filter
 *     and reads count + oldest in one query (a chainable Supabase fake).
 */

// ── pure policy + decision logic ──────────────────────────────────────────

describe("resolveRateLimitPolicy", () => {
  it("returns the plan's policy for each known tier", () => {
    expect(resolveRateLimitPolicy("free")).toEqual(PLAN_RATE_LIMITS.free);
    expect(resolveRateLimitPolicy("pro")).toEqual(PLAN_RATE_LIMITS.pro);
    expect(resolveRateLimitPolicy("enterprise")).toEqual(
      PLAN_RATE_LIMITS.enterprise,
    );
  });

  it("falls back to the most restrictive (free) for an unknown/missing plan", () => {
    expect(resolveRateLimitPolicy(null)).toEqual(PLAN_RATE_LIMITS.free);
    expect(resolveRateLimitPolicy(undefined)).toEqual(PLAN_RATE_LIMITS.free);
    expect(resolveRateLimitPolicy("legacy" as PlanTier)).toEqual(
      PLAN_RATE_LIMITS.free,
    );
  });

  it("keeps limits ordered free < pro < enterprise", () => {
    expect(PLAN_RATE_LIMITS.free.limit).toBeLessThan(PLAN_RATE_LIMITS.pro.limit);
    expect(PLAN_RATE_LIMITS.pro.limit).toBeLessThan(
      PLAN_RATE_LIMITS.enterprise.limit,
    );
  });
});

describe("rateLimitWindowStart", () => {
  it("is now minus the window length", () => {
    const now = new Date("2026-09-13T12:00:00.000Z");
    const start = rateLimitWindowStart(PLAN_RATE_LIMITS.free, now);
    expect(now.getTime() - start.getTime()).toBe(DAY_MS);
  });
});

describe("evaluateRateLimit", () => {
  const policy = { limit: 3, windowMs: DAY_MS };
  const now = new Date("2026-09-13T12:00:00.000Z");

  it("allows a request below the limit and reports remaining slots", () => {
    const d = evaluateRateLimit(policy, { count: 1, oldest: null }, now);
    expect(d.allowed).toBe(true);
    expect(d.limit).toBe(3);
    expect(d.remaining).toBe(2);
    expect(d.retryAfterSeconds).toBeNull();
  });

  it("blocks at exactly the limit (the pending review is not yet counted)", () => {
    const oldest = new Date(now.getTime() - DAY_MS / 2).toISOString();
    const d = evaluateRateLimit(policy, { count: 3, oldest }, now);
    expect(d.allowed).toBe(false);
    expect(d.remaining).toBe(0);
  });

  it("blocks over the limit and clamps remaining at 0", () => {
    const d = evaluateRateLimit(policy, { count: 9, oldest: null }, now);
    expect(d.allowed).toBe(false);
    expect(d.remaining).toBe(0);
  });

  it("resets when the oldest counted review ages out of the window", () => {
    const oldest = new Date(now.getTime() - DAY_MS / 2).toISOString();
    const d = evaluateRateLimit(policy, { count: 3, oldest }, now);
    // oldest + windowMs is half a window from now.
    expect(d.resetAt).toBe(new Date(Date.parse(oldest) + DAY_MS).toISOString());
    expect(d.retryAfterSeconds).toBe(Math.ceil(DAY_MS / 2 / 1000));
  });

  it("still gives a non-null reset hint when blocked with no oldest timestamp", () => {
    const d = evaluateRateLimit(policy, { count: 5, oldest: null }, now);
    expect(d.resetAt).toBe(new Date(now.getTime() + DAY_MS).toISOString());
    expect(d.retryAfterSeconds).toBe(Math.ceil(DAY_MS / 1000));
  });

  it("reports a reset for an allowed request but no retry-after", () => {
    const oldest = new Date(now.getTime() - 1000).toISOString();
    const d = evaluateRateLimit(policy, { count: 1, oldest }, now);
    expect(d.allowed).toBe(true);
    expect(d.resetAt).not.toBeNull();
    expect(d.retryAfterSeconds).toBeNull();
  });

  it("floors a fractional/negative count safely", () => {
    expect(evaluateRateLimit(policy, { count: -4, oldest: null }, now).remaining).toBe(3);
    expect(evaluateRateLimit(policy, { count: 2.9, oldest: null }, now).allowed).toBe(true);
  });
});

describe("rateLimitMessage", () => {
  it("names the limit and a minute-scale retry window", () => {
    const msg = rateLimitMessage({
      allowed: false,
      limit: 10,
      remaining: 0,
      resetAt: "2026-09-13T13:00:00.000Z",
      retryAfterSeconds: 120,
    });
    expect(msg).toContain("10 per 24 hours");
    expect(msg).toContain("2 minute");
    expect(msg).toContain("upgrade");
  });

  it("still reads sensibly with no retry-after", () => {
    const msg = rateLimitMessage({
      allowed: false,
      limit: 10,
      remaining: 0,
      resetAt: null,
      retryAfterSeconds: null,
    });
    expect(msg).toContain("10 per 24 hours");
    expect(msg).toContain("try again later");
  });
});

// ── createReview enforcement ──────────────────────────────────────────────

function sessionFor(plan: PlanTier): SessionContext {
  return {
    authUserId: "11111111-1111-1111-1111-111111111111",
    email: "admin@acme.test",
    companyId: "22222222-2222-2222-2222-222222222222",
    role: "admin",
    company: {
      id: "22222222-2222-2222-2222-222222222222",
      name: "Acme",
      industry: null,
      plan_tier: plan,
      juror_weights: null,
      created_at: "2026-08-31T00:00:00.000Z",
    },
  };
}

function recordingPersist() {
  const calls: InsertReviewParams[] = [];
  const persist = async (params: InsertReviewParams): Promise<ReviewWithScores> => {
    calls.push(params);
    return {
      review: {
        id: params.review.review_id,
        company_id: params.companyId,
        submitted_by: params.submittedBy,
        content_text: params.content_text,
        content_type: params.review.content_type as never,
        platform: params.review.platform,
        aggregate_score: params.review.aggregate_score,
        verdict: params.review.verdict,
        created_at: "2026-09-13T00:00:00.000Z",
      },
      scores: [],
    };
  };
  return { calls, persist };
}

const VALID_BODY = {
  content_text: "A concise, on-brand promo for our new productivity app.",
  content_type: "ad_copy",
  platform: "instagram",
};

describe("createReview rate limiting", () => {
  it("blocks with 429 (and never persists) when the company is at its plan limit", async () => {
    const { calls, persist } = recordingPersist();
    const oldest = new Date(Date.now() - DAY_MS / 2).toISOString();
    const getRateUsage = vi.fn(async () => ({
      count: PLAN_RATE_LIMITS.free.limit,
      oldest,
    }));

    const result = await createReview(VALID_BODY, {
      session: sessionFor("free"),
      persist,
      getRateUsage,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected block");
    expect(result.status).toBe(429);
    if (result.status !== 429) throw new Error("expected 429");
    expect(result.rateLimit.remaining).toBe(0);
    expect(result.rateLimit.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.error).toContain("review limit");
    // The five-juror fan-out and the write are both skipped when over limit.
    expect(calls).toHaveLength(0);
  });

  it("queries usage with the company's own id and the window start", async () => {
    const { persist } = recordingPersist();
    const getRateUsage = vi.fn(
      async (_companyId: string, _sinceIso: string) => ({
        count: 0,
        oldest: null as string | null,
      }),
    );
    const session = sessionFor("pro");

    await createReview(VALID_BODY, { session, persist, getRateUsage });

    expect(getRateUsage).toHaveBeenCalledTimes(1);
    const [companyId, sinceIso] = getRateUsage.mock.calls[0]!;
    expect(companyId).toBe(session.companyId);
    // The window start is ~24h before now.
    const delta = Date.now() - Date.parse(sinceIso);
    expect(delta).toBeGreaterThanOrEqual(DAY_MS - 5_000);
    expect(delta).toBeLessThanOrEqual(DAY_MS + 5_000);
  });

  it("allows and persists when the company is under its plan limit", async () => {
    const { calls, persist } = recordingPersist();
    const getRateUsage = vi.fn(async () => ({ count: 2, oldest: null }));

    const result = await createReview(VALID_BODY, {
      session: sessionFor("free"),
      persist,
      getRateUsage,
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("fails open (allows the review) when the usage read throws", async () => {
    const { calls, persist } = recordingPersist();
    const getRateUsage = vi.fn(async () => {
      throw new Error("db.getReviewRateUsage failed [XX000]: boom");
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await createReview(VALID_BODY, {
      session: sessionFor("free"),
      persist,
      getRateUsage,
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    spy.mockRestore();
  });

  it("does not enforce a limit when no usage reader is injected (back-compat)", async () => {
    const { calls, persist } = recordingPersist();
    const result = await createReview(VALID_BODY, {
      session: sessionFor("free"),
      persist,
    });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

// ── getReviewRateUsage DB helper ──────────────────────────────────────────

/** A chainable Supabase fake recording the filters and returning count + rows. */
function fakeUsageClient(result: {
  count: number;
  rows: { created_at: string }[];
  error?: { message: string; code?: string } | null;
}) {
  const recorded: {
    table?: string;
    selectCount?: unknown;
    filters: Record<string, unknown>;
    gte?: [string, unknown];
    ordered?: boolean;
    limit?: number;
  } = { filters: {} };

  const builder = {
    select(_cols: string, opts?: unknown) {
      recorded.selectCount = opts;
      return builder;
    },
    eq(col: string, val: unknown) {
      recorded.filters[col] = val;
      return builder;
    },
    gte(col: string, val: unknown) {
      recorded.gte = [col, val];
      return builder;
    },
    order() {
      recorded.ordered = true;
      return builder;
    },
    limit(n: number) {
      recorded.limit = n;
      return Promise.resolve({
        data: result.rows,
        error: result.error ?? null,
        count: result.count,
      });
    },
  };

  const db = {
    from(table: string) {
      recorded.table = table;
      return builder;
    },
  } as unknown as SupabaseClient;

  return { db, recorded };
}

describe("getReviewRateUsage", () => {
  it("filters by company_id and the window, and returns count + oldest", async () => {
    const { db, recorded } = fakeUsageClient({
      count: 7,
      rows: [{ created_at: "2026-09-13T06:00:00.000Z" }],
    });

    const usage = await getReviewRateUsage(
      db,
      "company-A",
      "2026-09-12T12:00:00.000Z",
    );

    expect(usage).toEqual({ count: 7, oldest: "2026-09-13T06:00:00.000Z" });
    expect(recorded.table).toBe("reviews");
    expect(recorded.filters.company_id).toBe("company-A");
    expect(recorded.gte).toEqual(["created_at", "2026-09-12T12:00:00.000Z"]);
    expect(recorded.selectCount).toMatchObject({ count: "exact" });
    expect(recorded.ordered).toBe(true);
    expect(recorded.limit).toBe(1);
  });

  it("reports zero usage and null oldest for a company with no reviews", async () => {
    const { db } = fakeUsageClient({ count: 0, rows: [] });
    const usage = await getReviewRateUsage(db, "company-B", "2026-09-12T12:00:00.000Z");
    expect(usage).toEqual({ count: 0, oldest: null });
  });

  it("throws with operation context (no PII) when the query errors", async () => {
    const { db } = fakeUsageClient({
      count: 0,
      rows: [],
      error: { message: "connection reset", code: "XX000" },
    });
    await expect(
      getReviewRateUsage(db, "company-C", "2026-09-12T12:00:00.000Z"),
    ).rejects.toThrow(/getReviewRateUsage/);
  });
});
