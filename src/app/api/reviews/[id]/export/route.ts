import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/auth/supabase-server";
import { getReviewById } from "@/lib/db/queries";
import {
  reviewCsvFilename,
  reviewToCsv,
  UTF8_BOM,
} from "@/lib/reviews/csv-export";
import {
  checkExportRateLimit,
  exportRateLimitHeaders,
} from "@/lib/reviews/export-access";
import { reviewPdfFilename, reviewToPdf } from "@/lib/reviews/pdf-export";
import { getReviewForCompany } from "@/lib/reviews/read-reviews";

/**
 * GET /api/reviews/[id]/export?format=csv|pdf (DailyPlan Day 36 — CSV: single
 * review; Day 38 — PDF: single review). Streams one persisted review back as a
 * downloadable CSV or PDF file.
 *
 * Tenant-safe by construction (Rules.md §5), exactly like GET /api/reviews/[id]:
 * the company is taken from the server-resolved session (never the URL/client)
 * and passed explicitly to `getReviewById`, and the read goes through the
 * request-scoped anon client so RLS is the primary guard. A review that is
 * absent or belongs to another company reads as 404 (never reveal cross-tenant
 * existence — Rules.md §6). The composition, tenancy, and error mapping all live
 * in `getReviewForCompany`; this handler only wires the real deps, serializes
 * the chosen format, and sets the download headers.
 *
 * `format` defaults to csv; any other value returns a clear 400.
 *
 * Export authz hardening + rate limiting (DailyPlan Day 40): authenticated
 * callers are additionally subject to a per-plan export rate limit (a cost/abuse
 * guard — Rules.md §1) enforced before the read/serialize work; exceeding it
 * returns 429 with the limit + reset info. An unauthenticated caller still falls
 * through to the read core's 401, and cross-tenant access is still the read
 * core's 404 — see `export-access.ts` for why export mirrors read access.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPPORTED_FORMATS = ["csv", "pdf"] as const;
type ExportFormat = (typeof SUPPORTED_FORMATS)[number];

function isSupportedFormat(value: string): value is ExportFormat {
  return (SUPPORTED_FORMATS as readonly string[]).includes(value);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  const format = new URL(request.url).searchParams.get("format") ?? "csv";
  if (!isSupportedFormat(format)) {
    return NextResponse.json(
      {
        error: `Unsupported export format "${format}". Supported formats: ${SUPPORTED_FORMATS.join(", ")}.`,
      },
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

  if (format === "pdf") {
    const pdf = reviewToPdf(result.review);
    const filename = reviewPdfFilename(result.review);
    // ASCII-only PDF string → latin1 bytes so the xref offsets stay byte-exact.
    return new NextResponse(Buffer.from(pdf, "latin1"), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        // Tenant data — never cache in a shared/proxy cache.
        "Cache-Control": "no-store",
      },
    });
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
