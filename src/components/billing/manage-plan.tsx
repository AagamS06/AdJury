"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/ui/toast";
import type {
  CheckoutNotice,
  ManagePlanTone,
  ManagePlanView,
} from "@/lib/billing/manage-plan";

/**
 * Manage-plan panel (DailyPlan Day 76 — Billing settings, Week 11). A thin client
 * island over the pure `buildManagePlanView` core: the server page computes the
 * view model (and the checkout-return notice from the URL) and hands them here as
 * serializable props; this component only renders the state and drives the
 * (test-mode) checkout button.
 *
 * Starting a subscription is `POST /api/billing/checkout` (Day 74), which is
 * admin-only and returns the hosted (or offline-mock) Checkout URL to redirect
 * to. The button is the convenience affordance; the real authorization and the
 * "is checkout configured" check are enforced server-side (Rules.md §5) — this UI
 * disables the button when `checkoutReady` is false and never fabricates a flow.
 *
 * Accessibility (Design.md §6): the status is a text label (never colour alone),
 * the upgrade error announces via `role="alert"`, and the button carries a busy
 * state. The checkout-return notice is surfaced through the app toast layer.
 */

/** Status-line text colour per tone — deep success/warning tokens stay AA on any
 * light surface (Day 55 contrast pass); neutral is body text. */
const TONE_TEXT: Record<ManagePlanTone, string> = {
  neutral: "text-body",
  success: "text-success-deep",
  warning: "text-warning-deep",
  danger: "text-danger",
};

export function ManagePlan({
  view,
  notice,
}: {
  view: ManagePlanView;
  notice: CheckoutNotice | null;
}) {
  const { notify } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noticeShown = useRef(false);

  // Surface the checkout-return notice once, then strip the `?checkout=` param so
  // a refresh doesn't replay it (the state itself arrives via the webhook).
  useEffect(() => {
    if (!notice || noticeShown.current) return;
    noticeShown.current = true;
    notify({ tone: notice.tone, title: notice.title, message: notice.message });
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [notice, notify]);

  async function startCheckout() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/billing/checkout", { method: "POST" });
      const data = (await res.json().catch(() => null)) as
        | { url?: string; error?: string }
        | null;
      if (res.ok && data?.url) {
        // Hand off to the hosted (or offline-mock) Checkout page.
        window.location.assign(data.url);
        return;
      }
      const message =
        data?.error ?? "We couldn't start checkout. Please try again.";
      setError(message);
      notify({ tone: "error", title: "Checkout didn't start", message });
      setSubmitting(false);
    } catch {
      const message = "We couldn't start checkout. Please try again.";
      setError(message);
      notify({ tone: "error", title: "Checkout didn't start", message });
      setSubmitting(false);
    }
  }

  return (
    <div>
      {/* Current plan + status */}
      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted">Current plan</dt>
          <dd className="mt-0.5 font-medium text-body">
            {view.planName}{" "}
            <span className="font-normal text-muted">· {view.priceLabel}</span>
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">Subscription</dt>
          <dd className={`mt-0.5 font-semibold ${TONE_TEXT[view.statusTone]}`}>
            {view.statusLabel}
          </dd>
        </div>
      </dl>

      <p className="mt-4 text-sm text-body">{view.statusDescription}</p>
      {view.periodNote ? (
        <p className="mt-1 text-sm text-muted">{view.periodNote}</p>
      ) : null}

      {/* Upgrade (start checkout) affordance */}
      {view.showUpgrade ? (
        <div className="mt-6 border-t border-border pt-5">
          <FormAlert message={error} />
          <button
            type="button"
            onClick={startCheckout}
            disabled={submitting || !view.checkoutReady}
            aria-busy={submitting}
            className="rounded-sm bg-royal px-4 py-2 font-semibold text-white transition-colors hover:bg-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Starting checkout…" : view.upgradeLabel}
          </button>
          {view.trialNote ? (
            <p className="mt-2 text-sm text-muted">{view.trialNote}</p>
          ) : null}
          {view.configNote ? (
            <p className="mt-2 text-sm text-muted">{view.configNote}</p>
          ) : null}
          <p className="mt-3 text-sm text-muted">
            Compare plans on the{" "}
            <Link
              href="/pricing"
              className="font-semibold text-royal hover:text-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
            >
              pricing page
            </Link>
            .
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** Inline, assertive error line for the checkout action (Design.md §6). */
function FormAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="mb-4 text-sm font-medium text-danger">
      {message}
    </p>
  );
}
