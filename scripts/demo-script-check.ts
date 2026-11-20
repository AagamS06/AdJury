/**
 * Demo video script check (DailyPlan Day 83 — Week 12 launch prep).
 *
 * "Demo script + recording assets/instructions (2–3 min).
 *  DoD: a demo walkthrough exists."
 *
 * Offline-first, exactly like `db-smoke.ts` / `prod-config-check.ts` /
 * `deploy-smoke.ts`: it prints the timed scene plan, the recording setup, and the
 * readiness report, then exits 0 — it fabricates nothing. It exits non-zero only
 * on real drift (the reconcile fails: the runtime left the 2–3 minute window, a
 * scene points at a route that no longer exists, the demo stopped covering the
 * core flow, the narration's jury size drifted, or the setup names a dead script).
 *
 *   npm run demo:check
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildDemoReadiness,
  reconcileDemoScript,
  formatTimecode,
  RECORDING_SETUP,
  type DemoReadiness,
} from "@/lib/marketing/demo-script";

const appDir = fileURLToPath(new URL("../src/app", import.meta.url));
const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));

/** Collect repo-relative (`src/app/...`) paths of every file named `leaf`. */
function collectAppFiles(leaf: string): string[] {
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
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    scripts?: Record<string, string>;
  };
  return Object.keys(pkg.scripts ?? {});
}

function printReadiness(readiness: DemoReadiness): void {
  console.log("── AdJury demo script ───────────────────────────────────────────────");
  console.log(`Runtime: ${formatTimecode(readiness.script.totalSeconds)} (${readiness.script.totalSeconds}s), ${readiness.script.scenes.length} scenes\n`);

  console.log("Scene plan:");
  for (const scene of readiness.script.scenes) {
    const window = `${formatTimecode(scene.startsAt)}–${formatTimecode(scene.endsAt)}`;
    const flow = scene.coreFlowStepId ? `  [core-flow: ${scene.coreFlowStepId}]` : "";
    console.log(`  ${window.padEnd(11)} ${scene.route.padEnd(28)} ${scene.title}${flow}`);
  }

  console.log("\nRecording setup:");
  for (const asset of RECORDING_SETUP) {
    console.log(`  • ${asset.title}`);
    console.log(`      ${asset.detail}`);
  }

  console.log("\nReadiness:");
  for (const item of readiness.items) {
    const mark = item.status === "ready" ? "✓ READY " : "• MANUAL";
    console.log(`  ${mark}  ${item.title}`);
    console.log(`            ${item.detail}`);
  }
  console.log("");
  console.log(
    `Offline checks: ${readiness.ready ? "PASS" : "FAIL"} · manual steps remaining: ${readiness.manualSteps}`,
  );
  console.log("\nFull script + shot list: docs/DEMO_SCRIPT.md");
  console.log("─────────────────────────────────────────────────────────────────────");
}

function main(): void {
  const pagePaths = collectAppFiles("page.tsx");
  const apiPaths = collectAppFiles("route.ts");
  const availableScripts = packageScripts();

  const readiness = buildDemoReadiness({ pagePaths, apiPaths, availableScripts });
  printReadiness(readiness);

  const reconcile = reconcileDemoScript({ pagePaths, apiPaths, availableScripts });
  if (!reconcile.clean) {
    console.error("\ndemo-script reconcile FAILED:", JSON.stringify(reconcile, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log("\nDemo walkthrough exists and agrees with the shipped product. Record it per docs/DEMO_SCRIPT.md.");
}

main();
