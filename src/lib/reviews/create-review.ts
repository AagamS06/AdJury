/**
 * Core logic for `POST /api/reviews` (DailyPlan Day 5).
 *
 * Kept out of the route handler so it is unit-testable without Next's request
 * plumbing or a live database: identity and persistence are injected. The
 * route (`src/app/api/reviews/route.ts`) wires the real dependencies; tests
 * pass a fake session + persist and the offline mock model client.
 *
 * Tenancy is non-negotiable (Rules.md §5): `company_id` and `submitted_by` come
 * from the server-resolved session, never from the request body. The client can
 * only supply the content fields (ReviewRequestSchema). Errors are handled per
 * Rules.md §6 — a specific 4xx for bad input/auth, a 502 when every juror fails
 * (no partial review is stored as complete), and a 500 without reporting success
 * when the write fails.
 */
import type { ModelClient } from "@/lib/ai/client";
import { runReview } from "@/lib/ai/orchestrator";
import type { SessionContext } from "@/lib/auth/session";
import type { InsertReviewParams } from "@/lib/db/queries";
import { ReviewRequestSchema, type ReviewResult } from "@/lib/schema/juror";
import { resolveWeights } from "@/lib/scoring";
import type { ReviewWithScores } from "@/types/db";

export type CreateReviewResult =
  | { ok: true; status: 201; review: ReviewResult }
  | { ok: false; status: 400 | 401 | 500 | 502; error: string };

export interface CreateReviewDeps {
  /** Server-resolved session, or null when the caller is unauthenticated. */
  session: SessionContext | null;
  /**
   * Persist the review + its persona_scores. Wired to the service-role write
   * path in the route (persona_scores has no client INSERT policy, so the write
   * runs server-side with an explicit company_id — see queries.ts). Injectable
   * so this logic is testable without a database.
   */
  persist: (params: InsertReviewParams) => Promise<ReviewWithScores>;
  /** Model client; defaults to the env-selected client (offline mock, no key). */
  client?: ModelClient;
}

export async function createReview(
  body: unknown,
  deps: CreateReviewDeps,
): Promise<CreateReviewResult> {
  // 1. Authn + tenancy: identity comes from the session, never the client.
  //    Fail closed when there is no session (Rules.md §6).
  if (!deps.session) {
    return {
      ok: false,
      status: 401,
      error: "You must be signed in to submit a review.",
    };
  }

  // 2. Validate the client-supplied fields at the boundary (Rules.md §6).
  const parsed = ReviewRequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      error: parsed.error.issues[0]?.message ?? "Invalid review request.",
    };
  }

  // 3. Run the five jurors. brand_context stays null here; loading the
  //    company's stored brand guide into Juror 1 is Day 27. The aggregate
  //    honors the company's configured juror weights (Day 16), resolved from
  //    the server session's company row (never the client — Rules.md §5);
  //    an unset/partial/invalid config safely falls back to equal weights.
  const review = await runReview(
    {
      content_text: parsed.data.content_text,
      content_type: parsed.data.content_type,
      platform: parsed.data.platform,
      brand_context: null,
    },
    {
      client: deps.client,
      weights: resolveWeights(deps.session.company.juror_weights),
    },
  );

  // 4. If every juror failed, don't persist a partial review as complete
  //    (Rules.md §6 — all jurors fail → retryable error, nothing stored).
  const anyOk = review.jurors.some((j) => j.status === "ok");
  if (!anyOk) {
    return {
      ok: false,
      status: 502,
      error: "The review service is temporarily unavailable. Please try again.",
    };
  }

  // 5. Persist tenant-safely: company_id + submitted_by are derived server-side.
  try {
    await deps.persist({
      companyId: deps.session.companyId,
      submittedBy: deps.session.authUserId,
      content_text: parsed.data.content_text,
      review,
    });
  } catch (err) {
    // Don't report success on a write failure (Rules.md §6). Log with context
    // but never the user's content or any secret.
    console.error("review persistence failed", {
      op: "createReview",
      companyId: deps.session.companyId,
      reviewId: review.review_id,
      message: err instanceof Error ? err.message : "unknown error",
    });
    return {
      ok: false,
      status: 500,
      error: "We couldn't save your review. Please try again.",
    };
  }

  return { ok: true, status: 201, review };
}
