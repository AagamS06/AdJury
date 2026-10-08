"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ExportTarget } from "@/lib/reviews/export-ui";
import {
  exportErrorMessage,
  parseContentDispositionFilename,
} from "@/lib/reviews/export-ui";

/**
 * Export buttons (DailyPlan Day 41 — Export UI). A small client island embedded
 * in the otherwise server-rendered review-detail and history pages so a user can
 * download a review (CSV/PDF) or their history (CSV) in one click. Points at the
 * existing Day 36/37/38 download routes (Day 40 adds the per-plan rate limit).
 *
 * Download UX: each button is a real `<a href>` to its download route, so a
 * click still works before hydration / with JS disabled (the route sets
 * `Content-Disposition: attachment`, so the browser downloads rather than
 * navigates). Once hydrated, the click is intercepted and the file is fetched as
 * a blob and saved via a temporary object-URL anchor — which lets us show a
 * progress state and, crucially, turn a failed response (e.g. a 429 rate limit)
 * into a plain-language inline message (Rules.md §6) instead of navigating the
 * user to raw error JSON.
 *
 * Accessibility (Design.md §6): buttons carry a persistent visible label and
 * `aria-busy` while downloading; a polite `role="status"` region announces
 * "Preparing…" / "Downloaded <file>" without moving focus, and a failure shows
 * in a visible `role="alert"`. Meaning never rides on colour alone — the error
 * is text. Logic (hrefs, filename parsing, error copy) lives in the pure
 * `export-ui.ts` core so this island stays thin.
 */

/** How long a success/idle announcement lingers before clearing. */
const STATUS_RESET_MS = 4000;

export function ExportButtons({
  targets,
  groupLabel,
}: {
  targets: ExportTarget[];
  /** Accessible label for the button group, e.g. "Export this review". */
  groupLabel: string;
}) {
  // The href currently downloading (null = idle). Keyed by href so two formats
  // can each show their own in-flight state.
  const [busyHref, setBusyHref] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const scheduleStatusReset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (mounted.current) setStatus("");
    }, STATUS_RESET_MS);
  }, []);

  const onExport = useCallback(
    async (target: ExportTarget) => {
      if (busyHref) return; // One download at a time.
      if (timer.current) clearTimeout(timer.current);
      setError(null);
      setBusyHref(target.href);
      setStatus(`Preparing ${target.format.toUpperCase()} download…`);

      try {
        const res = await fetch(target.href, {
          // Same-origin cookie session; never cache tenant data.
          credentials: "same-origin",
          cache: "no-store",
        });

        if (!res.ok) {
          let serverError: string | null = null;
          try {
            const body = (await res.json()) as { error?: unknown };
            if (typeof body?.error === "string") serverError = body.error;
          } catch {
            // Non-JSON error body — fall back to a status-based message.
          }
          if (!mounted.current) return;
          setStatus("");
          setError(exportErrorMessage(res.status, serverError));
          return;
        }

        const blob = await res.blob();
        const filename =
          parseContentDispositionFilename(
            res.headers.get("Content-Disposition"),
          ) ?? target.fallbackFilename;

        // Trigger the save via a temporary object-URL anchor.
        const objectUrl = URL.createObjectURL(blob);
        try {
          const a = document.createElement("a");
          a.href = objectUrl;
          a.download = filename;
          a.rel = "noopener";
          document.body.appendChild(a);
          a.click();
          a.remove();
        } finally {
          URL.revokeObjectURL(objectUrl);
        }

        if (!mounted.current) return;
        setStatus(`Downloaded ${filename}`);
        scheduleStatusReset();
      } catch (err) {
        // Network / unexpected failure — never swallow silently (Rules.md §6).
        console.error("export download failed", {
          format: target.format,
          message: err instanceof Error ? err.message : "unknown error",
        });
        if (!mounted.current) return;
        setStatus("");
        setError(exportErrorMessage(0));
      } finally {
        if (mounted.current) setBusyHref(null);
      }
    },
    [busyHref, scheduleStatusReset],
  );

  return (
    <div className="flex flex-col items-end gap-2">
      <div
        role="group"
        aria-label={groupLabel}
        className="flex flex-wrap items-center gap-2"
      >
        {targets.map((target) => {
          const isBusy = busyHref === target.href;
          const disabled = busyHref !== null;
          return (
            <a
              key={target.href}
              href={target.href}
              download={target.fallbackFilename}
              aria-busy={isBusy}
              aria-disabled={disabled}
              onClick={(event) => {
                // Progressive enhancement: let the plain navigation happen if
                // JS can't (e.g. not hydrated). Here we have JS, so intercept.
                event.preventDefault();
                void onExport(target);
              }}
              className={`inline-flex items-center gap-2 rounded-sm border border-navy px-4 py-2 text-sm font-semibold text-navy transition-colors hover:bg-navy hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright ${
                disabled ? "pointer-events-none opacity-60" : ""
              }`}
            >
              {isBusy ? `Preparing ${target.format.toUpperCase()}…` : target.label}
            </a>
          );
        })}
      </div>

      <span role="status" aria-live="polite" className="sr-only">
        {status}
      </span>

      {error && (
        <p
          role="alert"
          className="max-w-xs rounded-sm border border-danger/30 bg-danger/10 px-3 py-2 text-right text-xs text-danger"
        >
          {error}
        </p>
      )}
    </div>
  );
}
