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
import {
  checkContentSize,
  checkTokenBudget,
  estimateReviewUsage,
  estimateTokens,
  logReviewUsage,
} from "@/lib/ai/cost";
import { runReview } from "@/lib/ai/orchestrator";
import type { SessionContext } from "@/lib/auth/session";
import { resolveBrandContext } from "@/lib/company/brand-profile";
import type { InsertReviewParams, ReviewRateUsage } from "@/lib/db/queries";
import {
  evaluateRateLimit,
  rateLimitMessage,
  rateLimitWindowStart,
  resolveRateLimitPolicy,
  type RateLimitDecision,
} from "@/lib/rate-limit";
import {
  PERSONA_NAMES,
  ReviewRequestSchema,
  type ReviewResult,
} from "@/lib/schema/juror";
import { resolveWeights } from "@/lib/scoring";
import type { BrandProfileRow, ReviewWithScores } from "@/types/db";

export type CreateReviewResult =
  | { ok: true; status: 201; review: ReviewResult }
  | { ok: false; status: 429; error: string; rateLimit: RateLimitDecision }
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
  /**
   * Read the company's review usage within the rate-limit window (DailyPlan
   * Day 17). Wired to `getReviewRateUsage` in the route; when omitted (e.g. a
   * test exercising a different path) the per-plan limit is not enforced. A
   * failure of this read fails OPEN — a transient usage-count blip must not
   * block a legitimate review, and it is logged with redacted context.
   */
  getRateUsage?: (companyId: string, sinceIso: string) => Promise<ReviewRateUsage>;
  /**
   * Read the company's stored brand profile (DailyPlan Day 27). Wired to
   * `getBrandProfileByCompany` in the route (request-scoped anon client, so RLS
   * scopes the read to the caller's company; the session's companyId is also
   * passed explicitly). The resolved tone guide is injected into the Brand Voice
   * Guardian's prompt as `brand_context`. When omitted the review runs with no
   * brand context. A read failure fails OPEN — brand context is an enhancement,
   * not an authz boundary, so a transient blip degrades to a brand-less review
   * (the juror infers a baseline) rather than failing the whole request; it is
   * logged with redacted context.
   */
  getBrandProfile?: (companyId: string) => Promise<BrandProfileRow | null>;
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

  // 2b. Cost guardrails (DailyPlan Day 18): reject oversized content and any
  //     review whose estimated fan-out exceeds the token budget BEFORE spending
  //     on model calls (Rules.md §1 cost discipline; §6 reject bad input with a
  //     specific 4xx). The size cap is the same constant the schema enforces, so
  //     this is defense-in-depth with a clearer message; the token budget guards
  //     the whole five-juror fan-out (content × jurors + overhead).
  const sizeDecision = checkContentSize(parsed.data.content_text);
  if (!sizeDecision.ok) {
    return { ok: false, status: 400, error: sizeDecision.message };
  }

  // 2c. Load the company's stored brand guide (DailyPlan Day 27) and resolve it
  //     to `brand_context` for the Brand Voice Guardian. The company comes from
  //     the server session, never the client (Rules.md §5). Fail open: a read
  //     blip degrades to a brand-less review (the juror infers a baseline)
  //     rather than failing the request, logged with redacted context.
  let brandContext: string | null = null;
  if (deps.getBrandProfile) {
    try {
      const profile = await deps.getBrandProfile(deps.session.companyId);
      brandContext = resolveBrandContext(profile);
    } catch (err) {
      console.error("brand profile read failed (failing open)", {
        op: "createReview",
        companyId: deps.session.companyId,
        message: err instanceof Error ? err.message : "unknown error",
      });
    }
  }
  const brandContextTokens = brandContext ? estimateTokens(brandContext) : 0;

  const budgetDecision = checkTokenBudget({
    contentTokens: estimateTokens(parsed.data.content_text),
    jurorCount: PERSONA_NAMES.length,
    // Brand context is injected into a single juror, so it is counted once.
    brandContextTokens,
  });
  if (!budgetDecision.ok) {
    return { ok: false, status: 400, error: budgetDecision.message };
  }

  // 3. Enforce the per-plan rate limit BEFORE the expensive five-juror fan-out
  //    (Rules.md §1 cost discipline; §6 → 429 with the plan limit + reset time).
  //    The limit is keyed to the plan on the server-resolved company row, never
  //    the client. A usage-read failure fails open (rate limiting is a soft cost
  //    guard, not an authz boundary) but is logged with redacted context.
  if (deps.getRateUsage) {
    const now = new Date();
    const policy = resolveRateLimitPolicy(deps.session.company.plan_tier);
    const since = rateLimitWindowStart(policy, now).toISOString();
    try {
      const usage = await deps.getRateUsage(deps.session.companyId, since);
      const decision = evaluateRateLimit(policy, usage, now);
      if (!decision.allowed) {
        return {
          ok: false,
          status: 429,
          error: rateLimitMessage(decision),
          rateLimit: decision,
        };
      }
    } catch (err) {
      console.error("rate-limit usage read failed (failing open)", {
        op: "createReview",
        companyId: deps.session.companyId,
        message: err instanceof Error ? err.message : "unknown error",
      });
    }
  }

  // 4. Run the five jurors. The company's stored brand guide (loaded above) is
  //    threaded in as brand_context and scoped to the Brand Voice Guardian by
  //    the orchestrator (Day 27). The aggregate honors the company's configured
  //    juror weights (Day 16), resolved from the server session's company row
  //    (never the client — Rules.md §5); an unset/partial/invalid config safely
  //    falls back to equal weights.
  const review = await runReview(
    {
      content_text: parsed.data.content_text,
      content_type: parsed.data.content_type,
      platform: parsed.data.platform,
      brand_context: brandContext,
    },
    {
      client: deps.client,
      weights: resolveWeights(deps.session.company.juror_weights),
    },
  );

  // 5. If every juror failed, don't persist a partial review as complete
  //    (Rules.md §6 — all jurors fail → retryable error, nothing stored).
  const anyOk = review.jurors.some((j) => j.status === "ok");
  if (!anyOk) {
    return {
      ok: false,
      status: 502,
      error: "The review service is temporarily unavailable. Please try again.",
    };
  }

  // 6. Persist tenant-safely: company_id + submitted_by are derived server-side.
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

  // 7. Log the review's estimated usage for cost observability (DailyPlan Day
  //    18). Redacted by construction — only IDs, counts, and derived scores are
  //    logged, never the user's content, the model prompts/outputs, or a secret
  //    (Rules.md §3/§6).
  logReviewUsage(
    estimateReviewUsage(
      parsed.data.content_text,
      PERSONA_NAMES.length,
      brandContextTokens,
    ),
    {
      op: "createReview",
      companyId: deps.session.companyId,
      reviewId: review.review_id,
      model: review.model,
      // `runReview` tags a mock model's name with a "(mock)" suffix, which is
      // accurate whether or not a client was injected (the real client is built
      // inside the orchestrator when none is passed).
      isMock: review.model.includes("(mock)"),
      verdict: review.verdict,
      aggregateScore: review.aggregate_score,
      jurorsOk: review.jurors.filter((j) => j.status === "ok").length,
      jurorsError: review.jurors.filter((j) => j.status === "error").length,
    },
  );

  return { ok: true, status: 201, review };
}
