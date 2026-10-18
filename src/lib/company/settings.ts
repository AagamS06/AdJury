/**
 * Company settings — pure domain pieces (DailyPlan Day 50).
 *
 * The company settings page lets an admin manage the company's plan tier, jump
 * to the brand profile, and (eventually) run destructive "danger zone" actions.
 * This module owns the pure, unit-testable parts — the save input contract and
 * the danger-zone action catalogue — so they need no database or React to test.
 * The DB write lives in `queries.ts`, the decision core in `update-settings.ts`,
 * the server action in `actions.ts`, and the form in
 * `components/company/company-settings-form.tsx`.
 *
 * The plan tier here is a scaffold selection, not a paid entitlement: billing is
 * wired later (PRD §6.3, Week 11). It drives the per-plan review rate limits
 * today (Day 17), so the plan copy reuses `planReviewAllowance` from onboarding.
 */
import { z } from "zod";

/**
 * Company settings input contract (Rules.md §3 — validate before trust). Only
 * the plan tier is editable here today; name/industry/website are set in
 * onboarding (Day 22) and the brand guide in its own admin surface (Day 26).
 * Tenancy (`company_id`) is never part of this — it is derived from the session
 * server-side (Rules.md §5).
 */
export const CompanySettingsSchema = z.object({
  plan_tier: z.enum(["free", "pro", "enterprise"], {
    errorMap: () => ({ message: "Choose a plan." }),
  }),
});

export type CompanySettingsInput = z.infer<typeof CompanySettingsSchema>;

/** First human-readable validation message, for surfacing in the form. */
export function firstSettingsIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the form and try again.";
}

/**
 * Danger-zone action catalogue (DailyPlan Day 50 — "danger zone stubs").
 *
 * Destructive, irreversible company actions. They are deliberately NOT wired in
 * this build: deleting reviews or a whole company touches many tenant tables and
 * needs its own careful cascade + confirmation flow, so it is scaffolded here and
 * the UI renders each as a disabled control with a "coming soon" marker. Keeping
 * the catalogue as pure data lets the page render it and tests assert its shape
 * without pulling in any destructive code path.
 */
export interface DangerZoneAction {
  /** Stable key (also the test/UI identifier). */
  key: string;
  /** Short title of the destructive action. */
  title: string;
  /** Plain-language description of what it would do and that it's irreversible. */
  description: string;
  /** The (currently inert) button label. */
  actionLabel: string;
}

export const DANGER_ZONE_ACTIONS: readonly DangerZoneAction[] = [
  {
    key: "clear_reviews",
    title: "Delete all reviews",
    description:
      "Permanently remove every review and scorecard for this company. This can't be undone.",
    actionLabel: "Delete reviews",
  },
  {
    key: "delete_company",
    title: "Delete company",
    description:
      "Permanently delete this company, its team, and all of its data. This can't be undone.",
    actionLabel: "Delete company",
  },
] as const;
