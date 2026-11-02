/**
 * First-run experience — pure logic core (DailyPlan Day 66).
 *
 * A brand-new user lands on the dashboard with nothing to show: no reviews, and
 * (for a new admin) no brand voice or teammates yet. The Day-52 dashboard home
 * summarises *activity*, which for a new account is empty — so it answers "what
 * has my company done?" but not "what should I do first?". This module owns the
 * answer to the second question: an ordered, role-aware getting-started
 * checklist that points a new user at the concrete first actions.
 *
 * Kept out of the React layer — like `dashboard-view.ts` / `landing.ts` /
 * `nav.ts` — so the guidance (which steps, in what order, and whether each is
 * already done) is unit-testable in the node env with no DOM, bundler, or
 * credential. The thin server component in
 * `components/onboarding/getting-started.tsx` only renders these values, and the
 * dashboard page computes the input state from tenant-safe reads it already does
 * (plus a brand/team read for admins) and shows the panel while the user is new.
 *
 * Honesty (Rules.md §6): a step is only ever marked `done` from a real signal —
 * a review that actually ran, a brand guide that actually has text, a teammate
 * who has actually joined. When a signal can't be read it stays `not done`
 * (which invites the action) rather than being fabricated as complete.
 */

import type { UserRole } from "@/types/db";

/**
 * The company/user state the getting-started checklist is derived from. All
 * fields are already-resolved facts (never client input): the page computes them
 * from the session role and the reads it does server-side.
 */
export interface FirstRunState {
  /** The signed-in user's role; members see only the steps they can act on. */
  role: UserRole;
  /** How many reviews the company has ever run (from the Day-31 analytics). */
  totalReviews: number;
  /**
   * Whether the company has a usable brand guide (non-empty tone guide). Only
   * meaningful for an admin — a member can't edit it, so the brand step is
   * filtered out for them regardless of this value.
   */
  hasBrandProfile: boolean;
  /**
   * How many members the company has, when known. `undefined` means the count
   * couldn't be read (e.g. the read failed, or the caller is a member and never
   * fetched it); the team step then stays "not done" rather than guessing.
   */
  teamMemberCount?: number;
}

/** One actionable step in the getting-started checklist. */
export interface GettingStartedStep {
  /** Stable key for React lists and tests. */
  key: string;
  /** A few words naming the action. */
  title: string;
  /** One plain sentence on why it matters / what it does. */
  description: string;
  /** Destination (an existing in-app route; no trailing slash). */
  href: string;
  /** Visible, action-first button label. */
  cta: string;
  /** Whether this step is already satisfied (shown checked, de-emphasised). */
  done: boolean;
  /** Admin-only steps are never shown to a member (they can't act on them). */
  adminOnly: boolean;
}

/** Progress across the steps that apply to this user. */
export interface GettingStartedProgress {
  /** How many applicable steps are already done. */
  completed: number;
  /** How many steps apply to this user (after role filtering). */
  total: number;
  /** True when every applicable step is done. */
  allDone: boolean;
}

/** Heading + intro for the getting-started panel (copy lives here, not the UI). */
export const FIRST_RUN_HEADING = "Get started with AdJury";
export const FIRST_RUN_INTRO =
  "A few quick steps to get the most out of your reviews. Nothing publishes on its own — you stay in control.";

/**
 * The canonical getting-started steps, in display order, with each step's
 * `done` resolved from the real state. The order is deliberate: run a review
 * first (the core value, and the one step every user can do), then the two
 * admin setup actions that make later reviews sharper. Use `buildGettingStarted`
 * for the role-filtered list the UI renders.
 */
function allSteps(state: FirstRunState): GettingStartedStep[] {
  const hasTeammates =
    state.teamMemberCount !== undefined && state.teamMemberCount > 1;

  return [
    {
      key: "run-first-review",
      title: "Run your first review",
      description:
        "Paste your ad copy or upload a creative — the six jurors score it, flag risks, and suggest rewrites in one pass.",
      href: "/review",
      cta: "Start a review",
      done: state.totalReviews > 0,
      adminOnly: false,
    },
    {
      key: "add-brand-voice",
      title: "Add your brand voice",
      description:
        "Save your tone and style guide so the Brand Voice juror grades new content against how your company actually sounds.",
      href: "/brand",
      cta: "Set up brand voice",
      done: state.hasBrandProfile,
      adminOnly: true,
    },
    {
      key: "invite-team",
      title: "Invite your team",
      description:
        "Bring in the copywriters, social, and compliance reviewers who ship with you so everyone reviews against the same bar.",
      href: "/team",
      cta: "Invite teammates",
      done: hasTeammates,
      adminOnly: true,
    },
  ];
}

/**
 * The getting-started steps that apply to this user, with `done` resolved. A
 * member sees only the steps they can act on (no admin-only setup), so the
 * checklist never dangles an action they can't take.
 */
export function buildGettingStarted(
  state: FirstRunState,
): GettingStartedStep[] {
  const isAdmin = state.role === "admin";
  return allSteps(state).filter((step) => isAdmin || !step.adminOnly);
}

/**
 * Progress across the applicable steps, for the panel's "N of M" summary. Counts
 * only the role-filtered steps so a member's progress is out of what they can do.
 */
export function gettingStartedProgress(
  state: FirstRunState,
): GettingStartedProgress {
  const steps = buildGettingStarted(state);
  const completed = steps.filter((step) => step.done).length;
  return {
    completed,
    total: steps.length,
    allDone: steps.length > 0 && completed === steps.length,
  };
}

/**
 * Whether to show the first-run panel at all. It is a *first-run* surface: it
 * appears while the user is new — defined by the one universal signal, having
 * run no reviews yet — and gives way to the normal activity dashboard the moment
 * a first review exists. (An admin who still hasn't set a brand guide or invited
 * anyone can finish those from the nav; we don't keep the new-user panel up for
 * them once reviews are flowing.) Keying on reviews needs no extra persistence
 * and can never fabricate a "dismissed" state.
 */
export function shouldShowFirstRun(state: FirstRunState): boolean {
  return state.totalReviews <= 0;
}
