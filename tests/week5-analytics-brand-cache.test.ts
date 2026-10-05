import { describe, it, expect } from "vitest";
import type { ModelClient, CompleteArgs } from "@/lib/ai/client";
import type { SessionContext } from "@/lib/auth/session";
import { createReview } from "@/lib/reviews/create-review";
import { saveBrandProfile } from "@/lib/company/save-brand-profile";
import {
  MAX_BRAND_SUMMARY_CHARS,
  summarizeBrandGuide,
} from "@/lib/company/brand-summary";
import {
  getCompanyAnalytics,
  type CompanyAnalytics,
} from "@/lib/reviews/analytics";
import {
  buildJurorBreakdown,
  buildScoreTrendChart,
  summarizeAnalyticsState,
  verdictShares,
} from "@/lib/reviews/analytics-view";
import { verdictLabel } from "@/lib/reviews/scorecard-view";
import {
  PERSONA_NAMES,
  type PersonaName,
  type Verdict,
} from "@/lib/schema/juror";
import type {
  BrandProfileRow,
  PersonaScoreRow,
  ReviewRow,
  ReviewWithScores,
} from "@/types/db";

/**
 * Week 5 hardening (DailyPlan Day 35) — brand-voice-cache + analytics integration.
 *
 * The per-day Week-5 suites exercise each core in isolation with narrow fakes:
 * `brand-summary.test` / `brand-summary-read.test` (Day 29/30 cache compute +
 * resolve), `analytics.test` (Day 31 aggregation + the tenant-safe core), and
 * `analytics-view.test` (Day 32/33/34 chart geometry + state copy). This suite
 * is the missing end-to-end complement (mirroring the Day 7/21/28 integration
 * passes): it wires the REAL Week-5 cores together against ONE shared in-memory
 * datastore and proves the week's invariants COMPOSE across the surface, not
 * just per-core:
 *
 *  1. Brand-voice cache (Day 29 write → Day 30 read in a real review): an admin's
 *     `saveBrandProfile` populates the bounded cache, and a later `createReview`
 *     injects that bounded summary into the Brand Voice Guardian — never the full
 *     guide — so cost per review is independent of guide size, the cache is reused
 *     verbatim (no reprocessing), an edit refreshes it (no drift), and a legacy
 *     row with no cache recomputes a bounded summary rather than the full guide.
 *  2. Analytics pipeline (Day 31 compute → Day 32/33/34 view) via the tenant-safe
 *     `getCompanyAnalytics`: the payload is scoped to the session company, the
 *     Day 34 state classification always agrees with the Day 32 chart it labels,
 *     a failed juror is never read as a zero through to the Day 33 breakdown, and
 *     the verdict shares reconcile with the window distribution.
 *
 * All offline (no live model/DB) — the cores are the server-side trust boundary,
 * so exercising them together against one store is a faithful integration test.
 */

// ── shared identity ──────────────────────────────────────────────────────────
const COMPANY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function adminSession(companyId: string): SessionContext {
  return {
    authUserId: `${companyId.slice(0, 8)}-0000-0000-0000-000000000001`,
    email: "admin@acme.test",
    companyId,
    role: "admin",
    company: {
      id: companyId,
      name: "Acme",
      industry: null,
      plan_tier: "free",
      juror_weights: null,
      onboarded_at: "2026-08-31T00:00:00.000Z",
      created_at: "2026-08-31T00:00:00.000Z",
    },
  };
}

// ── a capturing model client: records the user prompt each juror received ─────
class CapturingClient implements ModelClient {
  readonly model = "capture-mock (mock)";
  readonly isMock = true;
  readonly prompts = new Map<PersonaName, string>();

  async complete(args: CompleteArgs): Promise<string> {
    this.prompts.set(args.persona, args.user);
    // Valid juror JSON so the review doesn't degrade — the brand context under
    // test is carried in the prompt, which we assert on, not in the output.
    return JSON.stringify({
      persona: args.persona,
      score: 8,
      confidence: "high",
      summary: `mock ${args.persona}`,
      issues: [],
      suggested_rewrite: "Keep it tight.",
    });
  }

  guardianPrompt(): string {
    return this.prompts.get("brand_voice_guardian") ?? "";
  }
}

// ── a shared in-memory brand_profiles store the real cores read/write ─────────
class BrandStore {
  private rows = new Map<string, BrandProfileRow>();
  private seq = 0;

  getExisting = async (companyId: string): Promise<BrandProfileRow | null> =>
    this.rows.get(companyId) ?? null;

  // Mirrors queries.ts insertBrandProfile: persists the computed cache verbatim.
  insert = async (params: {
    companyId: string;
    toneGuideText: string;
    embeddingRef: string | null;
    brandSummary: string | null;
  }): Promise<BrandProfileRow> => {
    this.seq += 1;
    const row: BrandProfileRow = {
      id: `brand-${this.seq}`,
      company_id: params.companyId,
      tone_guide_text: params.toneGuideText,
      embedding_ref: params.embeddingRef,
      brand_summary: params.brandSummary,
      updated_at: new Date().toISOString(),
    };
    this.rows.set(params.companyId, row);
    return row;
  };

  // Mirrors queries.ts updateBrandProfile: id + company scoped in-place update.
  update = async (params: {
    id: string;
    companyId: string;
    toneGuideText: string;
    embeddingRef: string | null;
    brandSummary: string | null;
  }): Promise<BrandProfileRow> => {
    const existing = this.rows.get(params.companyId);
    if (!existing || existing.id !== params.id) {
      throw new Error("brand profile not found for company");
    }
    const row: BrandProfileRow = {
      ...existing,
      tone_guide_text: params.toneGuideText,
      embedding_ref: params.embeddingRef,
      brand_summary: params.brandSummary,
      updated_at: new Date().toISOString(),
    };
    this.rows.set(params.companyId, row);
    return row;
  };

  // The read createReview wires to getBrandProfileByCompany (request-scoped).
  getBrandProfile = async (companyId: string): Promise<BrandProfileRow | null> =>
    this.rows.get(companyId) ?? null;

  /** Test-only: seed/overwrite a row directly (e.g. a legacy, pre-cache row). */
  seed(row: BrandProfileRow): void {
    this.rows.set(row.company_id, row);
  }

  peek(companyId: string): BrandProfileRow {
    const row = this.rows.get(companyId);
    if (!row) throw new Error("no brand profile seeded");
    return row;
  }
}

/** Build a long guide whose unique marker sentence sits past the summary cap. */
function longGuide(marker: string, repeats = 40): string {
  const lead =
    "We write in a measured, expert voice that respects the reader's time. " +
    "Sentences stay concrete and specific, and we never overpromise. ";
  const filler = Array.from(
    { length: repeats },
    (_, i) => `Our tone avoids hype and keeps claims grounded in evidence ${i}.`,
  ).join(" ");
  return `${lead}${filler} ${marker} is our closing signature phrase.`;
}

async function runReviewWith(
  session: SessionContext,
  store: BrandStore,
  client: CapturingClient,
): Promise<void> {
  const result = await createReview(
    { content_text: "Introducing our new widget for busy teams.", content_type: "ad_copy", platform: "instagram" },
    {
      session,
      persist: async (params): Promise<ReviewWithScores> => ({
        review: {
          id: params.review.review_id,
          company_id: params.companyId,
          submitted_by: params.submittedBy,
          content_text: params.content_text,
          content_type: "ad_copy",
          platform: "instagram",
          aggregate_score: params.review.aggregate_score,
          verdict: params.review.verdict,
          created_at: params.review.created_at,
        },
        scores: [],
      }),
      getBrandProfile: store.getBrandProfile,
      client,
    },
  );
  expect(result.ok).toBe(true);
}

describe("Week 5 — brand-voice cache lifecycle (save → review)", () => {
  it("a saved guide is injected into the Brand Voice Guardian as the bounded summary, never the full guide", async () => {
    const store = new BrandStore();
    const session = adminSession(COMPANY_A);
    const marker = "ZZ_UNIQUE_TAIL_MARKER_ZZ";
    const guide = longGuide(marker);
    expect(guide.length).toBeGreaterThan(MAX_BRAND_SUMMARY_CHARS);

    const saved = await saveBrandProfile({
      session,
      input: { tone_guide_text: guide },
      getExisting: store.getExisting,
      insert: store.insert,
      update: store.update,
    });
    expect(saved.ok).toBe(true);
    const row = store.peek(COMPANY_A);
    expect(row.brand_summary).not.toBeNull();
    expect(row.embedding_ref).not.toBeNull();
    // The whole point of the cache: the stored summary is bounded, not the guide.
    expect(row.brand_summary!.length).toBeLessThanOrEqual(MAX_BRAND_SUMMARY_CHARS);

    const client = new CapturingClient();
    await runReviewWith(session, store, client);
    const guardian = client.guardianPrompt();

    // The review injected the bounded cached summary…
    expect(guardian).toContain("Brand context / style guide:");
    expect(guardian).toContain(row.brand_summary!);
    // …and never the full guide's tail (the marker lives past the summary cap).
    expect(guardian).not.toContain(marker);
    // Only the Brand Voice Guardian sees brand context; other jurors don't.
    for (const persona of PERSONA_NAMES) {
      if (persona === "brand_voice_guardian") continue;
      expect(client.prompts.get(persona) ?? "").not.toContain(
        "Brand context / style guide:",
      );
    }
  });

  it("the review reuses the stored cache verbatim (no reprocessing of the guide)", async () => {
    const store = new BrandStore();
    const session = adminSession(COMPANY_A);
    await saveBrandProfile({
      session,
      input: { tone_guide_text: longGuide("TAILONE") },
      getExisting: store.getExisting,
      insert: store.insert,
      update: store.update,
    });

    // Tamper the stored summary (keeping the ref fresh) with a sentinel the guide
    // would never produce; if the review path reprocessed the guide it would not
    // appear. Reuse verbatim means it does.
    const row = store.peek(COMPANY_A);
    const sentinel = "SENTINEL_CACHED_SUMMARY_NOT_FROM_GUIDE";
    store.seed({ ...row, brand_summary: sentinel });

    const client = new CapturingClient();
    await runReviewWith(session, store, client);
    expect(client.guardianPrompt()).toContain(sentinel);
  });

  it("cost is independent of guide size: a 10× larger guide yields the same bounded context", async () => {
    const store = new BrandStore();
    const session = adminSession(COMPANY_A);

    await saveBrandProfile({
      session,
      input: { tone_guide_text: longGuide("SMALLTAIL", 20) },
      getExisting: store.getExisting,
      insert: store.insert,
      update: store.update,
    });
    const smallSummary = store.peek(COMPANY_A).brand_summary!;

    // A much larger guide, still under the guide cap (MAX_TONE_GUIDE_CHARS).
    const bigSave = await saveBrandProfile({
      session,
      input: { tone_guide_text: longGuide("BIGTAIL", 120) },
      getExisting: store.getExisting,
      insert: store.insert,
      update: store.update,
    });
    expect(bigSave.ok).toBe(true);
    const bigRow = store.peek(COMPANY_A);
    // The far larger guide is stored in full…
    expect(bigRow.tone_guide_text!.length).toBeGreaterThan(
      MAX_BRAND_SUMMARY_CHARS * 5,
    );
    expect(bigRow.tone_guide_text!.length).toBeGreaterThan(
      smallSummary.length * 5,
    );
    // …but its injected summary stays bounded (so per-review cost doesn't grow).
    expect(bigRow.brand_summary!.length).toBeLessThanOrEqual(
      MAX_BRAND_SUMMARY_CHARS,
    );

    const client = new CapturingClient();
    await runReviewWith(session, store, client);
    const guardian = client.guardianPrompt();
    expect(guardian).toContain(bigRow.brand_summary!);
    expect(guardian).not.toContain("BIGTAIL");
  });

  it("editing the guide refreshes the cache so the next review reflects the new guide (no drift)", async () => {
    const store = new BrandStore();
    const session = adminSession(COMPANY_A);

    await saveBrandProfile({
      session,
      input: { tone_guide_text: "We sound warm, playful, and a little cheeky with our readers." },
      getExisting: store.getExisting,
      insert: store.insert,
      update: store.update,
    });
    const firstRef = store.peek(COMPANY_A).embedding_ref;

    const editedGuide =
      "We sound formal, precise, and strictly evidence-led in every sentence.";
    const edited = await saveBrandProfile({
      session,
      input: { tone_guide_text: editedGuide },
      getExisting: store.getExisting,
      insert: store.insert,
      update: store.update,
    });
    expect(edited.ok).toBe(true);
    if (edited.ok) expect(edited.created).toBe(false); // updated in place, one row
    const secondRow = store.peek(COMPANY_A);
    expect(secondRow.embedding_ref).not.toBe(firstRef); // cache rekeyed on edit

    const client = new CapturingClient();
    await runReviewWith(session, store, client);
    const guardian = client.guardianPrompt();
    expect(guardian).toContain(secondRow.brand_summary!);
    expect(guardian).toContain("evidence-led");
    expect(guardian).not.toContain("cheeky");
  });

  it("a legacy row with no cache recomputes a bounded summary, never the full guide", async () => {
    const store = new BrandStore();
    const session = adminSession(COMPANY_A);
    const marker = "ZZ_LEGACY_TAIL_ZZ";
    const guide = longGuide(marker);

    // Simulate a guide saved before the Day 29 cache existed: text, but no cache.
    store.seed({
      id: "legacy-1",
      company_id: COMPANY_A,
      tone_guide_text: guide,
      embedding_ref: null,
      brand_summary: null,
      updated_at: "2026-09-01T00:00:00.000Z",
    });

    const client = new CapturingClient();
    await runReviewWith(session, store, client);
    const guardian = client.guardianPrompt();

    expect(guardian).toContain("Brand context / style guide:");
    // Recomputed live this once to the SAME bounded summary, not the full guide.
    expect(guardian).toContain(summarizeBrandGuide(guide));
    expect(guardian).not.toContain(marker);
  });
});

// ── Part B: analytics pipeline composition ───────────────────────────────────

let reviewSeq = 0;

function scoreRow(
  persona: PersonaName,
  score: number | null,
  reviewId: string,
): PersonaScoreRow {
  const ok = score !== null;
  return {
    id: `score-${persona}-${reviewId}`,
    review_id: reviewId,
    persona_name: persona,
    score,
    confidence: ok ? "high" : null,
    feedback_text: ok ? "ok" : "invalid JSON after retry",
    issues_json: [],
    suggested_rewrite: ok ? "improved" : null,
    status: ok ? "ok" : "error",
  };
}

interface ReviewSpec {
  company: string;
  created_at: string;
  aggregate_score?: number | null;
  verdict?: Verdict | null;
  jurorScores?: Partial<Record<PersonaName, number | null>>;
}

function review(spec: ReviewSpec): ReviewWithScores {
  reviewSeq += 1;
  const id = `review-${reviewSeq}`;
  const reviewRow: ReviewRow = {
    id,
    company_id: spec.company,
    submitted_by: "author-1",
    content_text: "Some marketing content.",
    content_type: "ad_copy",
    platform: "instagram",
    aggregate_score: spec.aggregate_score ?? null,
    verdict: spec.verdict ?? null,
    created_at: spec.created_at,
  };
  const scores: PersonaScoreRow[] = spec.jurorScores
    ? (Object.entries(spec.jurorScores) as [PersonaName, number | null][]).map(
        ([persona, score]) => scoreRow(persona, score, id),
      )
    : [];
  return { review: reviewRow, scores };
}

/** A fetch that serves a shared store, scoped to the requested company. */
function analyticsFetch(all: ReviewWithScores[]) {
  return async (companyId: string): Promise<ReviewWithScores[]> =>
    all.filter((r) => r.review.company_id === companyId);
}

/** All five jurors scored, used to make a review "scored" and verdicted. */
function allJurors(score: number): Partial<Record<PersonaName, number | null>> {
  return Object.fromEntries(PERSONA_NAMES.map((p) => [p, score]));
}

async function analyticsFor(
  companyId: string,
  all: ReviewWithScores[],
): Promise<CompanyAnalytics> {
  const result = await getCompanyAnalytics({
    session: adminSession(companyId),
    fetch: analyticsFetch(all),
  });
  if (!result.ok) throw new Error(`analytics failed: ${result.status}`);
  return result.analytics;
}

describe("Week 5 — analytics pipeline composition (compute → view)", () => {
  it("getCompanyAnalytics is scoped to the session company; another tenant's reviews never leak in", async () => {
    const all = [
      review({ company: COMPANY_A, created_at: "2026-09-10T10:00:00Z", aggregate_score: 8, verdict: "pass", jurorScores: allJurors(8) }),
      review({ company: COMPANY_A, created_at: "2026-09-11T10:00:00Z", aggregate_score: 6, verdict: "revise", jurorScores: allJurors(6) }),
      // Company B data that must not affect A's analytics.
      review({ company: COMPANY_B, created_at: "2026-09-10T10:00:00Z", aggregate_score: 2, verdict: "fail", jurorScores: allJurors(2) }),
    ];

    const a = await analyticsFor(COMPANY_A, all);
    expect(a.totalReviews).toBe(2);
    expect(a.overallAverageScore).toBe(7); // mean(8,6), B's 2 excluded
    expect(a.verdictDistribution).toMatchObject({ pass: 1, revise: 1, fail: 0 });

    const b = await analyticsFor(COMPANY_B, all);
    expect(b.totalReviews).toBe(1);
    expect(b.overallAverageScore).toBe(2);
  });

  it("the Day 34 state classification always agrees with the Day 32 chart it labels", async () => {
    // unscored: reviews exist but none produced an aggregate (all jurors errored).
    const unscoredAll = [
      review({ company: COMPANY_A, created_at: "2026-09-10T10:00:00Z", aggregate_score: null, jurorScores: { brand_voice_guardian: null } }),
      review({ company: COMPANY_A, created_at: "2026-09-11T10:00:00Z", aggregate_score: null, jurorScores: { brand_voice_guardian: null } }),
    ];
    const unscored = await analyticsFor(COMPANY_A, unscoredAll);
    expect(summarizeAnalyticsState(unscored).kind).toBe("unscored");
    const unscoredChart = buildScoreTrendChart(unscored.scoreTrend, unscored.granularity);
    expect(unscoredChart.hasData).toBe(false);
    expect(unscoredChart.points).toHaveLength(0);
    expect(unscoredChart.linePath).toBe("");

    // low-data: exactly one scored period (two scored reviews, same UTC day).
    const lowDataAll = [
      review({ company: COMPANY_B, created_at: "2026-09-10T08:00:00Z", aggregate_score: 7, verdict: "revise", jurorScores: allJurors(7) }),
      review({ company: COMPANY_B, created_at: "2026-09-10T20:00:00Z", aggregate_score: 9, verdict: "pass", jurorScores: allJurors(9) }),
    ];
    const lowData = await analyticsFor(COMPANY_B, lowDataAll);
    expect(summarizeAnalyticsState(lowData).kind).toBe("low-data");
    const lowChart = buildScoreTrendChart(lowData.scoreTrend, lowData.granularity);
    expect(lowChart.hasData).toBe(true);
    expect(lowChart.points).toHaveLength(1); // one plottable point…
    expect(lowChart.linePath).toBe(""); // …so no line can be drawn

    // ready: two or more scored periods (distinct days).
    const readyAll = [
      review({ company: COMPANY_A, created_at: "2026-09-10T10:00:00Z", aggregate_score: 8, verdict: "pass", jurorScores: allJurors(8) }),
      review({ company: COMPANY_A, created_at: "2026-09-12T10:00:00Z", aggregate_score: 6, verdict: "revise", jurorScores: allJurors(6) }),
    ];
    const ready = await analyticsFor(COMPANY_A, readyAll);
    const readyState = summarizeAnalyticsState(ready);
    expect(readyState.kind).toBe("ready");
    expect(readyState.headline).toBeNull();
    const readyChart = buildScoreTrendChart(ready.scoreTrend, ready.granularity);
    expect(readyChart.hasData).toBe(true);
    expect(readyChart.points.length).toBeGreaterThanOrEqual(2);
    expect(readyChart.linePath).not.toBe("");
  });

  it("empty window: state is 'empty' and the chart has nothing to plot", async () => {
    const empty = await analyticsFor(COMPANY_A, []);
    expect(summarizeAnalyticsState(empty).kind).toBe("empty");
    expect(buildScoreTrendChart(empty.scoreTrend, empty.granularity).hasData).toBe(
      false,
    );
  });

  it("a failed juror is never a zero through to the Day 33 per-juror breakdown", async () => {
    // seo_discoverability errors on every review; the others score well.
    const all = [
      review({
        company: COMPANY_A,
        created_at: "2026-09-10T10:00:00Z",
        aggregate_score: 8,
        verdict: "pass",
        jurorScores: { ...allJurors(8), seo_discoverability: null },
      }),
      review({
        company: COMPANY_A,
        created_at: "2026-09-12T10:00:00Z",
        aggregate_score: 8,
        verdict: "pass",
        jurorScores: { ...allJurors(8), seo_discoverability: null },
      }),
    ];
    const analytics = await analyticsFor(COMPANY_A, all);
    const breakdown = buildJurorBreakdown(analytics.jurorTrends, analytics.granularity);

    const seo = breakdown.find((r) => r.persona === "seo_discoverability")!;
    expect(seo.overallAverage).toBeNull(); // not a fabricated 0
    expect(seo.tone).toBe("neutral");
    expect(seo.tierLabel).toBeNull();
    expect(seo.scoredCount).toBe(0);
    expect(seo.chart.hasData).toBe(false);
    expect(seo.chart.points).toHaveLength(0);

    const brand = breakdown.find((r) => r.persona === "brand_voice_guardian")!;
    expect(brand.overallAverage).toBe(8);
    expect(brand.tone).not.toBe("neutral");
    expect(brand.scoredCount).toBe(2);
  });

  it("verdict shares reconcile with the window distribution", async () => {
    const all = [
      review({ company: COMPANY_A, created_at: "2026-09-10T10:00:00Z", aggregate_score: 9, verdict: "pass", jurorScores: allJurors(9) }),
      review({ company: COMPANY_A, created_at: "2026-09-11T10:00:00Z", aggregate_score: 8, verdict: "pass", jurorScores: allJurors(8) }),
      review({ company: COMPANY_A, created_at: "2026-09-12T10:00:00Z", aggregate_score: 6, verdict: "revise", jurorScores: allJurors(6) }),
      review({ company: COMPANY_A, created_at: "2026-09-13T10:00:00Z", aggregate_score: 3, verdict: "fail", jurorScores: allJurors(3) }),
    ];
    const analytics = await analyticsFor(COMPANY_A, all);
    const shares = verdictShares(analytics.verdictDistribution);

    const totalCount = shares.reduce((s, v) => s + v.count, 0);
    expect(totalCount).toBe(analytics.verdictDistribution.total);
    expect(totalCount).toBe(4);
    expect(shares.reduce((s, v) => s + v.pct, 0)).toBe(100);
    // Shares reuse the scorecard verdict labels (Design.md §5).
    const pass = shares.find((v) => v.verdict === "pass")!;
    expect(pass.count).toBe(2);
    expect(pass.pct).toBe(50);
    expect(pass.label).toBe(verdictLabel("pass"));
  });
});
