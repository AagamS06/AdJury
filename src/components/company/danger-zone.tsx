import { DANGER_ZONE_ACTIONS } from "@/lib/company/settings";

/**
 * Danger-zone stubs (DailyPlan Day 50). Scaffolds the destructive company
 * actions (delete all reviews, delete company) without wiring them: each renders
 * as a disabled control with a "coming soon" marker. These touch many tenant
 * tables and need their own cascade + confirmation flow, so they are deliberately
 * inert for now (Rules.md §6 — fail closed; never ship a half-built destructive
 * path). Purely presentational, driven by the pure `DANGER_ZONE_ACTIONS` catalogue.
 *
 * Styled in the Burgundy/Danger family (Design.md §2) because these are
 * destructive actions, but never color-only — each carries its title, a plain
 * description, and a labelled, disabled button (Design.md §6).
 */
export function DangerZone() {
  return (
    <div className="rounded-md border border-danger/30 bg-danger/5 p-6">
      <ul className="space-y-4">
        {DANGER_ZONE_ACTIONS.map((action) => (
          <li
            key={action.key}
            className="flex flex-wrap items-start justify-between gap-3 border-b border-danger/20 pb-4 last:border-b-0 last:pb-0"
          >
            <div className="min-w-0 max-w-xl">
              <p className="font-semibold text-danger">{action.title}</p>
              <p className="mt-0.5 text-sm text-body">{action.description}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-canvas px-2.5 py-0.5 text-xs font-semibold text-muted">
                Coming soon
              </span>
              <button
                type="button"
                disabled
                aria-disabled="true"
                className="rounded-sm border border-danger/40 px-3 py-1.5 text-sm font-semibold text-danger opacity-60 disabled:cursor-not-allowed"
              >
                {action.actionLabel}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
