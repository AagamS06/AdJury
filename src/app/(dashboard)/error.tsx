"use client";

import { useEffect } from "react";

/**
 * Dashboard error boundary (DailyPlan Day 13 — states & resilience).
 *
 * Catches any *unhandled* render/runtime error thrown by a dashboard page
 * (submit, scorecard, history, detail). The pages already map their expected
 * outcomes — 401/404/500, network failures — to explicit UI (Rules.md §6); this
 * is the backstop so an unexpected throw shows a plain-language, actionable
 * screen with a retry instead of a blank crash. Internal detail (the error and
 * its digest) goes to the console only — never to the user, and never any
 * content or secrets (Rules.md §6).
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log for observability; the message may carry internal detail, so it stays
    // out of the UI. (Structured/redacted logging is hardened later — Day 48.)
    console.error("Dashboard render error", {
      digest: error.digest,
      name: error.name,
    });
  }, [error]);

  return (
    <div
      role="alert"
      className="mx-auto max-w-xl rounded-md border border-danger/30 bg-danger/10 p-8 text-center"
    >
      <h1 className="text-2xl font-bold text-ink">Something went wrong</h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-body">
        We couldn&apos;t load this page. This is usually temporary — try again,
        and if it keeps happening, come back in a little while.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 inline-block rounded-sm bg-royal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
      >
        Try again
      </button>
    </div>
  );
}
