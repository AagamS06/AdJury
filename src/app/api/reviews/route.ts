import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/session";
import { insertReviewWithScores } from "@/lib/db/queries";
import { serverClient } from "@/lib/db/supabase";
import { createReview } from "@/lib/reviews/create-review";

/**
 * POST /api/reviews (DailyPlan Day 5).
 *
 * Zod-validates the body, runs the five-juror orchestrator, persists the
 * review + persona_scores tenant-safely, and returns the composed
 * `ReviewResult`. Identity (`company_id` / `submitted_by`) is derived from the
 * server session, never the request body (Rules.md §5). The orchestration and
 * error mapping live in `createReview`; this handler only wires the real
 * dependencies and translates the outcome to an HTTP response.
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
