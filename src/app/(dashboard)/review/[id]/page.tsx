import Link from "next/link";
import { notFound } from "next/navigation";
import { Scorecard } from "@/components/review/scorecard";
import { requireSession } from "@/lib/auth/guard";
import { getSessionContext } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/auth/supabase-server";
import { getReviewById } from "@/lib/db/queries";
import { getReviewForCompany } from "@/lib/reviews/read-reviews";
import { reviewDetailState } from "@/lib/reviews/review-detail-view";

/**
 * Review detail page (DailyPlan Day 12): reconstructs a persisted review's full
 * scorecard from stored `reviews` + `persona_scores`. This is the target of the
 * Day 11 history-row links (`/review/[id]`).
 *
 * Tenant-safe by construction (Rules.md §5), exactly like GET /api/reviews/[id]:
 * `requireSession()` gates the page and the company is taken from the
 * server-resolved session — never the URL/client — and passed explicitly to
 * `getReviewById`. The read goes through the request-scoped anon client so RLS
 * is the primary tenancy guard. A review that is absent or belongs to another
 * company reads as 404 (Rules.md §6 — never reveal cross-tenant existence); a
 * transient load failure shows a retry message instead. Both the composition and
 * that mapping live in `getReviewForCompany`; the page only wires the real deps
 * and turns the outcome into UI via the pure `reviewDetailState`.
 */
export const dynamic = "force-dynamic";

export default async function ReviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { id } = await params;

  // Re-resolve for the core (which owns the 401/404/500 mapping); the guard
  // above has already redirected any unauthenticated caller.
  const session = await getSessionContext().catch(() => null);

  const result = await getReviewForCompany(id, {
    session,
    fetch: async (reviewId, companyId) => {
      const db = await createServerSupabase();
      return getReviewById(db, reviewId, companyId);
    },
  });

  const state = reviewDetailState(result);

  // Absent / other-company / unauthenticated all render an honest 404 so we
  // never reveal whether the id exists for another tenant (Rules.md §5/§6).
  if (state.kind === "not-found") {
    notFound();
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-ink">Review</h1>
          <p className="mt-2 max-w-2xl text-body">
            The full scorecard for this review, reconstructed from your saved
            results.
          </p>
        </div>
        <Link
          href="/history"
          className="shrink-0 rounded-sm border border-navy px-4 py-2 text-sm font-semibold text-navy transition-colors hover:bg-navy hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
        >
          Back to history
        </Link>
      </div>

      <div className="mt-8">
        {state.kind === "review" ? (
          <Scorecard
            aggregateScore={state.review.aggregate_score}
            verdict={state.review.verdict}
            jurors={state.review.jurors}
            contentType={state.review.content_type}
            platform={state.review.platform}
            createdAt={state.review.created_at}
          />
        ) : (
          <p
            role="alert"
            className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
          >
            {state.message}
          </p>
        )}
      </div>
    </div>
  );
}
