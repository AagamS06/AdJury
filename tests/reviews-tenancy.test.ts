import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getReviewById,
  insertReviewWithScores,
  listReviewsByCompany,
} from "@/lib/db/queries";
import { getReviewForCompany } from "@/lib/reviews/read-reviews";
import { PERSONA_NAMES, type ReviewResult } from "@/lib/schema/juror";
import type { SessionContext } from "@/lib/auth/session";
import type {
  PersonaScoreRow,
  ReviewRow,
  ReviewWithScores,
} from "@/types/db";

/**
 * Multi-tenancy hardening (DailyPlan Day 7).
 *
 * Two layers are proved here:
 *  1. The data layer applies the `company_id` filter it is handed — a fake
 *     Supabase query builder records every `.eq()` so we can assert reads are
 *     scoped and the write rolls back its review row when the scores insert
 *     fails (Rules.md §5/§6, previously only covered via the injectable cores).
 *  2. End-to-end, one company cannot read another's review: the read core takes
 *     the company from the session and a mismatched company reads as 404 — never
 *     revealing cross-tenant existence.
 */

// ── a minimal, faithful fake of the Supabase query builder ────────────────

type QueryResult = { data: unknown; error: { message: string; code?: string } | null };

interface RecordedCall {
  table: string;
  op: "select" | "insert" | "delete";
  filters: Record<string, unknown>;
  ordered: boolean;
}

/**
 * Chainable stand-in for a PostgREST builder. Every method returns `this`
 * except the terminal `maybeSingle`/`single`; the object is also awaitable so
 * the direct-await terminals (`.limit()`, `insert().select()`, `delete().eq()`)
 * resolve too. A `resolve` callback inspects the recorded call and returns the
 * `{ data, error }` the real client would.
 */
class FakeBuilder implements PromiseLike<QueryResult> {
  op: RecordedCall["op"] = "select";
  filters: Record<string, unknown> = {};
  ordered = false;
  inserted: unknown = undefined;

  constructor(
    readonly table: string,
    private readonly resolve: (b: FakeBuilder) => QueryResult,
    private readonly record: (b: FakeBuilder) => void,
  ) {}

  select(): this {
    return this;
  }
  insert(values: unknown): this {
    this.op = "insert";
    this.inserted = values;
    return this;
  }
  delete(): this {
    this.op = "delete";
    return this;
  }
  eq(col: string, val: unknown): this {
    this.filters[col] = val;
    return this;
  }
  order(): this {
    this.ordered = true;
    return this;
  }
  limit(): this {
    return this;
  }
  maybeSingle(): Promise<QueryResult> {
    return this.settle();
  }
  single(): Promise<QueryResult> {
    return this.settle();
  }
  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?:
      | ((value: QueryResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.settle().then(onfulfilled, onrejected);
  }

  private settle(): Promise<QueryResult> {
    this.record(this);
    return Promise.resolve(this.resolve(this));
  }
}

function fakeDb(resolve: (b: FakeBuilder) => QueryResult) {
  const calls: RecordedCall[] = [];
  const record = (b: FakeBuilder) =>
    calls.push({ table: b.table, op: b.op, filters: b.filters, ordered: b.ordered });
  const db = {
    from: (table: string) => new FakeBuilder(table, resolve, record),
  } as unknown as SupabaseClient;
  return { db, calls };
}

// ── fixtures ──────────────────────────────────────────────────────────────

const COMPANY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const REVIEW_ID = "00000000-0000-0000-0000-000000000001";

function reviewRowFor(companyId: string): ReviewRow {
  return {
    id: REVIEW_ID,
    company_id: companyId,
    submitted_by: "11111111-1111-1111-1111-111111111111",
    content_text: "Introducing our new sleep supplement.",
    content_type: "ad_copy",
    platform: "instagram",
    aggregate_score: 7.2,
    verdict: "revise",
    created_at: "2026-09-01T00:00:00.000Z",
  };
}

// ── data layer: read scoping ──────────────────────────────────────────────

describe("getReviewById scoping", () => {
  it("filters by BOTH id and company_id when a companyId is supplied", async () => {
    const { db, calls } = fakeDb((b) => {
      if (b.table === "reviews") return { data: reviewRowFor(COMPANY_A), error: null };
      return { data: [], error: null }; // persona_scores
    });

    await getReviewById(db, REVIEW_ID, COMPANY_A);

    const reviewSelect = calls.find((c) => c.table === "reviews");
    expect(reviewSelect?.filters).toEqual({ id: REVIEW_ID, company_id: COMPANY_A });
  });

  it("omits the company_id filter when none is supplied (service-role caller must scope itself)", async () => {
    const { db, calls } = fakeDb((b) => {
      if (b.table === "reviews") return { data: reviewRowFor(COMPANY_A), error: null };
      return { data: [], error: null };
    });

    await getReviewById(db, REVIEW_ID);

    const reviewSelect = calls.find((c) => c.table === "reviews");
    expect(reviewSelect?.filters).toEqual({ id: REVIEW_ID });
    expect(reviewSelect?.filters).not.toHaveProperty("company_id");
  });

  it("returns null and never reads persona_scores when the scoped review is absent", async () => {
    // RLS or the company_id filter yields no row → the caller sees nothing.
    const { db, calls } = fakeDb((b) => {
      if (b.table === "reviews") return { data: null, error: null };
      throw new Error("persona_scores must not be queried when the review is absent");
    });

    const result = await getReviewById(db, REVIEW_ID, COMPANY_B);

    expect(result).toBeNull();
    expect(calls.some((c) => c.table === "persona_scores")).toBe(false);
  });
});

describe("listReviewsByCompany scoping", () => {
  it("filters by company_id and orders newest-first", async () => {
    const { db, calls } = fakeDb(() => ({ data: [reviewRowFor(COMPANY_A)], error: null }));

    await listReviewsByCompany(db, COMPANY_A, { limit: 10 });

    const listCall = calls.find((c) => c.table === "reviews");
    expect(listCall?.filters).toEqual({ company_id: COMPANY_A });
    expect(listCall?.ordered).toBe(true);
  });
});

// ── data layer: write rollback ────────────────────────────────────────────

function reviewResult(): ReviewResult {
  return {
    review_id: REVIEW_ID,
    content_type: "ad_copy",
    platform: "instagram",
    model: "mock",
    created_at: "2026-09-01T00:00:00.000Z",
    aggregate_score: 7.2,
    verdict: "revise",
    jurors: PERSONA_NAMES.map((persona) => ({
      persona,
      status: "ok" as const,
      score: 8,
      confidence: "high" as const,
      summary: "ok",
      issues: [],
      suggested_rewrite: "improved",
    })),
  };
}

describe("insertReviewWithScores rollback", () => {
  it("deletes the orphaned review row when the persona_scores insert fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, calls } = fakeDb((b) => {
      if (b.table === "reviews" && b.op === "insert") {
        return { data: reviewRowFor(COMPANY_A), error: null };
      }
      if (b.table === "persona_scores" && b.op === "insert") {
        return { data: null, error: { message: "boom", code: "XX000" } };
      }
      return { data: null, error: null }; // the rollback delete
    });

    await expect(
      insertReviewWithScores(db, {
        companyId: COMPANY_A,
        submittedBy: "11111111-1111-1111-1111-111111111111",
        content_text: "hello",
        review: reviewResult(),
      }),
    ).rejects.toThrow(/persona_scores|scores/i);

    // The review row must not survive without its scores (Rules.md §6).
    const rollback = calls.find((c) => c.table === "reviews" && c.op === "delete");
    expect(rollback).toBeDefined();
    expect(rollback?.filters).toEqual({ id: REVIEW_ID });
    spy.mockRestore();
  });

  it("persists the review and its scores on the happy path", async () => {
    const scoreRows: PersonaScoreRow[] = PERSONA_NAMES.map((persona, i) => ({
      id: `score-${i}`,
      review_id: REVIEW_ID,
      persona_name: persona,
      score: 8,
      confidence: "high",
      feedback_text: "ok",
      issues_json: [],
      suggested_rewrite: "improved",
      status: "ok",
    }));
    const { db, calls } = fakeDb((b) => {
      if (b.table === "reviews") return { data: reviewRowFor(COMPANY_A), error: null };
      return { data: scoreRows, error: null };
    });

    const out = await insertReviewWithScores(db, {
      companyId: COMPANY_A,
      submittedBy: "11111111-1111-1111-1111-111111111111",
      content_text: "hello",
      review: reviewResult(),
    });

    expect(out.review.id).toBe(REVIEW_ID);
    expect(out.scores).toHaveLength(PERSONA_NAMES.length);
    // No rollback delete on success.
    expect(calls.some((c) => c.op === "delete")).toBe(false);
  });
});

// ── end-to-end: cross-tenant isolation through the read core ──────────────

function sessionFor(companyId: string): SessionContext {
  return {
    authUserId: "11111111-1111-1111-1111-111111111111",
    email: "user@example.test",
    companyId,
    role: "member",
    company: {
      id: companyId,
      name: "Co",
      industry: null,
      plan_tier: "free",
      created_at: "2026-08-31T00:00:00.000Z",
    },
  };
}

describe("cross-tenant isolation (GET /api/reviews/[id])", () => {
  // A store where the review belongs to company A. The fetch mirrors the real
  // scoped query: it only returns the row when the caller's company matches.
  const scopedFetch = async (
    id: string,
    companyId: string,
  ): Promise<ReviewWithScores | null> => {
    const row = reviewRowFor(COMPANY_A);
    if (id !== row.id || companyId !== row.company_id) return null;
    return { review: row, scores: [] };
  };

  it("lets the owning company read its own review (200)", async () => {
    const result = await getReviewForCompany(REVIEW_ID, {
      session: sessionFor(COMPANY_A),
      fetch: scopedFetch,
    });
    expect(result).toMatchObject({ ok: true, status: 200 });
  });

  it("returns 404 — not 403 — when another company requests the same id", async () => {
    const result = await getReviewForCompany(REVIEW_ID, {
      session: sessionFor(COMPANY_B),
      fetch: scopedFetch,
    });
    // 404, so company B cannot even tell the review exists (Rules.md §6).
    expect(result).toMatchObject({ ok: false, status: 404 });
  });
});
