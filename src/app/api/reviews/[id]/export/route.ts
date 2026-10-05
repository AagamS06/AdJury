import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/auth/supabase-server";
import { getReviewById } from "@/lib/db/queries";
import {
  reviewCsvFilename,
  reviewToCsv,
  UTF8_BOM,
} from "@/lib/reviews/csv-export";
import { getReviewForCompany } from "@/lib/reviews/read-reviews";

/**
 * GET /api/reviews/[id]/export?format=csv (DailyPlan Day 36 — CSV: single
 * review). Streams one persisted review back as a downloadable CSV file.
 *
 * Tenant-safe by construction (Rules.md §5), exactly like GET /api/reviews/[id]:
 * the company is taken from the server-resolved session (never the URL/client)
 * and passed explicitly to `getReviewById`, and the read goes through the
 * request-scoped anon client so RLS is the primary guard. A review that is
 * absent or belongs to another company reads as 404 (never reveal cross-tenant
 * existence — Rules.md §6). The composition, tenancy, and error mapping all live
 * in `getReviewForCompany`; this handler only wires the real deps, serializes
 * the CSV, and sets the download headers.
 *
 * Only CSV is available today; `format=pdf` (Day 38) returns a clear 400.
 * Export-specific authz hardening and rate limiting are Day 40.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  const format = new URL(request.url).searchParams.get("format") ?? "csv";
  if (format !== "csv") {
    return NextResponse.json(
      { error: `Unsupported export format "${format}". Only "csv" is available.` },
      { status: 400 },
    );
  }

  // Fail closed on any session-resolution failure (e.g. missing Supabase env).
  const session = await getSessionContext().catch(() => null);

  const result = await getReviewForCompany(id, {
    session,
    fetch: async (reviewId, companyId) => {
      const db = await createServerSupabase();
      return getReviewById(db, reviewId, companyId);
    },
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const csv = reviewToCsv(result.review);
  const filename = reviewCsvFilename(result.review);

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
