import Link from "next/link";
import {
  FIRST_RUN_HEADING,
  FIRST_RUN_INTRO,
  type GettingStartedProgress,
  type GettingStartedStep,
} from "@/lib/onboarding/first-run";

/**
 * Getting-started panel (DailyPlan Day 66, first-run experience). A thin,
 * presentational server component that renders the pure checklist from
 * `lib/onboarding/first-run.ts` — which steps apply, their order, and whether
 * each is already done are owned and tested there; this file only lays them out
 * on brand (Design.md: Navy/white, Royal-Blue accent, borders over heavy
 * shadows, the H2/H3 type scale).
 *
 * It is shown on the dashboard home only while the user is new (the page calls
 * `shouldShowFirstRun`), so a new user sees "what to do first" before the
 * activity dashboard has anything to summarise (Day-66 DoD).
 *
 * Accessibility (Design.md §6): a labelled region with a single `<h2>`; the
 * steps are an `<ol>` so sequence is conveyed structurally (the leading marker
 * is decorative, `aria-hidden`); each step's status is a **text** badge ("Done"
 * / "To do"), never colour alone; every CTA is a real link with the app's
 * standard focus ring.
 */
export function GettingStarted({
  steps,
  progress,
}: {
  steps: GettingStartedStep[];
  progress: GettingStartedProgress;
}) {
  // Defensive: with no applicable steps there is nothing to guide (the page
  // already gates on `shouldShowFirstRun`, so this is belt-and-braces).
  if (steps.length === 0) return null;

  return (
    <section
      aria-labelledby="getting-started-heading"
      className="rounded-md border border-royal/30 bg-surface p-6 shadow-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="getting-started-heading"
            className="text-xl font-semibold text-navy"
          >
            {FIRST_RUN_HEADING}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-body">{FIRST_RUN_INTRO}</p>
        </div>
        <p className="shrink-0 rounded-sm bg-royal/10 px-3 py-1 text-xs font-semibold tabular-nums text-royal">
          {progress.completed} of {progress.total} complete
        </p>
      </div>

      <ol className="mt-6 space-y-3">
        {steps.map((step, index) => (
          <li
            key={step.key}
            className="flex flex-wrap items-start gap-4 rounded-md border border-border bg-canvas p-4"
          >
            {/* Decorative marker: a checkmark when done, else the step number.
                The <ol> already conveys order/position to assistive tech, and a
                drawn SVG (not a unicode dingbat) keeps the chrome emoji-free
                (Design.md §7). */}
            <span
              aria-hidden="true"
              className={
                step.done
                  ? "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success/10 text-sm font-semibold text-success-deep"
                  : "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-royal/10 text-sm font-semibold text-royal"
              }
            >
              {step.done ? (
                <svg
                  viewBox="0 0 20 20"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 10.5l4 4 8-9" />
                </svg>
              ) : (
                index + 1
              )}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h3 className="text-base font-semibold text-navy">
                  {step.title}
                </h3>
                <StatusBadge done={step.done} />
              </div>
              <p className="mt-1 text-sm text-body">{step.description}</p>
            </div>

            <div className="shrink-0">
              <Link
                href={step.href}
                className={
                  step.done
                    ? "inline-block rounded-sm border border-border px-4 py-2 text-sm font-semibold text-navy transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
                    : "inline-block rounded-sm bg-royal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
                }
              >
                {step.done ? "Revisit" : step.cta}
                <span className="sr-only"> — {step.title}</span>
              </Link>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** A text status badge for a step (never colour-only — Design.md §6). */
function StatusBadge({ done }: { done: boolean }) {
  return done ? (
    <span className="rounded-sm bg-success/10 px-2 py-0.5 text-xs font-semibold text-success-deep">
      Done
    </span>
  ) : (
    <span className="rounded-sm bg-border px-2 py-0.5 text-xs font-semibold text-muted">
      To do
    </span>
  );
}
