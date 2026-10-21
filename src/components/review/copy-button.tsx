"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { logError, errorContext } from "@/lib/observability/logger";
import { useToast } from "@/components/ui/toast";

/**
 * Copy-to-clipboard button (DailyPlan Day 15 — suggested-rewrite UX). A small
 * client island embedded in the otherwise server-rendered JurorCard so a user
 * can lift a juror's suggested rewrite in one click.
 *
 * Accessibility (Design.md §6): the button has a persistent accessible name and
 * the outcome is announced through the app-wide toast layer (Day 53) — a polite
 * "Copied to clipboard" or an assertive "Copy failed" — so feedback is
 * consistent with the rest of the app and no bespoke live region is needed here.
 * If the Clipboard API is unavailable or rejects, it fails to a short "Copy
 * failed" label + toast (Rules.md §6 — no silent swallow, no crash) and the
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
  const { notify } = useToast();
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
      notify({ tone: "success", title: "Copied to clipboard" });
    } catch (err) {
      // Never swallow silently (Rules.md §6); the text is still selectable.
      logError("copy to clipboard failed", {
        op: "CopyButton",
        ...errorContext(err),
      });
      setState("error");
      notify({
        tone: "error",
        title: "Copy failed",
        message: "Select the text to copy it manually.",
      });
    }
    timer.current = setTimeout(() => setState("idle"), 2000);
  }, [value, notify]);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onCopy}
        className="rounded-sm border border-border bg-surface px-2.5 py-1 text-xs font-medium text-royal transition-colors hover:border-royal hover:text-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
      >
        {state === "copied" ? "Copied" : state === "error" ? "Copy failed" : label}
      </button>
    </span>
  );
}
