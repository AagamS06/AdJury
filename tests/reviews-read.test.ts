import { describe, it, expect, vi } from "vitest";
import type { SessionContext } from "@/lib/auth/session";
import type { ListReviewsOptions } from "@/lib/db/queries";
import { PERSONA_NAMES } from "@/lib/schema/juror";
import {
  clampLimit,
  getReviewForCompany,
  listReviewsForCompany,
  reviewRowToSummary,
  reviewWithScoresToPersisted,
  scoreRowToJurorSlot,
} from "@/lib/reviews/read-reviews";
import type {
  PersonaScoreRow,
  ReviewRow,
  ReviewWithScores,
} from "@/types/db";

/**
 * Read endpoints for reviews (DailyPlan Day 6): GET /api/reviews/[id] and the
 * GET /api/reviews list. The pure row→DTO mappers and the injectable endpoint
 * cores are exercised here with fakes — no Next request plumbing, no DB. The
 * central guarantee proved is tenancy: the company comes from the session and
 * is passed to every query, and another company's row reads as 404.
 */

const COMPANY_ID = "22222222-2222-2222-2222-222222222222";

const SESSION: SessionContext = {
  authUserId: "11111111-1111-1111-1111-111111111111",
  email: "admin@acme.test",
  companyId: COMPANY_ID,
  role: "admin",
  company: {
    id: COMPANY_ID,
    name: "Acme",
    industry: null,
    plan_tier: "free",
    created_at: "2026-08-31T00:00:00.000Z",
  },
};

const REVIEW_ID = "00000000-0000-0000-0000-000000000001";

function reviewRow(overrides: Partial<ReviewRow> = {}): ReviewRow {
  return {
    id: REVIEW_ID,
    company_id: COMPANY_ID,
    submitted_by: SESSION.authUserId,
    content_text: "Introducing our new sleep supplement.",
    content_type: "ad_copy",
    platform: "instagram",
    aggregate_score: 7.2,
    verdict: "revise",
    created_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function okScore(persona: PersonaScoreRow["persona_name"]): PersonaScoreRow {
  return {
    id: `score-${persona}`,
    review_id: REVIEW_ID,
    persona_name: persona,
    score: 8,
    confidence: "high",
    feedback_text: "On-brand and confident.",
    issues_json: [
      { severity: "medium", excerpt: "best ever", explanation: "Hyperbolic." },
    ],
    suggested_rewrite: "One of the most effective tools we tested.",
    status: "ok",
  };
}

// ── pure mappers ──────────────────────────────────────────────────────────

describe("scoreRowToJurorSlot", () => {
  it("reconstructs an ok slot (inverse of jurorSlotToScoreRow)", () => {
    const slot = scoreRowToJurorSlot(okScore("brand_voice_guardian"));
    expect(slot).toEqual({
      persona: "brand_voice_guardian",
      status: "ok",
      score: 8,
      confidence: "high",
      summary: "On-brand and confident.",
      issues: [
        { severity: "medium", excerpt: "best ever", explanation: "Hyperbolic." },
      ],
      suggested_rewrite: "One of the most effective tools we tested.",
    });
  });

  it("reconstructs an error slot, keeping the persona and reason", () => {
    const row: PersonaScoreRow = {
      id: "score-seo",
      review_id: REVIEW_ID,
      persona_name: "seo_discoverability",
      score: null,
      confidence: null,
      feedback_text: "invalid JSON after retry",
      issues_json: [],
      suggested_rewrite: null,
      status: "error",
    };
    expect(scoreRowToJurorSlot(row)).toEqual({
      persona: "seo_discoverability",
      status: "error",
      error: "invalid JSON after retry",
    });
  });

  it("downgrades a malformed ok row (missing fields) to an error slot", () => {
    const row: PersonaScoreRow = {
      ...okScore("stop_scrolling"),
      score: null, // status says ok but the score is missing
    };
    const slot = scoreRowToJurorSlot(row);
    expect(slot.status).toBe("error");
  });
});

describe("reviewWithScoresToPersisted", () => {
  it("composes a persisted review and orders jurors canonically", () => {
    // Provide scores out of order; expect canonical PERSONA_NAMES order out.
    const scores = [...PERSONA_NAMES].reverse().map(okScore);
    const data: ReviewWithScores = { review: reviewRow(), scores };

    const persisted = reviewWithScoresToPersisted(data);

    expect(persisted.review_id).toBe(REVIEW_ID);
    expect(persisted.content_type).toBe("ad_copy");
    expect(persisted.aggregate_score).toBe(7.2);
    expect(persisted.verdict).toBe("revise");
    expect(persisted.jurors.map((j) => j.persona)).toEqual([...PERSONA_NAMES]);
  });

  it("keeps null aggregate/verdict from the row (does not fabricate them)", () => {
    const data: ReviewWithScores = {
      review: reviewRow({ aggregate_score: null, verdict: null }),
      scores: [],
    };
    const persisted = reviewWithScoresToPersisted(data);
    expect(persisted.aggregate_score).toBeNull();
    expect(persisted.verdict).toBeNull();
    expect(persisted.jurors).toEqual([]);
  });
});

describe("reviewRowToSummary", () => {
  it("projects a thin summary without content_text", () => {
    const summary = reviewRowToSummary(reviewRow());
    expect(summary).toEqual({
      review_id: REVIEW_ID,
      content_type: "ad_copy",
      platform: "instagram",
      aggregate_score: 7.2,
      verdict: "revise",
      created_at: "2026-09-01T00:00:00.000Z",
    });
    expect(summary).not.toHaveProperty("content_text");
    expect(summary).not.toHaveProperty("submitted_by");
  });
});

describe("clampLimit", () => {
  it("defaults, floors, and clamps to sane bounds", () => {
    expect(clampLimit(undefined)).toBe(50);
    expect(clampLimit(Number.NaN)).toBe(50);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(10)).toBe(10);
    expect(clampLimit(10.9)).toBe(10);
    expect(clampLimit(1000)).toBe(100);
  });
});

// ── GET /api/reviews/[id] ─────────────────────────────────────────────────

describe("getReviewForCompany (GET /api/reviews/[id])", () => {
  it("returns 200 with a composed review for the caller's company", async () => {
    const calls: Array<{ id: string; companyId: string }> = [];
    const fetch = async (id: string, companyId: string) => {
      calls.push({ id, companyId });
      return {
        review: reviewRow(),
        scores: PERSONA_NAMES.map(okScore),
      } satisfies ReviewWithScores;
    };

    const result = await getReviewForCompany(REVIEW_ID, { session: SESSION, fetch });

    expect(result).toMatchObject({ ok: true, status: 200 });
    if (!result.ok) throw new Error("expected ok");
    expect(result.review.jurors).toHaveLength(PERSONA_NAMES.length);
    // Tenancy: the company was taken from the session, not the caller.
    expect(calls).toEqual([{ id: REVIEW_ID, companyId: COMPANY_ID }]);
  });

  it("rejects an unauthenticated caller with 401 and never queries", async () => {
    const fetch = vi.fn();
    const result = await getReviewForCompany(REVIEW_ID, { session: null, fetch });
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns 404 when the row is absent or belongs to another company", async () => {
    // getReviewById returns null for both "missing" and "other company" — the
    // endpoint must not distinguish them.
    const fetch = async () => null;
    const result = await getReviewForCompany(REVIEW_ID, { session: SESSION, fetch });
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it("returns 500 without leaking detail when the query throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = async () => {
      throw new Error("db.getReviewById/review failed [XX000]: boom");
    };
    const result = await getReviewForCompany(REVIEW_ID, { session: SESSION, fetch });
    expect(result).toMatchObject({ ok: false, status: 500 });
    if (result.ok) throw new Error("expected error");
    expect(result.error).not.toContain("boom");
    spy.mockRestore();
  });
});

// ── GET /api/reviews (list) ───────────────────────────────────────────────

describe("listReviewsForCompany (GET /api/reviews)", () => {
  it("returns 200 with company-scoped summaries and a clamped limit", async () => {
    const calls: Array<{ companyId: string; opts: ListReviewsOptions }> = [];
    const list = async (companyId: string, opts: ListReviewsOptions) => {
      calls.push({ companyId, opts });
      return [reviewRow(), reviewRow({ id: "00000000-0000-0000-0000-000000000002" })];
    };

    const result = await listReviewsForCompany({ session: SESSION, list, limit: 1000 });

    expect(result).toMatchObject({ ok: true, status: 200 });
    if (!result.ok) throw new Error("expected ok");
    expect(result.reviews).toHaveLength(2);
    // Summaries are thin — no content leaked into the list.
    expect(result.reviews[0]).not.toHaveProperty("content_text");
    // Tenancy + clamping: company from session, limit clamped to the max.
    expect(calls).toEqual([{ companyId: COMPANY_ID, opts: { limit: 100 } }]);
  });

  it("rejects an unauthenticated caller with 401 and never queries", async () => {
    const list = vi.fn();
    const result = await listReviewsForCompany({ session: null, list });
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(list).not.toHaveBeenCalled();
  });

  it("returns 500 without leaking detail when the query throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const list = async () => {
      throw new Error("db.listReviewsByCompany failed [XX000]: boom");
    };
    const result = await listReviewsForCompany({ session: SESSION, list });
    expect(result).toMatchObject({ ok: false, status: 500 });
    if (result.ok) throw new Error("expected error");
    expect(result.error).not.toContain("boom");
    spy.mockRestore();
  });
});
