/**
 * Monitoring check (DailyPlan Day 81 — Week 12 deploy & launch prep).
 *
 * Prints the prod-monitoring readiness report (the offline-verifiable checks: the
 * product-analytics seam + key-event catalog exist, every key event is emitted
 * where the catalog says, and the Day-48 error-monitoring hook is in place) and
 * the remaining manual steps (register the prod error-monitor and analytics
 * adapters with their DSN/key from the provider dashboards).
 *
 * Offline-first, exactly like `prod-config-check.ts` / `deploy-smoke.ts`: with no
 * monitoring credentials it reports readiness + the runbook and exits 0 — it never
 * fabricates or requires a secret (Rules.md §4). It fails (exit 1) only on real
 * drift: the key-event catalog disagreeing with the source tree, or the two
 * monitoring env vars no longer declared as non-secret server config.
 *
 *   npm run monitor:check
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  auditKeyEventEmission,
  buildMonitoringReadiness,
  reconcileMonitoring,
  type MonitoringReadiness,
} from "@/lib/observability/monitoring-audit";
import {
  KEY_EVENTS,
  MONITORING_ENV,
  monitoringEnvState,
} from "@/lib/observability/monitoring";
import type { SourceFile } from "@/lib/observability/logging-audit";

const srcDir = fileURLToPath(new URL("../src", import.meta.url));

function loadSrcFiles(): SourceFile[] {
  const out: SourceFile[] = [];
  function walk(dir: string, rel: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = `${dir}/${entry.name}`;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, relPath);
      } else if (/\.tsx?$/.test(entry.name)) {
        out.push({ path: relPath, src: readFileSync(abs, "utf8") });
      }
    }
  }
  walk(srcDir, "");
  return out;
}

function printReadiness(readiness: MonitoringReadiness): void {
  console.log("── AdJury prod monitoring readiness ─────────────────────────────────");
  for (const item of readiness.items) {
    const mark = item.status === "ready" ? "✓ READY " : "• MANUAL";
    console.log(`${mark}  ${item.title}`);
    console.log(`          ${item.detail}`);
  }
  console.log("");
  console.log(
    `Offline checks: ${readiness.ready ? "PASS" : "FAIL"} · manual steps remaining: ${readiness.manualSteps}`,
  );
  console.log("");
  console.log("Key product events (must be visible in prod):");
  for (const e of KEY_EVENTS) {
    console.log(`  - ${e.name}  →  ${e.source}`);
  }
  console.log("");
  console.log("Prod monitoring env (set in Vercel; values from the provider dashboards):");
  console.log(`  - ${MONITORING_ENV.errorDsn}      (error monitoring)`);
  console.log(`  - ${MONITORING_ENV.analyticsKey}    (product analytics)`);
  console.log("─────────────────────────────────────────────────────────────────────");
}

function main(): void {
  const files = loadSrcFiles();
  const emission = auditKeyEventEmission(files);
  const env = monitoringEnvState(process.env);

  const readiness = buildMonitoringReadiness({
    emission,
    errorMonitorConfigured: env.errorMonitorConfigured,
    analyticsConfigured: env.analyticsConfigured,
  });
  printReadiness(readiness);

  // Drift guard — the catalog + env posture must reconcile regardless of creds.
  const reconcile = reconcileMonitoring({ emission });
  if (!reconcile.clean) {
    console.error(
      "\nmonitoring reconcile FAILED:",
      JSON.stringify({ reconcile, emission }, null, 2),
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    [
      "",
      `Monitoring providers currently wired here: error=${env.errorMonitorConfigured ? "yes" : "no"}, analytics=${env.analyticsConfigured ? "yes" : "no"}.`,
      "With neither set, both sinks are offline no-ops (fine for a credential-less",
      "build). To make errors + key events visible in prod, set the two env vars and",
      "register the adapters — full runbook: docs/MONITORING.md.",
    ].join("\n"),
  );
  // exit 0 — a credential-less build is not a failure of this check.
}

main();
