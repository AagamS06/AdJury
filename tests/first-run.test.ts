import { describe, it, expect } from "vitest";
import type { UserRole } from "@/types/db";
import {
  buildGettingStarted,
  FIRST_RUN_HEADING,
  FIRST_RUN_INTRO,
  gettingStartedProgress,
  shouldShowFirstRun,
  type FirstRunState,
} from "@/lib/onboarding/first-run";

/**
 * First-run experience pure core (DailyPlan Day 66): the getting-started
 * checklist shown to a brand-new user on the dashboard. Mirrors the
 * `dashboard-view` / `nav` / `landing` pure-module test pattern — the server
 * component only renders these values, so which steps apply (role filtering),
 * their order, their honest done-state, and when the panel shows are proved here.
 */

function state(overrides: Partial<FirstRunState> = {}): FirstRunState {
  return {
    role: "admin",
    totalReviews: 0,
    hasBrandProfile: false,
    ...overrides,
  };
}

/** A brand-new admin account with every applicable step still outstanding. */
const freshAdmin = state({ role: "admin", teamMemberCount: 1 });

describe("buildGettingStarted — which steps apply", () => {
  it("gives an admin all three steps, run-review first", () => {
    const steps = buildGettingStarted(freshAdmin);
    expect(steps.map((s) => s.key)).toEqual([
      "run-first-review",
      "add-brand-voice",
      "invite-team",
    ]);
  });

  it("gives a member only the step they can act on (run a review)", () => {
    const steps = buildGettingStarted(state({ role: "member", teamMemberCount: 3 }));
    // The admin-only setup steps are filtered out — never dangle an action a
    // member cannot take.
    expect(steps.map((s) => s.key)).toEqual(["run-first-review"]);
    expect(steps.every((s) => s.adminOnly === false)).toBe(true);
  });

  it("every step points at a real in-app route and has copy + a CTA", () => {
    const steps = buildGettingStarted(freshAdmin);
    const hrefs = steps.map((s) => s.href);
    expect(hrefs).toEqual(["/review", "/brand", "/team"]);
    for (const step of steps) {
      expect(step.href.startsWith("/")).toBe(true);
      expect(step.href.endsWith("/")).toBe(false); // no trailing slash
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.description.length).toBeGreaterThan(0);
      expect(step.cta.length).toBeGreaterThan(0);
    }
  });

  it("uses stable, unique keys", () => {
    const keys = buildGettingStarted(freshAdmin).map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("buildGettingStarted — honest done-state", () => {
  it("marks run-first-review done only once a review has run", () => {
    const run = (totalReviews: number) =>
      buildGettingStarted(state({ totalReviews })).find(
        (s) => s.key === "run-first-review",
      )!;
    expect(run(0).done).toBe(false);
    expect(run(1).done).toBe(true);
    expect(run(9).done).toBe(true);
  });

  it("marks add-brand-voice done only when a brand guide exists", () => {
    const brand = (hasBrandProfile: boolean) =>
      buildGettingStarted(state({ hasBrandProfile })).find(
        (s) => s.key === "add-brand-voice",
      )!;
    expect(brand(false).done).toBe(false);
    expect(brand(true).done).toBe(true);
  });

  it("marks invite-team done only when a teammate has joined", () => {
    const invite = (teamMemberCount: number | undefined) =>
      buildGettingStarted(state({ teamMemberCount })).find(
        (s) => s.key === "invite-team",
      )!;
    // Just the founding admin (1) is not "invited a team"; 2+ is.
    expect(invite(1).done).toBe(false);
    expect(invite(2).done).toBe(true);
    expect(invite(5).done).toBe(true);
    // An unknown count (read failed) stays not-done rather than fabricated.
    expect(invite(undefined).done).toBe(false);
  });
});

describe("gettingStartedProgress", () => {
  it("counts only the steps that apply to the user", () => {
    // Member: one applicable step, not done.
    expect(
      gettingStartedProgress(state({ role: "member" })),
    ).toEqual({ completed: 0, total: 1, allDone: false });
  });

  it("counts completed applicable steps for an admin", () => {
    const progress = gettingStartedProgress(
      state({ totalReviews: 2, hasBrandProfile: true, teamMemberCount: 1 }),
    );
    // run-review done + brand done, but team not (only the founder) → 2 of 3.
    expect(progress).toEqual({ completed: 2, total: 3, allDone: false });
  });

  it("reports allDone only when every applicable step is done", () => {
    const progress = gettingStartedProgress(
      state({ totalReviews: 1, hasBrandProfile: true, teamMemberCount: 3 }),
    );
    expect(progress).toEqual({ completed: 3, total: 3, allDone: true });
  });
});

describe("shouldShowFirstRun", () => {
  it("shows the panel for a brand-new company (no reviews yet)", () => {
    expect(shouldShowFirstRun(state({ totalReviews: 0 }))).toBe(true);
  });

  it("hides it the moment a first review exists", () => {
    expect(shouldShowFirstRun(state({ totalReviews: 1 }))).toBe(false);
    expect(shouldShowFirstRun(state({ totalReviews: 50 }))).toBe(false);
  });

  it("is driven by reviews alone, regardless of role or setup", () => {
    const roles: UserRole[] = ["admin", "member"];
    for (const role of roles) {
      expect(
        shouldShowFirstRun(
          state({ role, totalReviews: 0, hasBrandProfile: true, teamMemberCount: 9 }),
        ),
      ).toBe(true);
    }
  });
});

describe("panel copy", () => {
  it("provides a heading and a plain, control-preserving intro", () => {
    expect(FIRST_RUN_HEADING.length).toBeGreaterThan(0);
    expect(FIRST_RUN_INTRO.length).toBeGreaterThan(0);
    // The product promise is a QA layer — nothing auto-publishes (PRD/Rules §1).
    expect(FIRST_RUN_INTRO.toLowerCase()).toContain("control");
  });
});
