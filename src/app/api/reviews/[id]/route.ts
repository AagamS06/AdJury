import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/auth/supabase-server";
import { getSessionContext } from "@/lib/auth/session";
import { getReviewById } from "@/lib/db/queries";
import { getReviewForCompany } from "@/lib/reviews/read-reviews";

/**
 * GET /api/reviews/[id] (DailyPlan Day 6).
 *
 * Returns one persisted review reconstructed from its `reviews` +
 * `persona_scores` rows, scoped to the caller's company. The read goes through
 * the request-scoped anon client (RLS applies) with the session's companyId
 * also passed explicitly; a row that is absent or belongs to another company
 * reads as 404 so we never reveal cross-tenant existence (Rules.md §5, §6).
 * The composition + error mapping live in `getReviewForCompany`; this handler
 * only wires the real dependencies and maps the outcome to an HTTP response.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  // Fail closed on any session-resolution failure (e.g. missing Supabase env).
  const session = await getSessionContext().catch(() => null);

  const result = await getReviewForCompany(id, {
    session,
    fetch: async (reviewId, companyId) => {
      const db = await createServerSupabase();
      return getReviewById(db, reviewId, companyId);
    },
  });

  if (result.ok) {
    return NextResponse.json(result.review, { status: result.status });
  }
  return NextResponse.json({ error: result.error }, { status: result.status });
}
