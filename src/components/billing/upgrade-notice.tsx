import Link from "next/link";
import {
  featureMeta,
  type PlanFeature,
} from "@/lib/billing/entitlements";
import { planTierLabel } from "@/lib/billing/feature-gate";

/**
 * Upgrade notice (DailyPlan Day 75 — Plan gating). A small, on-brand, purely
 * presentational panel shown where a plan-gated feature would be — the analytics
 * dashboard for a plan that doesn't include it, for example. It explains which
 * plan unlocks the feature and links to `/pricing`, turning a hard gate into an
 * upsell rather than a dead end.
 *
 * Server component (no interactivity) so it drops into a server-rendered page
 * with no client bundle cost. It reads the feature's label/description and its
 * unlock tier from the feature ladder (`entitlements.ts`), so the copy can't
 * drift from what the gate enforces or what the pricing page shows.
 *
 * Accessibility (Design.md §6): the panel is a labelled region, meaning never
 * rides on colour alone (the plan name is text, and the lock mark is a drawn,
 * `aria-hidden` SVG — not an emoji/dingbat, so the Day-65 chrome audit stays
 * clean), and the CTA is a real link with a visible focus ring.
 */
export function UpgradeNotice({
  feature,
  headingId = "upgrade-notice-heading",
}: {
  feature: PlanFeature;
  /** Unique heading id when more than one notice renders on a page. */
  headingId?: string;
}) {
  const meta = featureMeta(feature);
  const label = meta?.label ?? "This feature";
  const tierLabel = meta ? planTierLabel(meta.unlockedBy) : "a paid";
  const description =
    meta?.description ?? "Upgrade your plan to unlock this feature.";

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-md border border-royal/20 bg-royal/5 p-8 text-center shadow-card"
    >
      <span className="inline-flex items-center gap-1.5 rounded-full bg-royal/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-royal">
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <rect x="3.5" y="7" width="9" height="6.5" rx="1.25" />
          <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
        </svg>
        {tierLabel} plan
      </span>
      <h2
        id={headingId}
        className="mt-4 text-lg font-semibold text-navy"
      >
        {label} is a {tierLabel}-plan feature
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-body">
        {description} Upgrade to the {tierLabel} plan to unlock it.
      </p>
      <Link
        href="/pricing"
        className="mt-5 inline-block rounded-sm bg-royal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
      >
        View plans
      </Link>
    </section>
  );
}
