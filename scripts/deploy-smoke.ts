/**
 * Deploy plan & production smoke test (DailyPlan Day 79 — Week 12 deploy & launch prep).
 *
 * "Deploy to Vercel; smoke-test production. DoD: app live on a public URL; core
 *  flow works."
 *
 * Offline-first, exactly like `db-smoke.ts` / `prod-config-check.ts`: with no live
 * URL it prints the deploy-readiness report, the staged progression, and the smoke
 * plan, then exits 0 — it never fabricates a deploy or a credential (Rules.md §4).
 * Given a live base URL it ALSO runs the automatable smoke checks against it (every
 * public route answers 2xx; every guarded route fails closed to /login when
 * unauthenticated); the authenticated core-flow walkthrough is the manual step in
 * docs/USER_TEST_SCRIPT.md.
 *
 *   Print the plan (no deploy needed):
 *     npm run deploy:smoke
 *
 *   Smoke-test a live deploy (preview or prod):
 *     SMOKE_BASE_URL=https://adjury.vercel.app npm run deploy:smoke
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildDeployReadiness,
  reconcileDeployPlan,
  runSmokeProbe,
  DEPLOY_STAGES,
  CORE_FLOW_STEPS,
  type DeployReadiness,
  type ProbeFetch,
} from "@/lib/deploy/deploy-plan";

const appDir = fileURLToPath(new URL("../src/app", import.meta.url));
const migrationsDir = fileURLToPath(new URL("../supabase/migrations", import.meta.url));
const envExamplePath = fileURLToPath(new URL("../.env.example", import.meta.url));
const nextConfigPath = fileURLToPath(new URL("../next.config.mjs", import.meta.url));
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

function fileExists(path: string): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

function hasBuildScript(): boolean {
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    return typeof pkg.scripts?.build === "string" && pkg.scripts.build.length > 0;
  } catch {
    return false;
  }
}

function loadReadiness(): DeployReadiness {
  const pagePaths = collectAppFiles("page.tsx");
  const migrationFiles = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
  const migrationSql = migrationFiles
    .slice()
    .sort()
    .map((f) => readFileSync(`${migrationsDir}/${f}`, "utf8"))
    .join("\n");
  const envExample = readFileSync(envExamplePath, "utf8");
  return buildDeployReadiness({
    pagePaths,
    hasNextConfig: fileExists(nextConfigPath),
    hasBuildScript: hasBuildScript(),
    prod: { migrationFiles, migrationSql, envExample },
  });
}

function printReadiness(readiness: DeployReadiness): void {
  console.log("── AdJury deploy readiness ──────────────────────────────────────────");
  for (const item of readiness.items) {
    const mark = item.status === "ready" ? "✓ READY " : "• MANUAL";
    console.log(`${mark}  ${item.title}`);
    console.log(`          ${item.detail}`);
  }
  console.log("");
  console.log(
    `Offline checks: ${readiness.ready ? "PASS" : "FAIL"} · manual steps remaining: ${readiness.manualSteps}`,
  );

  console.log("\nDeploy progression (test → prod → domain):");
  for (const stage of DEPLOY_STAGES) {
    console.log(`  - ${stage.title}`);
    console.log(`      precondition: ${stage.precondition}`);
  }

  console.log("\nSmoke plan — automatable checks (run against the live URL):");
  for (const c of readiness.plan.automatable) {
    console.log(`  • ${c.title}`);
  }
  console.log("\nSmoke plan — manual (authenticated core flow, docs/USER_TEST_SCRIPT.md):");
  for (const step of CORE_FLOW_STEPS) {
    console.log(`  • ${step.title}  (${step.route})`);
  }
  console.log("─────────────────────────────────────────────────────────────────────");
}

/** Adapt the global `fetch` to the probe's minimal response shape. */
const probeFetch: ProbeFetch = async (url, init) => {
  const res = await fetch(url, { method: init.method, redirect: init.redirect });
  return { status: res.status, headers: { get: (n: string) => res.headers.get(n) } };
};

async function main(): Promise<void> {
  const readiness = loadReadiness();
  printReadiness(readiness);

  // Drift guard: the plan must reconcile regardless of whether a URL is given.
  const reconcile = reconcileDeployPlan({
    pagePaths: collectAppFiles("page.tsx"),
    apiPaths: collectAppFiles("route.ts"),
  });
  if (!reconcile.clean) {
    console.error("\ndeploy-plan reconcile FAILED:", JSON.stringify(reconcile, null, 2));
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.SMOKE_BASE_URL?.trim();
  if (!baseUrl) {
    console.log(
      [
        "",
        "Live smoke skipped: no SMOKE_BASE_URL in this environment.",
        "",
        "Deploy to Vercel (preview or prod), then smoke-test the public URL:",
        "  SMOKE_BASE_URL=https://<your-deploy-url> npm run deploy:smoke",
        "",
        "Full runbook: docs/DEPLOYMENT.md",
      ].join("\n"),
    );
    return; // exit 0 — no live deploy to probe is not a failure of this check.
  }

  console.log(`\nLive smoke against ${baseUrl}:`);
  const run = await runSmokeProbe(baseUrl, readiness.plan, probeFetch);
  for (const r of run.results) {
    console.log(`  ${r.ok ? "✓" : "✗"} ${r.check.route}  — ${r.message}`);
  }
  console.log(`\n${run.passed} passed, ${run.failed} failed.`);
  if (!run.ok) {
    console.error("Live smoke FAILED — the deploy is not healthy.");
    process.exitCode = 1;
    return;
  }
  console.log(
    "Automatable smoke PASSED. Finish with the authenticated core-flow walkthrough (docs/USER_TEST_SCRIPT.md).",
  );
}

main().catch((err) => {
  console.error("deploy smoke FAILED:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
