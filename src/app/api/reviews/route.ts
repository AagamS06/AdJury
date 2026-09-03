import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/auth/supabase-server";
import { getSessionContext } from "@/lib/auth/session";
import { insertReviewWithScores, listReviewsByCompany } from "@/lib/db/queries";
import { serverClient } from "@/lib/db/supabase";
import { createReview } from "@/lib/reviews/create-review";
import { listReviewsForCompany } from "@/lib/reviews/read-reviews";

/**
 * POST /api/reviews (DailyPlan Day 5) and GET /api/reviews (DailyPlan Day 6).
 *
 * POST Zod-validates the body, runs the five-juror orchestrator, persists the
 * review + persona_scores tenant-safely, and returns the composed
 * `ReviewResult`. Identity (`company_id` / `submitted_by`) is derived from the
 * server session, never the request body (Rules.md §5). The orchestration and
 * error mapping live in `createReview`; this handler only wires the real
 * dependencies and translates the outcome to an HTTP response.
 *
 * GET lists the caller's company reviews (newest first) for the history view,
 * scoped to their company via the session + RLS (`listReviewsForCompany`).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  // Resolve the session server-side; treat any failure (e.g. missing Supabase
  // env) as "not signed in" so the endpoint fails closed rather than crashing.
  const session = await getSessionContext().catch(() => null);

  const result = await createReview(body, {
    session,
    // The write path uses the service-role client and an explicit company_id
    // (persona_scores has no client INSERT policy). Constructed lazily so an
    // unauthenticated request never touches the service-role env.
    persist: (params) => insertReviewWithScores(serverClient(), params),
  });

  if (result.ok) {
    return NextResponse.json(result.review, { status: result.status });
  }
  return NextResponse.json({ error: result.error }, { status: result.status });
}

export async function GET(request: Request): Promise<Response> {
  // Fail closed on any session-resolution failure (e.g. missing Supabase env).
  const session = await getSessionContext().catch(() => null);

  const limitParam = new URL(request.url).searchParams.get("limit");
  const limit =
    limitParam !== null && limitParam.trim() !== ""
      ? Number(limitParam)
      : undefined;

  // The read goes through the request-scoped anon client so RLS constrains it
  // to the caller's company; the session's companyId is also passed explicitly
  // as a second layer. Constructed lazily so an unauthenticated request never
  // touches Supabase.
  const result = await listReviewsForCompany({
    session,
    limit,
    list: async (companyId, opts) => {
      const db = await createServerSupabase();
      return listReviewsByCompany(db, companyId, opts);
    },
  });

  if (result.ok) {
    return NextResponse.json({ reviews: result.reviews }, { status: result.status });
  }
  return NextResponse.json({ error: result.error }, { status: result.status });
}
