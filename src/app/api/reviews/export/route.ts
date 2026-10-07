import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/auth/supabase-server";
import { listReviewsByCompany } from "@/lib/db/queries";
import {
  checkExportRateLimit,
  exportRateLimitHeaders,
} from "@/lib/reviews/export-access";
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
 * 400. The export UI (buttons) is Day 41.
 *
 * Export authz hardening + rate limiting (DailyPlan Day 40): authenticated
 * callers are additionally subject to a per-plan export rate limit (a cost/abuse
 * guard — Rules.md §1) enforced before the read/serialize work; exceeding it
 * returns 429 with the limit + reset info. An unauthenticated caller still falls
 * through to the read core's 401. See `export-access.ts`.
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

  // Day 40: per-plan export rate limit, enforced before the read/serialize work.
  // Only meaningful for an authenticated caller — an anon request falls through
  // to the read core's 401 below (no point consuming a company's slot for it).
  if (session) {
    const limited = checkExportRateLimit({ session });
    if (!limited.ok) {
      return NextResponse.json(
        { error: limited.error, ...limited.rateLimit },
        { status: 429, headers: exportRateLimitHeaders(limited.rateLimit) },
      );
    }
  }

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
