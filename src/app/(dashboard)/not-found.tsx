import Link from "next/link";

/**
 * Dashboard 404 (DailyPlan Day 13 — states & resilience).
 *
 * The review detail page calls `notFound()` for a review that is absent OR
 * belongs to another company — the two are indistinguishable on purpose, so we
 * never reveal cross-tenant existence (Rules.md §5/§6). This gives that (and any
 * other dashboard 404) an on-brand screen with a way back, rather than Next's
 * bare default.
 */
export default function DashboardNotFound() {
  return (
    <div className="mx-auto max-w-xl rounded-md border border-border bg-surface p-8 text-center shadow-[0_1px_2px_rgba(11,11,15,.06)]">
      <p className="text-sm font-semibold uppercase tracking-wide text-muted">
        Not found
      </p>
      <h1 className="mt-1 text-2xl font-bold text-ink">
        We couldn&apos;t find that page
      </h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-body">
        The review or page you&apos;re looking for doesn&apos;t exist, or
        isn&apos;t available to your company.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link
          href="/history"
          className="inline-block rounded-sm bg-royal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
        >
          Back to history
        </Link>
        <Link
          href="/dashboard"
          className="inline-block rounded-sm border border-navy px-4 py-2 text-sm font-semibold text-navy transition-colors hover:bg-navy hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
        >
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
