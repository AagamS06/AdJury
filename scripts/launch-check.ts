/**
 * Launch readiness check (DailyPlan Day 84 — Week 12 launch prep).
 *
 * "Final launch checklist + outreach templates for testimonials; final Memory.md.
 *  DoD: launch-ready; Memory.md final for v1."
 *
 * Offline-first, exactly like `prod-config-check.ts` / `deploy-smoke.ts` /
 * `monitoring-check.ts` / `demo-script-check.ts`: it assembles the five Week-12
 * readiness reports from disk (prod config, deploy, SEO, monitoring, demo), rolls
 * them up into one launch checklist, prints the gates + the testimonial outreach
 * templates + the readiness report, then exits 0 — it fabricates nothing. It
 * exits non-zero ONLY on real drift (the reconcile fails: a gate's offline half
 * went red, the checklist stopped covering the Week-12 areas, or an outreach
 * template is malformed / off-brand / misstates the jury size).
 *
 *   npm run launch:check
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildLaunchChecklist,
  reconcileLaunch,
  OUTREACH_TEMPLATES,
  launchJurySummary,
  type LaunchGateInput,
  type LaunchReadiness,
} from "@/lib/marketing/launch-checklist";
import { buildProdReadiness } from "@/lib/deploy/prod-config";
import { buildDeployReadiness } from "@/lib/deploy/deploy-plan";
import { reconcileSeo } from "@/lib/seo/metadata";
import {
  auditKeyEventEmission,
  buildMonitoringReadiness,
} from "@/lib/observability/monitoring-audit";
import { monitoringEnvState } from "@/lib/observability/monitoring";
import { buildDemoReadiness } from "@/lib/marketing/demo-script";
import type { SourceFile } from "@/lib/observability/logging-audit";

const root = fileURLToPath(new URL("..", import.meta.url));
const srcDir = `${root}src`;
const appDir = `${root}src/app`;
const migrationsDir = `${root}supabase/migrations`;

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

/** Load every `.ts`/`.tsx` file under `src/`, keyed by its path relative to `src/`. */
function loadSrcFiles(): SourceFile[] {
  const out: SourceFile[] = [];
  function walk(dir: string, rel: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = `${dir}/${entry.name}`;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, relPath);
      else if (/\.tsx?$/.test(entry.name)) out.push({ path: relPath, src: readFileSync(abs, "utf8") });
    }
  }
  walk(srcDir, "");
  return out;
}

function packageScripts(): string[] {
  const pkg = JSON.parse(readFileSync(`${root}package.json`, "utf8")) as {
    scripts?: Record<string, string>;
  };
  return Object.keys(pkg.scripts ?? {});
}

/** Assemble the five Week-12 reports the launch checklist composes. */
function loadLaunchInput(): LaunchGateInput {
  const pagePaths = collectAppFiles("page.tsx");
  const apiPaths = collectAppFiles("route.ts");
  const availableScripts = packageScripts();

  const migrationFiles = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
  const migrationSql = migrationFiles
    .slice()
    .sort()
    .map((f) => readFileSync(`${migrationsDir}/${f}`, "utf8"))
    .join("\n");
  const envExample = readFileSync(`${root}.env.example`, "utf8");
  const prodInput = { migrationFiles, migrationSql, envExample };

  const prod = buildProdReadiness(prodInput);
  const deploy = buildDeployReadiness({
    pagePaths,
    hasNextConfig: true, // next.config.mjs is committed at the repo root.
    hasBuildScript: availableScripts.includes("build"),
    prod: prodInput,
  });
  const seo = reconcileSeo(pagePaths);

  const emission = auditKeyEventEmission(loadSrcFiles());
  const env = monitoringEnvState(process.env);
  const monitoring = buildMonitoringReadiness({
    emission,
    errorMonitorConfigured: env.errorMonitorConfigured,
    analyticsConfigured: env.analyticsConfigured,
  });

  const demo = buildDemoReadiness({ pagePaths, apiPaths, availableScripts });

  return { prod, deploy, seo, monitoring, demo };
}

function printReadiness(readiness: LaunchReadiness): void {
  console.log("── AdJury launch readiness ──────────────────────────────────────────");
  console.log(`Pitch check: the jury is ${launchJurySummary()} (single source of truth).\n`);

  console.log("Week-12 launch gates:");
  for (const gate of readiness.gates) {
    const mark = gate.offlineReady ? "✓ READY " : "✗ NOT READY";
    console.log(`  ${mark}  Day ${gate.day} — ${gate.area}  (${gate.manualSteps} live step(s); ${gate.runbook})`);
  }

  console.log("\nLaunch checklist:");
  for (const item of readiness.items) {
    const mark = item.status === "ready" ? "✓ READY " : "• MANUAL";
    console.log(`  ${mark}  ${item.title}`);
    console.log(`            ${item.detail}`);
  }

  console.log("\nTestimonial outreach templates:");
  for (const t of OUTREACH_TEMPLATES) {
    const subject = t.subject ? `  “${t.subject}”` : "";
    console.log(`  • [${t.channel}] ${t.id} — ${t.purpose}${subject}`);
  }

  console.log("");
  console.log(
    `Offline launch gates: ${readiness.ready ? "PASS" : "FAIL"} · manual launch steps remaining: ${readiness.manualSteps}`,
  );
  console.log("\nFull checklist + outreach copy: docs/LAUNCH_CHECKLIST.md");
  console.log("─────────────────────────────────────────────────────────────────────");
}

function main(): void {
  const input = loadLaunchInput();
  const readiness = buildLaunchChecklist(input);
  printReadiness(readiness);

  const reconcile = reconcileLaunch(input);
  if (!reconcile.clean) {
    console.error("\nlaunch reconcile FAILED:", JSON.stringify(reconcile, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(
    "\nEverything the repo can prove offline is launch-ready. The remaining steps are the",
    "live launch itself — walk the core flow against the deployed URL, collect testimonials",
    "with the templates above, and announce (docs/LAUNCH_CHECKLIST.md).",
  );
  // exit 0 — the live launch steps are an operator's job, not a failure of this check.
}

main();
