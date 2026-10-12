import { describe, it, expect } from "vitest";
import type { SessionContext } from "@/lib/auth/session";
import type { ListReviewsOptions } from "@/lib/db/queries";
import {
  getReviewForCompany,
  listReviewsForCompany,
  type PersistedReview,
  type ReviewSummary,
} from "@/lib/reviews/read-reviews";
import { reviewToCsv, reviewCsvFilename } from "@/lib/reviews/csv-export";
import {
  historyToCsv,
  historyCsvFilename,
} from "@/lib/reviews/history-csv-export";
import { reviewToPdf, reviewPdfFilename } from "@/lib/reviews/pdf-export";
import {
  filterReviewSummaries,
  parseHistoryFilters,
} from "@/lib/reviews/history-filter";
import {
  checkExportRateLimit,
  createInMemoryExportRateStore,
  exportRateLimitMessage,
  resolveExportRateLimitPolicy,
  type ExportRateStore,
} from "@/lib/reviews/export-access";
import {
  exportErrorMessage,
  historyExportHref,
  parseContentDispositionFilename,
  reviewExportHref,
} from "@/lib/reviews/export-ui";
import { evaluateRateLimit } from "@/lib/rate-limit";
import type { Issue, PersonaName } from "@/lib/schema/juror";
import type {
  ContentType,
  PersonaScoreRow,
  PlanTier,
  ReviewRow,
  ReviewWithScores,
} from "@/types/db";

/**
 * Week 6 hardening (DailyPlan Day 42) — export & reporting integration.
 *
 * The per-day Week-6 suites exercise each core in isolation with narrow fakes:
 * `csv-export.test` / `history-csv-export.test` / `history-filter.test` (Day
 * 36/37 CSV + filtering), `pdf-export.test` (Day 38/39 PDF structure/polish),
 * `export-access.test` (Day 40 authz + rate limit), and `export-ui.test` (Day
 * 41 href/filename/error-message helpers). This suite is the missing end-to-end
 * complement (mirroring the Day 7/14/21/28/35 week-end integration passes): it
 * wires the REAL Week-6 cores together on top of ONE shared in-memory review
 * datastore and the REAL Day-6 read cores — the server-side export trust
 * boundary — and proves the week's invariants COMPOSE across the surface, not
 * just per-core:
 *
 *  1. Single-review export is tenant-safe end-to-end (Day 36/38 via Day 6): the
 *     bytes a user can download are only ever resolved through
 *     `getReviewForCompany`, so company B exporting company A's review id gets a
 *     404 and NO serialized file — the CSV/PDF serializers never see another
 *     tenant's row.
 *  2. A failed juror is never a fabricated score in ANY export format: the same
 *     errored-juror review, resolved through the read core, serializes to a CSV
 *     with an empty score cell + "Error" status AND a PDF that says "Could not
 *     be scored" — never a 0 (Rules.md §6), consistently across both exports.
 *  3. History export matches the view and never leaks content (Day 37 via Day 6):
 *     `listReviewsForCompany` → `parseHistoryFilters` → `filterReviewSummaries`
 *     → `historyToCsv`; an inactive filter exports exactly the listed rows, an
 *     active filter narrows to the matching subset, a second tenant's rows never
 *     appear, and the history CSV omits `content_text` even though the
 *     single-review CSV includes it.
 *  4. Export authz + rate limit composes across BOTH endpoints on one shared
 *     store (Day 40): a company's export budget is shared between the
 *     single-review and history flows, a blocked request consumes no slot, a
 *     second company is isolated, and export mirrors READ access (a member — not
 *     just an admin — may export).
 *  5. The export UI closes the loop with the routes (Day 41): the hrefs the
 *     buttons build carry params that `parseHistoryFilters` reads back to the
 *     same filter the export applied, a `Content-Disposition` built from the
 *     real filename helpers round-trips through `parseContentDispositionFilename`,
 *     and a 429's UI copy is the route's own `exportRateLimitMessage`.
 *
 * All offline (no live model/DB) — the cores are the trust boundary, so
 * exercising them together against one store is a faithful integration test.
 */

// ── shared identity ──────────────────────────────────────────────────────────
const COMPANY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function session(
  companyId: string,
  opts: { role?: "admin" | "member"; plan?: PlanTier } = {},
): SessionContext {
  const plan = opts.plan ?? "free";
  return {
    authUserId: `${companyId.slice(0, 8)}-0000-0000-0000-000000000001`,
    email: opts.role === "member" ? "member@acme.test" : "admin@acme.test",
    companyId,
    role: opts.role ?? "admin",
    company: {
      id: companyId,
      name: "Acme",
      industry: null,
      plan_tier: plan,
      juror_weights: null,
      onboarded_at: "2026-08-31T00:00:00.000Z",
      created_at: "2026-08-31T00:00:00.000Z",
    },
  };
}

// ── a shared in-memory reviews datastore the real read cores read through ──────
/**
 * Faithful-enough stand-in for the `reviews` + `persona_scores` tables: it keeps
 * company-scoped rows and exposes `fetch`/`list` closures shaped exactly like the
 * ones the routes wire (`getReviewById(db, id, companyId)` /
 * `listReviewsByCompany(db, companyId, opts)`). Tenancy is enforced here the way
 * RLS + the explicit `company_id` filter enforce it in production: a fetch for a
 * row owned by another company returns null (→ the read core's 404).
 */
class ReviewStore {
  private rows = new Map<string, ReviewWithScores>();

  seed(entry: ReviewWithScores): void {
    this.rows.set(entry.review.id, entry);
  }

  /** Wired to getReviewForCompany's injected `fetch`. */
  fetch = async (
    id: string,
    companyId: string,
  ): Promise<ReviewWithScores | null> => {
    const entry = this.rows.get(id);
    if (!entry || entry.review.company_id !== companyId) return null;
    return entry;
  };

  /** Wired to listReviewsForCompany's injected `list` (newest-first, limited). */
  list = async (
    companyId: string,
    opts: ListReviewsOptions,
  ): Promise<ReviewRow[]> => {
    const owned = [...this.rows.values()]
      .map((e) => e.review)
      .filter((r) => r.company_id === companyId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return owned.slice(0, opts.limit ?? owned.length);
  };
}

// ── fixture builders ───────────────────────────────────────────────────────
let seq = 0;

function okScore(
  reviewId: string,
  persona: PersonaName,
  score: number,
  issues: Issue[] = [],
): PersonaScoreRow {
  seq += 1;
  return {
    id: `score-${seq}`,
    review_id: reviewId,
    persona_name: persona,
    score,
    confidence: "high",
    feedback_text: `${persona} looks solid.`,
    issues_json: issues,
    suggested_rewrite: `Tighten the ${persona} angle.`,
    status: "ok",
  };
}

function erroredScore(reviewId: string, persona: PersonaName): PersonaScoreRow {
  seq += 1;
  return {
    id: `score-${seq}`,
    review_id: reviewId,
    persona_name: persona,
    score: null,
    confidence: null,
    feedback_text: "The model did not return valid JSON after a retry.",
    issues_json: [],
    suggested_rewrite: null,
    status: "error",
  };
}

interface ReviewSpec {
  id: string;
  companyId: string;
  createdAt: string;
  contentType?: ContentType;
  platform?: string | null;
  aggregate?: number | null;
  verdict?: "pass" | "revise" | "fail" | null;
  content?: string;
  scores: PersonaScoreRow[];
}

function buildReview(spec: ReviewSpec): ReviewWithScores {
  return {
    review: {
      id: spec.id,
      company_id: spec.companyId,
      submitted_by: `${spec.companyId.slice(0, 8)}-0000-0000-0000-000000000001`,
      content_text: spec.content ?? "Introducing our new widget for busy teams.",
      content_type: spec.contentType ?? "ad_copy",
      platform: spec.platform ?? "instagram",
      aggregate_score: spec.aggregate ?? 7.6,
      verdict: spec.verdict ?? "pass",
      created_at: spec.createdAt,
    },
    scores: spec.scores,
  };
}

// ── a tiny RFC 4180 reader (proves the serialized CSV is well-formed) ─────────
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\r" && text[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      field = "";
      row = [];
      i += 2;
      continue;
    }
    field += ch;
    i += 1;
  }
  row.push(field);
  rows.push(row);
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Week 6 hardening — export & reporting integration", () => {
  // ── 1. single-review export is tenant-safe end-to-end ────────────────────
  describe("single-review export resolves only through the tenant-safe read core", () => {
    it("company A exports its own review as a well-formed CSV", async () => {
      const store = new ReviewStore();
      const reviewId = "11111111-1111-1111-1111-111111111111";
      store.seed(
        buildReview({
          id: reviewId,
          companyId: COMPANY_A,
          createdAt: "2026-10-05T12:00:00.000Z",
          content: "Our widget saves busy teams two hours a week.",
          scores: [
            okScore(reviewId, "brand_voice_guardian", 8),
            okScore(reviewId, "compliance_legal_flagger", 7),
          ],
        }),
      );

      const result = await getReviewForCompany(reviewId, {
        session: session(COMPANY_A),
        fetch: store.fetch,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const csv = reviewToCsv(result.review);
      const rows = parseCsv(csv);
      // header + one row per juror, every row equal-width.
      expect(rows.length).toBe(1 + result.review.jurors.length);
      const width = rows[0].length;
      for (const r of rows) expect(r.length).toBe(width);
      // The review's own content made it into the file (it's a per-review export).
      expect(csv).toContain("Our widget saves busy teams two hours a week.");
    });

    it("company B exporting company A's review id gets a 404 and NO file is serialized", async () => {
      const store = new ReviewStore();
      const reviewId = "11111111-1111-1111-1111-111111111111";
      store.seed(
        buildReview({
          id: reviewId,
          companyId: COMPANY_A,
          createdAt: "2026-10-05T12:00:00.000Z",
          content: "COMPANY-A-SECRET widget copy",
          scores: [okScore(reviewId, "brand_voice_guardian", 8)],
        }),
      );

      const result = await getReviewForCompany(reviewId, {
        session: session(COMPANY_B),
        fetch: store.fetch,
      });

      // Absent-or-other-company collapse to 404 (never reveal cross-tenant existence).
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(404);
      // Because the read core yields no review, there is nothing to serialize —
      // company A's content can never reach the CSV/PDF serializer for company B.
      expect("review" in result).toBe(false);
    });
  });

  // ── 2. a failed juror is never a fabricated score in ANY format ──────────
  it("an errored juror serializes to empty CSV score + 'Could not be scored' PDF, never a 0", async () => {
    const store = new ReviewStore();
    const reviewId = "22222222-2222-2222-2222-222222222222";
    store.seed(
      buildReview({
        id: reviewId,
        companyId: COMPANY_A,
        createdAt: "2026-10-06T09:30:00.000Z",
        aggregate: null,
        verdict: null,
        scores: [
          okScore(reviewId, "brand_voice_guardian", 9),
          erroredScore(reviewId, "compliance_legal_flagger"),
        ],
      }),
    );

    const result = await getReviewForCompany(reviewId, {
      session: session(COMPANY_A),
      fetch: store.fetch,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // CSV: the errored juror's row carries "Error" status and an empty score cell.
    const rows = parseCsv(reviewToCsv(result.review));
    const headers = rows[0];
    const statusIdx = headers.indexOf("Status");
    const scoreIdx = headers.indexOf("Score");
    const jurorIdx = headers.indexOf("Juror");
    const errorRow = rows.find((r) => r[statusIdx] === "Error");
    expect(errorRow).toBeDefined();
    expect(errorRow![scoreIdx]).toBe("");
    // The healthy juror still reports its real score.
    const okRow = rows.find((r) => r[statusIdx] === "Scored");
    expect(okRow![scoreIdx]).toBe("9");
    // No row claims a 0 for the compliance juror.
    const complianceRows = rows
      .slice(1)
      .filter((r) => r[jurorIdx].toLowerCase().includes("compliance"));
    expect(complianceRows.length).toBe(1);
    expect(complianceRows[0][scoreIdx]).toBe("");

    // PDF: same review, same invariant — the errored juror reads "Could not be
    // scored", and no fabricated numeric chip is printed for it.
    const pdf = reviewToPdf(result.review);
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("Could not be scored");
    // A never-scored aggregate never prints a pass/fail band as a number.
    expect(pdf).not.toContain("Aggregate score: 0");
  });

  // ── 3. history export matches the view and never leaks content ───────────
  describe("history export composes the read core, filter, and serializer", () => {
    function seedHistory(store: ReviewStore): void {
      store.seed(
        buildReview({
          id: "aaa-1",
          companyId: COMPANY_A,
          createdAt: "2026-10-01T10:00:00.000Z",
          contentType: "ad_copy",
          platform: "instagram",
          verdict: "pass",
          content: "A-CONTENT-ONE should never appear in a history CSV",
          scores: [okScore("aaa-1", "brand_voice_guardian", 8)],
        }),
      );
      store.seed(
        buildReview({
          id: "aaa-2",
          companyId: COMPANY_A,
          createdAt: "2026-10-03T10:00:00.000Z",
          contentType: "email",
          platform: "instagram",
          verdict: "revise",
          content: "A-CONTENT-TWO should never appear in a history CSV",
          scores: [okScore("aaa-2", "brand_voice_guardian", 6)],
        }),
      );
      // A second tenant's review must never surface in company A's export.
      store.seed(
        buildReview({
          id: "bbb-1",
          companyId: COMPANY_B,
          createdAt: "2026-10-02T10:00:00.000Z",
          contentType: "ad_copy",
          platform: "instagram",
          verdict: "pass",
          content: "B-CONTENT belongs to another company",
          scores: [okScore("bbb-1", "brand_voice_guardian", 9)],
        }),
      );
    }

    it("an inactive filter exports exactly the rows the view lists (and no other tenant's)", async () => {
      const store = new ReviewStore();
      seedHistory(store);

      const listed = await listReviewsForCompany({
        session: session(COMPANY_A),
        list: store.list,
      });
      expect(listed.ok).toBe(true);
      if (!listed.ok) return;

      const filter = parseHistoryFilters(new URLSearchParams("format=csv"));
      const filtered = filterReviewSummaries(listed.reviews, filter);
      // Inactive filter is reference-stable — it IS the view.
      expect(filtered).toBe(listed.reviews);

      const rows = parseCsv(historyToCsv(filtered));
      const dataRows = rows.slice(1);
      const idIdx = rows[0].indexOf("Review ID");
      const exportedIds = dataRows.map((r) => r[idIdx]).sort();
      expect(exportedIds).toEqual(["aaa-1", "aaa-2"]);
      // Tenant isolation: company B's row never appears.
      expect(exportedIds).not.toContain("bbb-1");
    });

    it("an active verdict filter narrows the export to the matching subset", async () => {
      const store = new ReviewStore();
      seedHistory(store);

      const listed = await listReviewsForCompany({
        session: session(COMPANY_A),
        list: store.list,
      });
      if (!listed.ok) return;

      const filter = parseHistoryFilters(
        new URLSearchParams("format=csv&verdict=revise"),
      );
      const filtered = filterReviewSummaries(listed.reviews, filter);
      expect(filtered.map((r) => r.review_id)).toEqual(["aaa-2"]);

      const rows = parseCsv(historyToCsv(filtered));
      expect(rows.length).toBe(2); // header + the one matching review
    });

    it("the history CSV omits content even though the single-review CSV includes it", async () => {
      const store = new ReviewStore();
      seedHistory(store);

      const listed = await listReviewsForCompany({
        session: session(COMPANY_A),
        list: store.list,
      });
      if (!listed.ok) return;

      const historyCsv = historyToCsv(listed.reviews);
      expect(historyCsv).not.toContain("A-CONTENT-ONE");
      expect(historyCsv).not.toContain("A-CONTENT-TWO");

      // The per-review export of the SAME review does carry its content.
      const single = await getReviewForCompany("aaa-1", {
        session: session(COMPANY_A),
        fetch: store.fetch,
      });
      if (!single.ok) return;
      expect(reviewToCsv(single.review)).toContain("A-CONTENT-ONE");
    });
  });

  // ── 4. export authz + rate limit composes across both endpoints ──────────
  describe("export rate limit is a shared, per-company, read-mirrored budget", () => {
    it("exhausting the budget on one endpoint blocks the other (one company budget)", () => {
      const store: ExportRateStore = createInMemoryExportRateStore();
      const sess = session(COMPANY_A, { plan: "free" });
      const limit = resolveExportRateLimitPolicy("free").limit;
      const now = new Date("2026-10-06T00:00:00.000Z");

      // Spend the entire budget as if they were single-review exports.
      for (let n = 0; n < limit; n += 1) {
        const r = checkExportRateLimit({ session: sess, store, now });
        expect(r.ok).toBe(true);
      }
      // The next call — regardless of which endpoint it is — is blocked, because
      // both endpoints share the one per-company store.
      const blocked = checkExportRateLimit({ session: sess, store, now });
      expect(blocked.ok).toBe(false);
      if (blocked.ok) return;
      expect(blocked.status).toBe(429);
    });

    it("a blocked request consumes no slot (retrying after the window succeeds exactly once more)", () => {
      const store: ExportRateStore = createInMemoryExportRateStore();
      const sess = session(COMPANY_A, { plan: "free" });
      const limit = resolveExportRateLimitPolicy("free").limit;
      const start = new Date("2026-10-06T00:00:00.000Z");

      for (let n = 0; n < limit; n += 1) {
        checkExportRateLimit({ session: sess, store, now: start });
      }
      // Several blocked attempts while at the limit.
      for (let n = 0; n < 3; n += 1) {
        expect(checkExportRateLimit({ session: sess, store, now: start }).ok).toBe(
          false,
        );
      }
      // Blocked attempts recorded nothing, so after the window fully elapses the
      // company gets a fresh full budget — not a budget shrunk by the retries.
      const later = new Date(start.getTime() + 60 * 60 * 1000 + 1);
      for (let n = 0; n < limit; n += 1) {
        expect(checkExportRateLimit({ session: sess, store, now: later }).ok).toBe(
          true,
        );
      }
      expect(checkExportRateLimit({ session: sess, store, now: later }).ok).toBe(
        false,
      );
    });

    it("companies are isolated and a member (not just an admin) may export", () => {
      const store: ExportRateStore = createInMemoryExportRateStore();
      const limitFree = resolveExportRateLimitPolicy("free").limit;
      const now = new Date("2026-10-06T00:00:00.000Z");

      // Company A (a MEMBER session — export mirrors read access, not admin) uses
      // its whole budget.
      const memberA = session(COMPANY_A, { role: "member", plan: "free" });
      for (let n = 0; n < limitFree; n += 1) {
        expect(checkExportRateLimit({ session: memberA, store, now }).ok).toBe(true);
      }
      expect(checkExportRateLimit({ session: memberA, store, now }).ok).toBe(false);

      // Company B is untouched by company A exhausting its budget.
      const memberB = session(COMPANY_B, { role: "member", plan: "free" });
      expect(checkExportRateLimit({ session: memberB, store, now }).ok).toBe(true);
    });
  });

  // ── 5. the export UI closes the loop with the routes ─────────────────────
  describe("export UI hrefs and filenames round-trip with the route logic", () => {
    it("historyExportHref carries filters that parseHistoryFilters reads back identically", () => {
      // What a server component would hand the button (active history filters).
      const viewParams = {
        content_type: "email",
        verdict: "revise",
        platform: "instagram",
      };
      const href = historyExportHref(viewParams);

      // The route parses the href's query string the same way.
      const query = href.slice(href.indexOf("?") + 1);
      const parsed = parseHistoryFilters(new URLSearchParams(query));

      expect(parsed.contentType).toBe("email");
      expect(parsed.verdict).toBe("revise");
      expect(parsed.platform).toBe("instagram");

      // And that parsed filter actually selects the matching review from a mixed set.
      const summaries: ReviewSummary[] = [
        {
          review_id: "keep",
          content_type: "email",
          platform: "instagram",
          aggregate_score: 6,
          verdict: "revise",
          created_at: "2026-10-03T10:00:00.000Z",
        },
        {
          review_id: "drop",
          content_type: "ad_copy",
          platform: "instagram",
          aggregate_score: 8,
          verdict: "pass",
          created_at: "2026-10-01T10:00:00.000Z",
        },
      ];
      expect(
        filterReviewSummaries(summaries, parsed).map((r) => r.review_id),
      ).toEqual(["keep"]);
    });

    it("a Content-Disposition built from the real filename helpers round-trips", () => {
      const review: PersistedReview = {
        review_id: "11111111-1111-1111-1111-111111111111",
        content_type: "ad_copy",
        platform: "instagram",
        created_at: "2026-10-05T12:00:00.000Z",
        aggregate_score: 7.6,
        verdict: "pass",
        jurors: [],
        content_text: "x",
      };

      const csvName = reviewCsvFilename(review);
      const pdfName = reviewPdfFilename(review);
      const histName = historyCsvFilename(new Date("2026-10-05T12:00:00.000Z"));

      for (const name of [csvName, pdfName, histName]) {
        const header = `attachment; filename="${name}"`;
        expect(parseContentDispositionFilename(header)).toBe(name);
      }

      // The single-review href points at the right endpoint + format.
      expect(reviewExportHref(review.review_id, "csv")).toBe(
        "/api/reviews/11111111-1111-1111-1111-111111111111/export?format=csv",
      );
      expect(reviewExportHref(review.review_id, "pdf")).toContain("format=pdf");
    });

    it("the 429 the UI shows is the route's own rate-limit message", () => {
      // Reproduce what the route computes when the limiter blocks a request.
      const policy = resolveExportRateLimitPolicy("free");
      const now = new Date("2026-10-06T00:00:00.000Z");
      const decision = evaluateRateLimit(
        policy,
        { count: policy.limit, oldest: now.toISOString() },
        now,
      );
      expect(decision.allowed).toBe(false);

      const routeMessage = exportRateLimitMessage(decision);
      // The client island surfaces the server's message verbatim for a 429.
      expect(exportErrorMessage(429, routeMessage)).toBe(routeMessage);
      expect(routeMessage).toContain(String(policy.limit));
    });
  });
});
