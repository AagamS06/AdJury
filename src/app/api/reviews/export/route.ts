import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/auth/supabase-server";
import { listReviewsByCompany } from "@/lib/db/queries";
import {
  historyCsvFilename,
  historyToCsv,
} from "@/lib/reviews/history-csv-export";
import {
  filterReviewSummaries,
  parseHistoryFilters,
} from "@/lib/reviews/history-filter";
import { listReviewsForCompany } from "@/lib/reviews/read-reviews";
import { UTF8_BOM } from "@/lib/reviews/csv";

/**
 * GET /api/reviews/export?format=csv (DailyPlan Day 37 — CSV: history). Streams
 * the company's review history back as a downloadable CSV file, optionally
 * filtered by the same dimensions the history view shows (content type, platform,
 * verdict, date range).
 *
 * Tenant-safe by construction (Rules.md §5), exactly like the history page and
 * GET /api/reviews: the company is taken from the server-resolved session (never
 * the client) and passed explicitly to `listReviewsByCompany`, and the read goes
 * through the request-scoped anon client so RLS is the primary guard. The 401/500
 * mapping lives in the shared `listReviewsForCompany` read core; this handler
 * only wires the real deps, applies the pure filter, serializes, and sets the
 * download headers.
 *
 * "Filtered export matches the view": it reads the *same* set the history page
 * loads (same core, same default page size) and applies the filter to that set,
 * so with no filter the export is the full history view and with a filter it is
 * what a filtered view over that set would show.
 *
 * Only CSV is available today; `format=pdf` is a later day and returns a clear
 * 400. Export-specific authz hardening and rate limiting are Day 40; the export
 * UI (buttons) is Day 41.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  const format = url.searchParams.get("format") ?? "csv";
  if (format !== "csv") {
    return NextResponse.json(
      { error: `Unsupported export format "${format}". Only "csv" is available.` },
      { status: 400 },
    );
  }

  // Fail closed on any session-resolution failure (e.g. missing Supabase env).
  const session = await getSessionContext().catch(() => null);

  const result = await listReviewsForCompany({
    session,
    list: async (companyId, opts) => {
      const db = await createServerSupabase();
      return listReviewsByCompany(db, companyId, opts);
    },
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const filter = parseHistoryFilters(url.searchParams);
  const reviews = filterReviewSummaries(result.reviews, filter);

  const csv = historyToCsv(reviews);
  const filename = historyCsvFilename();

  return new NextResponse(`${UTF8_BOM}${csv}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Tenant data — never cache in a shared/proxy cache.
      "Cache-Control": "no-store",
    },
  });
}
