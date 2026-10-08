/**
 * Pure helpers for the export UI (DailyPlan Day 41 — Export buttons + download
 * UX on the review/history pages).
 *
 * The download endpoints already exist (Day 36/37/38 serialize; Day 40 adds the
 * per-plan rate limit): `GET /api/reviews/[id]/export?format=csv|pdf` for a
 * single review and `GET /api/reviews/export?format=csv` for the (optionally
 * filtered) history. Day 41 is only the UI that points at them.
 *
 * This module owns the *logic* of that UI — building the hrefs, reading a
 * download filename off a `Content-Disposition` header, and turning a failed
 * response into a plain-language, actionable message (Rules.md §6) — so it is
 * node-testable with no DOM, mirroring the project's "pure core + thin client
 * island" pattern (cf. `history-filter.ts`, `scorecard-view.ts`). The client
 * island in `components/review/export-button.tsx` only wires these to `fetch`
 * and the browser download.
 */

/** Formats a single review can be exported as (history is CSV-only today). */
export type ReviewExportFormat = "csv" | "pdf";

/** The filter query-param keys the history export understands (see history-filter.ts). */
const HISTORY_FILTER_PARAM_KEYS = [
  "content_type",
  "platform",
  "verdict",
  "from",
  "to",
] as const;

/** A download target rendered as one export button. */
export interface ExportTarget {
  /** The download endpoint URL (same-origin, relative). */
  href: string;
  /** The button's accessible label, e.g. "Export CSV". */
  label: string;
  /** Which file this produces (drives the button copy + fallback filename). */
  format: ReviewExportFormat;
  /** Used only if the response omits a `Content-Disposition` filename. */
  fallbackFilename: string;
}

/** Build the single-review download URL for a given format. */
export function reviewExportHref(
  reviewId: string,
  format: ReviewExportFormat,
): string {
  return `/api/reviews/${encodeURIComponent(reviewId)}/export?format=${format}`;
}

/**
 * Build the history (CSV) download URL, forwarding any active history filters so
 * the export matches whatever the history view is currently showing (Day 37's
 * "filtered export matches the view"). Unknown params are not forwarded, and an
 * empty value is dropped, so the URL stays clean and only carries real filters.
 *
 * Accepts either a `URLSearchParams` or a plain record (what a Next.js server
 * component gets as `searchParams`); a repeated param collapses to its first
 * value, matching how the export route reads them.
 */
export function historyExportHref(
  params?: URLSearchParams | Record<string, string | string[] | undefined>,
): string {
  const search = new URLSearchParams();
  search.set("format", "csv");

  if (params) {
    const read = (key: string): string | undefined => {
      if (params instanceof URLSearchParams) {
        return params.get(key) ?? undefined;
      }
      const value = params[key];
      return Array.isArray(value) ? value[0] : value;
    };

    for (const key of HISTORY_FILTER_PARAM_KEYS) {
      const value = read(key);
      if (value !== undefined && value.trim() !== "") {
        search.set(key, value);
      }
    }
  }

  return `/api/reviews/export?${search.toString()}`;
}

/**
 * Extract a download filename from a `Content-Disposition` header value, or
 * `null` if none is present/parseable. Handles the RFC 5987 `filename*` form
 * (percent-decoded) and the plain quoted/unquoted `filename=` form.
 */
export function parseContentDispositionFilename(
  header: string | null | undefined,
): string | null {
  if (!header) return null;

  // Prefer the RFC 5987 extended form, e.g. filename*=UTF-8''adjury-review.csv
  const extended = /filename\*\s*=\s*(?:[^']*'[^']*')?([^;]+)/i.exec(header);
  if (extended) {
    const raw = extended[1].trim().replace(/^["']|["']$/g, "");
    try {
      const decoded = decodeURIComponent(raw);
      if (decoded.trim() !== "") return decoded.trim();
    } catch {
      // Malformed percent-encoding — fall back to the plain form below.
    }
  }

  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header);
  if (plain) {
    const value = (plain[2] ?? plain[1] ?? "").trim().replace(/^["']|["']$/g, "");
    if (value !== "") return value;
  }

  return null;
}

/**
 * Turn a failed export response into a plain-language, actionable message
 * (Rules.md §6). Prefers a server-supplied `error` string for the 429 (it
 * carries the plan limit + reset) and the 400 (bad format); otherwise maps the
 * status to a friendly default. Never surfaces raw status text or internals.
 */
export function exportErrorMessage(
  status: number,
  serverError?: string | null,
): string {
  const trimmed = serverError?.trim();

  switch (status) {
    case 429:
      // The route's message already states the limit and when it resets.
      return (
        trimmed ||
        "You've reached your export limit for now. Please try again a little later."
      );
    case 401:
      return "Your session has expired. Please sign in again to export.";
    case 403:
      return "You don't have permission to export this.";
    case 404:
      return "That review is no longer available to export.";
    case 400:
      return trimmed || "That export request wasn't valid.";
    default:
      if (status >= 500) {
        return "Something went wrong preparing your download. Please try again.";
      }
      return trimmed || "Your download couldn't be prepared. Please try again.";
  }
}
