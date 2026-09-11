"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Copy-to-clipboard button (DailyPlan Day 15 — suggested-rewrite UX). A small
 * client island embedded in the otherwise server-rendered JurorCard so a user
 * can lift a juror's suggested rewrite in one click.
 *
 * Accessibility (Design.md §6): the button has a persistent accessible name and
 * an adjacent `aria-live="polite"` region announces "Copied" without moving
 * focus. If the Clipboard API is unavailable or rejects, it fails quietly to a
 * short "Copy failed" hint (Rules.md §6 — no silent swallow, no crash) so the
 * rewrite text stays selectable by hand.
 */

type CopyState = "idle" | "copied" | "error";

export function CopyButton({
  value,
  label = "Copy rewrite",
}: {
  value: string;
  label?: string;
}) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the pending reset timer on unmount.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const onCopy = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch (err) {
      // Never swallow silently (Rules.md §6); the text is still selectable.
      console.error("copy to clipboard failed", {
        message: err instanceof Error ? err.message : "unknown error",
      });
      setState("error");
    }
    timer.current = setTimeout(() => setState("idle"), 2000);
  }, [value]);

  const status =
    state === "copied"
      ? "Copied to clipboard"
      : state === "error"
        ? "Copy failed — select the text to copy it manually"
        : "";

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onCopy}
        className="rounded-sm border border-border bg-surface px-2.5 py-1 text-xs font-medium text-royal transition-colors hover:border-royal hover:text-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
      >
        {state === "copied" ? "Copied" : state === "error" ? "Copy failed" : label}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {status}
      </span>
    </span>
  );
}
