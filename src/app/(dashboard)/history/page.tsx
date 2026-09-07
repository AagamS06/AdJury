import Link from "next/link";
import { HistoryList } from "@/components/review/history-list";
import { requireSession } from "@/lib/auth/guard";
import { getSessionContext } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/auth/supabase-server";
import { listReviewsByCompany } from "@/lib/db/queries";
import { listReviewsForCompany } from "@/lib/reviews/read-reviews";

/**
 * Review history page (DailyPlan Day 11): the company's past reviews (date,
 * aggregate score, verdict), newest first, each linking to its detail page.
 *
 * Tenant-safe by construction (Rules.md §5): `requireSession()` gates the page
 * and the company is taken from the server-resolved session — never the client
 * — and passed explicitly to `listReviewsByCompany`. The read goes through the
 * request-scoped anon client so RLS is the primary tenancy guard, mirroring the
 * Day 6 GET /api/reviews endpoint (same `listReviewsForCompany` core). A load
 * failure surfaces a plain-language message rather than crashing (Rules.md §6).
 */
export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  await requireSession();

  // Re-resolve for the core (which owns the 401/500 mapping); the guard above
  // has already redirected any unauthenticated caller, so this is non-null here.
  const session = await getSessionContext().catch(() => null);

  const result = await listReviewsForCompany({
    session,
    list: async (companyId, opts) => {
      const db = await createServerSupabase();
      return listReviewsByCompany(db, companyId, opts);
    },
  });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-ink">Review history</h1>
          <p className="mt-2 max-w-2xl text-body">
            Every review your company has run, newest first. Select one to see
            the full scorecard.
          </p>
        </div>
        <Link
          href="/review"
          className="shrink-0 rounded-sm bg-royal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
        >
          New review
        </Link>
      </div>

      <div className="mt-8">
        {result.ok ? (
          <HistoryList reviews={result.reviews} />
        ) : (
          <p
            role="alert"
            className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
          >
            {result.error}
          </p>
        )}
      </div>
    </div>
  );
}
