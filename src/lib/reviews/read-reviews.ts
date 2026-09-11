/**
 * Core logic for the review read endpoints (DailyPlan Day 6):
 *   - GET /api/reviews/[id]  → fetch one persisted review + its persona_scores
 *   - GET /api/reviews       → list the company's reviews (newest first)
 *
 * Kept out of the route handlers so it is unit-testable without Next's request
 * plumbing or a live database: identity and the DB reads are injected. The
 * routes wire the real dependencies (a request-scoped anon client, so RLS also
 * constrains the reads) and translate the outcome to an HTTP response.
 *
 * Tenancy is non-negotiable (Rules.md §5): the company is taken from the
 * server-resolved session and passed explicitly to every query as a second
 * layer beyond RLS. A row that is absent OR belongs to another company reads as
 * "not found" — we never reveal cross-tenant existence (Rules.md §6).
 */
import type { SessionContext } from "@/lib/auth/session";
import type { ListReviewsOptions } from "@/lib/db/queries";
import {
  PERSONA_NAMES,
  type JurorSlot,
  type Verdict,
} from "@/lib/schema/juror";
import type {
  ContentType,
  PersonaScoreRow,
  ReviewRow,
  ReviewWithScores,
} from "@/types/db";

/**
 * A review reconstructed from stored rows for the scorecard UI. Mirrors the
 * juror JSON contract (`ReviewResult`) so a persisted review renders the same
 * way a freshly-run one does, minus `model` — which the `reviews` table does not
 * store. `aggregate_score` / `verdict` are nullable to reflect the columns.
 */
export interface PersistedReview {
  review_id: string;
  content_type: ContentType;
  platform: string | null;
  created_at: string;
  aggregate_score: number | null;
  verdict: Verdict | null;
  jurors: JurorSlot[];
  /**
   * The submitted content, kept so the detail page can show each juror's
   * before/after rewrite diff (DailyPlan Day 15). This is a single-review read
   * (not the history list), so returning the content is intentional — the thin
   * `ReviewSummary` still omits it.
   */
  content_text: string;
}

/** A lightweight review row for history lists (no content_text — keep it thin). */
export interface ReviewSummary {
  review_id: string;
  content_type: ContentType;
  platform: string | null;
  aggregate_score: number | null;
  verdict: Verdict | null;
  created_at: string;
}

/**
 * Reconstruct a juror slot from a persona_scores row — the inverse of
 * `jurorSlotToScoreRow`. An `error` row (or an `ok` row missing any required
 * field) becomes an error slot so the reconstructed review never claims a juror
 * result it cannot back up (Rules.md §6).
 */
export function scoreRowToJurorSlot(row: PersonaScoreRow): JurorSlot {
  if (
    row.status === "ok" &&
    row.score !== null &&
    row.confidence !== null &&
    row.feedback_text !== null &&
    row.suggested_rewrite !== null
  ) {
    return {
      persona: row.persona_name,
      status: "ok",
      score: row.score,
      confidence: row.confidence,
      summary: row.feedback_text,
      issues: row.issues_json ?? [],
      suggested_rewrite: row.suggested_rewrite,
    };
  }
  return {
    persona: row.persona_name,
    status: "error",
    error: row.feedback_text ?? "This juror did not return a valid result.",
  };
}

/** Compose a stored review + its persona_scores into a `PersistedReview`. */
export function reviewWithScoresToPersisted(
  data: ReviewWithScores,
): PersistedReview {
  const byPersona = new Map(data.scores.map((s) => [s.persona_name, s]));
  // Emit jurors in the canonical persona order for a stable scorecard layout.
  const jurors = PERSONA_NAMES.map((persona) => byPersona.get(persona))
    .filter((row): row is PersonaScoreRow => row !== undefined)
    .map(scoreRowToJurorSlot);

  return {
    review_id: data.review.id,
    content_type: data.review.content_type,
    platform: data.review.platform,
    created_at: data.review.created_at,
    aggregate_score: data.review.aggregate_score,
    verdict: data.review.verdict,
    jurors,
    content_text: data.review.content_text,
  };
}

/** Project a review row into the thin history-list summary. */
export function reviewRowToSummary(row: ReviewRow): ReviewSummary {
  return {
    review_id: row.id,
    content_type: row.content_type,
    platform: row.platform,
    aggregate_score: row.aggregate_score,
    verdict: row.verdict,
    created_at: row.created_at,
  };
}

// ── GET /api/reviews/[id] ─────────────────────────────────────────────────

export type GetReviewResult =
  | { ok: true; status: 200; review: PersistedReview }
  | { ok: false; status: 401 | 404 | 500; error: string };

export interface GetReviewDeps {
  /** Server-resolved session, or null when the caller is unauthenticated. */
  session: SessionContext | null;
  /**
   * Fetch a review + scores scoped to the company. Wired to
   * `getReviewById(db, id, companyId)`; injectable so this logic is testable
   * without a database.
   */
  fetch: (id: string, companyId: string) => Promise<ReviewWithScores | null>;
}

export async function getReviewForCompany(
  id: string,
  deps: GetReviewDeps,
): Promise<GetReviewResult> {
  if (!deps.session) {
    return { ok: false, status: 401, error: "You must be signed in." };
  }

  let data: ReviewWithScores | null;
  try {
    data = await deps.fetch(id, deps.session.companyId);
  } catch (err) {
    console.error("review fetch failed", {
      op: "getReviewForCompany",
      companyId: deps.session.companyId,
      reviewId: id,
      message: err instanceof Error ? err.message : "unknown error",
    });
    return {
      ok: false,
      status: 500,
      error: "We couldn't load that review. Please try again.",
    };
  }

  // Absent or another company's row: identical "not found" (never reveal
  // cross-tenant existence — Rules.md §6).
  if (!data) {
    return { ok: false, status: 404, error: "Review not found." };
  }

  return { ok: true, status: 200, review: reviewWithScoresToPersisted(data) };
}

// ── GET /api/reviews (list) ───────────────────────────────────────────────

export type ListReviewsResult =
  | { ok: true; status: 200; reviews: ReviewSummary[] }
  | { ok: false; status: 401 | 500; error: string };

export interface ListReviewsDeps {
  /** Server-resolved session, or null when the caller is unauthenticated. */
  session: SessionContext | null;
  /**
   * List a company's review rows, newest first. Wired to
   * `listReviewsByCompany(db, companyId, opts)`; injectable for testing.
   */
  list: (companyId: string, opts: ListReviewsOptions) => Promise<ReviewRow[]>;
  /** Optional page size; clamped to a sane range before hitting the DB. */
  limit?: number;
}

/** Bounds for the list page size (defends against abusive/huge requests). */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export async function listReviewsForCompany(
  deps: ListReviewsDeps,
): Promise<ListReviewsResult> {
  if (!deps.session) {
    return { ok: false, status: 401, error: "You must be signed in." };
  }

  const limit = clampLimit(deps.limit);

  let rows: ReviewRow[];
  try {
    rows = await deps.list(deps.session.companyId, { limit });
  } catch (err) {
    console.error("review list failed", {
      op: "listReviewsForCompany",
      companyId: deps.session.companyId,
      message: err instanceof Error ? err.message : "unknown error",
    });
    return {
      ok: false,
      status: 500,
      error: "We couldn't load your reviews. Please try again.",
    };
  }

  return { ok: true, status: 200, reviews: rows.map(reviewRowToSummary) };
}

/** Clamp a requested limit to [1, MAX_LIMIT], falling back to the default. */
export function clampLimit(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return DEFAULT_LIMIT;
  }
  const floored = Math.floor(requested);
  if (floored < 1) return 1;
  if (floored > MAX_LIMIT) return MAX_LIMIT;
  return floored;
}
