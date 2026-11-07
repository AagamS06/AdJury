import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { auditMotion } from "@/lib/ui/motion-audit";
import { auditCopy, findJurorCountDrift } from "@/lib/ui/copy-audit";
import { auditPerformance } from "@/lib/performance/performance-audit";
import { JUROR_COUNT, JUROR_COUNT_WORD, numberWord } from "@/lib/ui/copy";
import {
  buildGettingStarted,
  gettingStartedProgress,
  shouldShowFirstRun,
  type FirstRunState,
  type GettingStartedStep,
} from "@/lib/onboarding/first-run";
import { DEMO_REVIEW_SCENARIOS, demoReviewInput } from "@/lib/demo/seed-data";
import { PERSONAS } from "@/lib/ai/personas";
import { getModelClient } from "@/lib/ai/client";
import { runReview } from "@/lib/ai/orchestrator";
import { type Verdict } from "@/lib/schema/juror";
import type { UserRole } from "@/types/db";

/**
 * Week 10 hardening (DailyPlan Day 70) — polish & launch-prep integration.
 *
 * Week 10 was the polish week: Day 64 added the motion system + `motion-audit`,
 * Day 65 the copy lexicon + `copy-audit`, Day 66 the first-run getting-started
 * checklist (`lib/onboarding/first-run.ts` + `getting-started.tsx`), Day 67 the
 * `performance-audit`, Day 68 the demo tenant for user testing
 * (`lib/demo/seed-data.ts`), and Day 69 the friction fix that made the jury size
 * a single source of truth (`JUROR_COUNT` + `findJurorCountDrift`). Each of those
 * days has its own per-day suite that reads only its own slice.
 *
 * This is the week-end integration complement (mirroring Day 7/14/21/28/35/42/
 * 49/56/63): NO new product surface — it wires the REAL Week-10 cores together
 * and proves the week's invariants COMPOSE across the whole polish surface and
 * that the surfaces AGREE with one another, properties no single-day suite sees:
 *
 *  1. The three Week-10 source audits (motion Day 64, copy Day 65, performance
 *     Day 67) share ONE source model: the suite walks the real tree once and runs
 *     all three over that one module set, so "the whole app clears the motion AND
 *     copy AND performance pass together" is one verdict — not three separately-
 *     loaded passes that never meet. The module set is proved non-trivial and
 *     proved to include the Week-10 surfaces, so the clean result is not vacuous.
 *  2. The surfaces Week 10 shipped (the first-run component, the first-run core,
 *     and the demo dataset) themselves clear all three audits — scoped to just
 *     those files, so the whole-repo clean can't be carried by older code.
 *  3. The first-run checklist (Day 66) agrees with the real route tree on disk:
 *     every getting-started step, for every role, points at a real `page.tsx`
 *     route — a cross-day agreement between `first-run.ts` and `src/app` that the
 *     first-run suite (no route tree) can't see — and the role filter + progress
 *     stay internally consistent.
 *  4. The jury size is ONE source of truth across the whole chrome (Day 69): it
 *     is derived from the real `PERSONAS` roster (not a literal), the full copy
 *     audit (which includes the juror-count scanner) is clean over the whole
 *     repo, and — tying Day 66 to Day 69 — the first-run step copy that promises
 *     the jury states exactly `JUROR_COUNT` jurors, proved by running the Day-69
 *     scanner over that real copy against the roster-derived count.
 *  5. The demo tenant (Day 68) composes with the real orchestrator and roster
 *     (Day 69): each demo scenario, reviewed by the REAL orchestrator under the
 *     offline mock, returns exactly `JUROR_COUNT` juror slots from the real
 *     roster and its pinned verdict — so the tenant a tester actually sees renders
 *     the same N-juror, full-verdict-range scorecard the chrome promises.
 *
 * All offline (no live model/DB/bundler): the audits read source text, the
 * first-run/copy cores are pure, and the orchestrator runs on the offline mock —
 * faithful to what ships.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

interface Mod {
  /** Repo-relative path, POSIX separators. */
  path: string;
  src: string;
}

/** Recursively collect every .ts/.tsx under src/, path repo-relative (POSIX). */
function loadSrcModules(): Mod[] {
  const out: Mod[] = [];
  function walk(absDir: string, rel: string): void {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const abs = `${absDir}/${entry.name}`;
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(abs, childRel);
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        out.push({ path: childRel, src: readFileSync(abs, "utf8") });
      }
    }
  }
  walk(`${repoRoot}src`, "src");
  return out;
}

/**
 * The URL route a `src/app/.../page.tsx` renders: strip the `src/app` prefix and
 * the `page.tsx` leaf, drop `(group)` route-group segments, keep `[param]`
 * dynamic segments. `src/app/page.tsx` is the root `/`. Mirrors Next.js App
 * Router path resolution.
 */
function routeForPagePath(path: string): string | null {
  const m = /^src\/app\/(.*)page\.tsx$/.exec(path);
  if (!m) return null;
  const segments = m[1]
    .split("/")
    .filter((s) => s.length > 0 && !(s.startsWith("(") && s.endsWith(")")));
  return `/${segments.join("/")}`;
}

/** Every real URL route backed by a `page.tsx` on disk. */
function realRoutes(modules: readonly Mod[]): Set<string> {
  const routes = new Set<string>();
  for (const mod of modules) {
    const route = routeForPagePath(mod.path);
    if (route !== null) routes.add(route);
  }
  return routes;
}

/** The Week-10 surface this hardening scopes the per-surface audits to. */
const WEEK10_SURFACE = new Set<string>([
  "src/components/onboarding/getting-started.tsx",
  "src/lib/onboarding/first-run.ts",
  "src/lib/demo/seed-data.ts",
]);

// ─────────────────────────────────────────────────────────────────────────────

describe("Week 10 hardening — polish & launch-prep integration", () => {
  const modules = loadSrcModules();

  // ── 1. the three Week-10 audits compose over one shared source model ────────
  describe("the Week-10 source audits compose over one shared source model", () => {
    it("loaded a non-trivial module set that includes the Week-10 surfaces", () => {
      // Guards against a silently-empty walk making every clean result vacuous.
      expect(modules.length).toBeGreaterThan(80);
      const paths = new Set(modules.map((m) => m.path));
      for (const file of [
        "src/lib/ui/motion.ts",
        "src/lib/ui/copy.ts",
        "src/lib/performance/performance-audit.ts",
        "src/lib/onboarding/first-run.ts",
        "src/components/onboarding/getting-started.tsx",
        "src/lib/demo/seed-data.ts",
      ]) {
        expect(paths.has(file), `${file} missing from scanned modules`).toBe(true);
      }
    });

    it("motion, copy, and performance audits are all clean over the one module set", () => {
      const motion = auditMotion(modules);
      const copy = auditCopy(modules);
      const performance = auditPerformance(modules);
      expect(motion.clean, JSON.stringify(motion.findings)).toBe(true);
      expect(copy.clean, JSON.stringify(copy.findings)).toBe(true);
      expect(performance.clean, JSON.stringify(performance.findings)).toBe(true);
    });
  });

  // ── 2. the Week-10 surface itself clears all three audits ───────────────────
  describe("the surfaces Week 10 shipped clear all three Week-10 audits", () => {
    const week10Modules = modules.filter((m) => WEEK10_SURFACE.has(m.path));

    it("scoped to the real, non-trivial Week-10 surface (so the pass isn't vacuous)", () => {
      expect(week10Modules.length).toBe(WEEK10_SURFACE.size);
      expect(
        week10Modules.some(
          (m) => m.path === "src/components/onboarding/getting-started.tsx",
        ),
      ).toBe(true);
    });

    it("has subtle, gated motion only (Day 64)", () => {
      const audit = auditMotion(week10Modules);
      expect(audit.clean, JSON.stringify(audit.findings)).toBe(true);
    });

    it("uses consistent, emoji-free, roster-accurate copy (Day 65 + Day 69)", () => {
      const audit = auditCopy(week10Modules);
      expect(audit.clean, JSON.stringify(audit.findings)).toBe(true);
    });

    it("has no bundle/image/query performance hazard (Day 67)", () => {
      const audit = auditPerformance(week10Modules);
      expect(audit.clean, JSON.stringify(audit.findings)).toBe(true);
    });
  });

  // ── 3. the first-run checklist agrees with the real route tree ──────────────
  describe("the first-run checklist (Day 66) agrees with the real routes on disk", () => {
    const routes = realRoutes(modules);

    it("loaded a non-trivial route snapshot (so the agreement means something)", () => {
      expect(routes.size).toBeGreaterThan(4);
      expect(routes.has("/review")).toBe(true);
    });

    /** Every step emitted across both roles and both review/brand states. */
    function everyStep(): GettingStartedStep[] {
      const roles: UserRole[] = ["admin", "member"];
      const bools = [false, true];
      const steps: GettingStartedStep[] = [];
      for (const role of roles) {
        for (const totalReviews of [0, 3]) {
          for (const hasBrandProfile of bools) {
            for (const teamMemberCount of [undefined, 1, 4]) {
              const state: FirstRunState = {
                role,
                totalReviews,
                hasBrandProfile,
                teamMemberCount,
              };
              steps.push(...buildGettingStarted(state));
            }
          }
        }
      }
      return steps;
    }

    it("every getting-started step, for every role/state, targets a real page.tsx route", () => {
      const steps = everyStep();
      expect(steps.length).toBeGreaterThan(0);
      for (const step of steps) {
        expect(step.href.startsWith("/"), `${step.href} is not a route`).toBe(
          true,
        );
        expect(
          routes.has(step.href),
          `step "${step.key}" href ${step.href} has no page.tsx`,
        ).toBe(true);
      }
    });

    it("a member never sees an admin-only step; an admin sees the full set", () => {
      const base = { totalReviews: 0, hasBrandProfile: false } as const;
      const memberSteps = buildGettingStarted({ role: "member", ...base });
      const adminSteps = buildGettingStarted({ role: "admin", ...base });
      expect(memberSteps.every((s) => !s.adminOnly)).toBe(true);
      expect(adminSteps.length).toBeGreaterThan(memberSteps.length);
      // The one universal step (run a review) is offered to everyone.
      expect(memberSteps.some((s) => s.key === "run-first-review")).toBe(true);
    });

    it("progress counts only the role-filtered steps, and the panel hides once reviews exist", () => {
      const member: FirstRunState = {
        role: "member",
        totalReviews: 0,
        hasBrandProfile: false,
      };
      const p = gettingStartedProgress(member);
      expect(p.total).toBe(buildGettingStarted(member).length);
      expect(p.completed).toBeLessThanOrEqual(p.total);
      // First-run gating is the one universal "new user" signal.
      expect(shouldShowFirstRun({ ...member, totalReviews: 0 })).toBe(true);
      expect(shouldShowFirstRun({ ...member, totalReviews: 1 })).toBe(false);
    });
  });

  // ── 4. jury size is one source of truth across the whole chrome ─────────────
  describe("the jury size is one source of truth across the chrome (Day 69)", () => {
    it("JUROR_COUNT is derived from the real PERSONAS roster, not a literal", () => {
      expect(JUROR_COUNT).toBe(PERSONAS.length);
      expect(JUROR_COUNT_WORD).toBe(numberWord(PERSONAS.length));
      const copyCore = modules.find((m) => m.path === "src/lib/ui/copy.ts");
      expect(copyCore).toBeDefined();
      // Source-level proof it tracks the roster (so it can't drift from the jury
      // that actually reviews content), not a hand-typed number.
      expect(copyCore?.src).toContain("PERSONAS.length");
    });

    it("the full copy audit (incl. the juror-count scanner) is clean over the whole repo", () => {
      // findJurorCountDrift is one of auditCopy's scanners, so a clean whole-repo
      // audit means every chrome statement of the jury size agrees with the roster.
      const audit = auditCopy(modules);
      const countFindings = audit.findings.filter((f) => f.kind === "juror-count");
      expect(countFindings, JSON.stringify(countFindings)).toHaveLength(0);
      expect(audit.clean, JSON.stringify(audit.findings)).toBe(true);
    });

    it("the first-run step copy promising the jury states exactly JUROR_COUNT jurors", () => {
      // Tie Day 66 ↔ Day 69: the getting-started "run a review" step tells the
      // user how many jurors score their ad. Run the Day-69 scanner over that
      // REAL copy. Against the roster-derived count it is clean; against any other
      // count it fires — proving the copy genuinely states JUROR_COUNT (not that
      // the scanner is blind here).
      const step = buildGettingStarted({
        role: "member",
        totalReviews: 0,
        hasBrandProfile: false,
      }).find((s) => s.key === "run-first-review");
      expect(step).toBeDefined();
      const mod: Mod = { path: "virtual/first-run-copy.tsx", src: step!.description };
      // The copy must actually make a juror-count claim (else the tie is vacuous).
      expect(findJurorCountDrift(mod, JUROR_COUNT + 1).length).toBeGreaterThan(0);
      // …and that claim equals the real roster size.
      expect(findJurorCountDrift(mod, JUROR_COUNT)).toHaveLength(0);
    });
  });

  // ── 5. the demo tenant composes with the real orchestrator + roster ─────────
  describe("the demo tenant (Day 68) composes with the real orchestrator + roster", () => {
    const client = getModelClient();
    const rosterNames = new Set(PERSONAS.map((p) => p.name));

    it("runs on the offline mock (no AI key in this environment)", () => {
      expect(client.isMock).toBe(true);
    });

    it("every demo scenario returns exactly JUROR_COUNT juror slots from the real roster", async () => {
      expect(DEMO_REVIEW_SCENARIOS.length).toBeGreaterThan(0);
      for (const scenario of DEMO_REVIEW_SCENARIOS) {
        const review = await runReview(demoReviewInput(scenario), { client });
        // The count a tester sees on the scorecard IS the chrome's promised count.
        expect(
          review.jurors.length,
          `scenario ${scenario.key} rendered ${review.jurors.length} jurors`,
        ).toBe(JUROR_COUNT);
        // Each slot is a real persona from the roster, in the roster's order.
        expect(review.jurors.map((j) => j.persona)).toEqual(
          PERSONAS.map((p) => p.name),
        );
        for (const juror of review.jurors) {
          expect(rosterNames.has(juror.persona)).toBe(true);
        }
      }
    });

    it("the scenarios collectively realize the full pass/revise/fail verdict range", async () => {
      const verdicts = new Set<Verdict>();
      for (const scenario of DEMO_REVIEW_SCENARIOS) {
        const review = await runReview(demoReviewInput(scenario), { client });
        // The seeded expectation and the live mock verdict agree — so the dataset
        // can't silently drift from what a tester is told they'll see.
        expect(
          review.verdict,
          `scenario ${scenario.key}: expected ${scenario.expected_verdict}, got ${review.verdict}`,
        ).toBe(scenario.expected_verdict);
        verdicts.add(review.verdict);
      }
      expect([...verdicts].sort()).toEqual(["fail", "pass", "revise"]);
    });
  });
});
