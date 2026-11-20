import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JUROR_COUNT } from "@/lib/ui/copy";
import { PERSONAS } from "@/lib/ai/personas";
import { CORE_FLOW_STEPS } from "@/lib/deploy/deploy-plan";
import {
  DEMO_SCENES,
  DEMO_MIN_SECONDS,
  DEMO_MAX_SECONDS,
  RECORDING_SETUP,
  buildDemoScript,
  buildDemoReadiness,
  reconcileDemoScript,
  formatTimecode,
  type DemoScene,
} from "@/lib/marketing/demo-script";

/**
 * Demo video script & recording plan (DailyPlan Day 83 — Week 12 launch prep).
 *
 * "Demo script + recording assets/instructions (2–3 min).
 *  DoD: a demo walkthrough exists."
 *
 * Part 1 runs the reconcile over the REAL route tree + real scripts and proves
 * it is clean — the executable form of the DoD. Part 2 proves each check
 * genuinely catches a planted fault (otherwise the clean result proves nothing).
 * Part 3 pins the timeline/readiness/helpers.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/** Collect repo-relative (`src/app/...`) paths of every file named `leaf`. */
function collectAppFiles(leaf: string): string[] {
  const appDir = `${repoRoot}src/app`;
  const out: string[] = [];
  function walk(absDir: string, rel: string): void {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const abs = `${absDir}/${entry.name}`;
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(abs, childRel);
      else if (entry.name === leaf) out.push(childRel);
    }
  }
  walk(appDir, "src/app");
  return out;
}

function packageScripts(): string[] {
  const pkg = JSON.parse(readFileSync(`${repoRoot}package.json`, "utf8")) as {
    scripts?: Record<string, string>;
  };
  return Object.keys(pkg.scripts ?? {});
}

const pagePaths = collectAppFiles("page.tsx");
const apiPaths = collectAppFiles("route.ts");
const availableScripts = packageScripts();

// ── 1. The real demo script agrees with the shipped product ─────────────────────

describe("demo script — the walkthrough exists and agrees with the product", () => {
  it("has a clean reconcile over the real route tree + scripts", () => {
    const r = reconcileDemoScript({ pagePaths, apiPaths, availableScripts });
    expect(r, JSON.stringify(r, null, 2)).toMatchObject({
      withinTarget: true,
      sceneRoutesExist: true,
      coversCoreFlow: true,
      jurorCountAccurate: true,
      assetsReferenceRealScripts: true,
      clean: true,
    });
  });

  it("is non-vacuous — real scenes, real flow, real jury size", () => {
    // The jury is really six, so the narration's "six" is a real agreement.
    expect(JUROR_COUNT).toBe(6);
    expect(PERSONAS.length).toBe(JUROR_COUNT);
    // There are scenes, and more than just the core-flow ones (intro + outro).
    expect(DEMO_SCENES.length).toBeGreaterThan(CORE_FLOW_STEPS.length);
    // The route tree the reconcile checks against is real and non-trivial.
    expect(pagePaths.length).toBeGreaterThan(5);
    expect(apiPaths.length).toBeGreaterThan(0);
    // The recording setup actually names npm scripts (so the script check bites).
    const assetText = RECORDING_SETUP.map((a) => a.detail).join("\n");
    expect(/\bnpm run \w/.test(assetText)).toBe(true);
  });

  it("the offline readiness is ready with the recording steps left manual", () => {
    const readiness = buildDemoReadiness({ pagePaths, apiPaths, availableScripts });
    expect(readiness.ready).toBe(true);
    // The genuine person-needed steps are present and never auto-marked ready.
    const manualIds = readiness.items.filter((i) => i.status === "manual").map((i) => i.id);
    expect(manualIds).toEqual(
      expect.arrayContaining(["seed-tenant", "record", "produce"]),
    );
    expect(readiness.manualSteps).toBe(3);
  });

  it("walks exactly the Day-79 core flow, in order", () => {
    const script = buildDemoScript();
    // Every core-flow step id appears, exactly once, no extras.
    expect([...script.coreFlowStepIds].sort()).toEqual(
      [...CORE_FLOW_STEPS.map((s) => s.id)].sort(),
    );
    // And in the product's flow order.
    expect(script.coreFlowStepIds).toEqual(CORE_FLOW_STEPS.map((s) => s.id));
  });
});

// ── 2. Each check bites a planted fault ─────────────────────────────────────────

/** A minimal valid scene set the reconcile accepts, to mutate per test. */
function validScenes(): DemoScene[] {
  return DEMO_SCENES.map((s) => ({ ...s }));
}

describe("demo script — reconcile catches drift", () => {
  it("flags a runtime that falls outside 2–3 minutes", () => {
    const tooLong = validScenes();
    tooLong[0] = { ...tooLong[0], seconds: tooLong[0].seconds + DEMO_MAX_SECONDS };
    const r = reconcileDemoScript({ pagePaths, apiPaths, availableScripts, scenes: tooLong });
    expect(r.withinTarget).toBe(false);
    expect(r.clean).toBe(false);
  });

  it("flags a scene pointing at a route that does not exist", () => {
    const bad = validScenes();
    bad[0] = { ...bad[0], route: "/does-not-exist" };
    const r = reconcileDemoScript({ pagePaths, apiPaths, availableScripts, scenes: bad });
    expect(r.sceneRoutesExist).toBe(false);
    expect(r.clean).toBe(false);
  });

  it("flags the demo dropping a core-flow step", () => {
    // Remove the analytics scene — the flow is no longer fully covered.
    const missing = validScenes().filter((s) => s.coreFlowStepId !== "analytics");
    const r = reconcileDemoScript({ pagePaths, apiPaths, availableScripts, scenes: missing });
    expect(r.coversCoreFlow).toBe(false);
    expect(r.clean).toBe(false);
  });

  it("flags narration that states the wrong jury size", () => {
    const drift = validScenes();
    drift[0] = {
      ...drift[0],
      narration: "Before you publish, five AI juror personas each score your ad.",
    };
    const r = reconcileDemoScript({ pagePaths, apiPaths, availableScripts, scenes: drift });
    expect(r.jurorCountAccurate).toBe(false);
    expect(r.clean).toBe(false);
  });

  it("flags narration that never states the jury size", () => {
    const silent = validScenes().map((s) => ({
      ...s,
      narration: s.narration.replace(/six/gi, "several"),
    }));
    const r = reconcileDemoScript({ pagePaths, apiPaths, availableScripts, scenes: silent });
    expect(r.jurorCountAccurate).toBe(false);
  });

  it("flags recording setup that names a non-existent script", () => {
    // Drop seed:demo from the available set — the setup references it.
    const r = reconcileDemoScript({
      pagePaths,
      apiPaths,
      availableScripts: availableScripts.filter((s) => s !== "seed:demo"),
    });
    expect(r.assetsReferenceRealScripts).toBe(false);
    expect(r.clean).toBe(false);
  });

  it("is proven to key on the real roster — a seventh juror breaks the current narration", () => {
    const r = reconcileDemoScript({
      pagePaths,
      apiPaths,
      availableScripts,
      expectedJurorCount: 7,
    });
    expect(r.jurorCountAccurate).toBe(false);
  });
});

// ── 3. Timeline, assets, and helpers ────────────────────────────────────────────

describe("demo script — timeline and helpers", () => {
  it("lays scenes on a contiguous, gapless timeline starting at 0", () => {
    const script = buildDemoScript();
    expect(script.scenes[0].startsAt).toBe(0);
    for (let i = 0; i < script.scenes.length; i++) {
      const scene = script.scenes[i];
      expect(scene.endsAt - scene.startsAt).toBe(scene.seconds);
      if (i > 0) expect(scene.startsAt).toBe(script.scenes[i - 1].endsAt);
    }
    const last = script.scenes[script.scenes.length - 1];
    expect(last.endsAt).toBe(script.totalSeconds);
  });

  it("the real total is inside the 2–3 minute window", () => {
    const { totalSeconds } = buildDemoScript();
    expect(totalSeconds).toBeGreaterThanOrEqual(DEMO_MIN_SECONDS);
    expect(totalSeconds).toBeLessThanOrEqual(DEMO_MAX_SECONDS);
  });

  it("every scene has non-empty narration and a positive duration", () => {
    for (const scene of DEMO_SCENES) {
      expect(scene.narration.trim().length).toBeGreaterThan(0);
      expect(scene.seconds).toBeGreaterThan(0);
    }
  });

  it("scene ids are unique", () => {
    const ids = DEMO_SCENES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("formats whole-second offsets as m:ss", () => {
    expect(formatTimecode(0)).toBe("0:00");
    expect(formatTimecode(9)).toBe("0:09");
    expect(formatTimecode(75)).toBe("1:15");
    expect(formatTimecode(160)).toBe("2:40");
  });

  it("has a non-empty recording setup", () => {
    expect(RECORDING_SETUP.length).toBeGreaterThan(0);
    for (const asset of RECORDING_SETUP) {
      expect(asset.title.trim().length).toBeGreaterThan(0);
      expect(asset.detail.trim().length).toBeGreaterThan(0);
    }
  });
});
