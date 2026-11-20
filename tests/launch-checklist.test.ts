import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JUROR_COUNT } from "@/lib/ui/copy";
import { PERSONAS } from "@/lib/ai/personas";
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
import {
  LAUNCH_AREAS,
  OUTREACH_TEMPLATES,
  OUTREACH_PLACEHOLDERS,
  buildLaunchGates,
  buildLaunchChecklist,
  reconcileLaunch,
  reconcileOutreach,
  usedPlaceholders,
  launchJurySummary,
  type LaunchGateInput,
  type OutreachTemplate,
} from "@/lib/marketing/launch-checklist";

/**
 * Launch checklist & testimonial outreach (DailyPlan Day 84 — Week 12 launch prep).
 *
 * "Final launch checklist + outreach templates for testimonials; final Memory.md.
 *  DoD: launch-ready; Memory.md final for v1."
 *
 * Part 1 assembles the five REAL Week-12 reports from disk and proves the launch
 * reconcile is clean — the executable form of the DoD — and non-vacuous. Part 2
 * proves each check genuinely bites a planted fault (otherwise the clean result
 * proves nothing). Part 3 pins the gate roll-up, the outreach templates, and the
 * helpers.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

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

function loadSrcFiles(): SourceFile[] {
  const srcDir = `${repoRoot}src`;
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
  const pkg = JSON.parse(readFileSync(`${repoRoot}package.json`, "utf8")) as {
    scripts?: Record<string, string>;
  };
  return Object.keys(pkg.scripts ?? {});
}

/** Assemble the five real Week-12 reports (mirrors scripts/launch-check.ts). */
function realLaunchInput(): LaunchGateInput {
  const pagePaths = collectAppFiles("page.tsx");
  const apiPaths = collectAppFiles("route.ts");
  const availableScripts = packageScripts();

  const migrationsDir = `${repoRoot}supabase/migrations`;
  const migrationFiles = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
  const migrationSql = migrationFiles
    .slice()
    .sort()
    .map((f) => readFileSync(`${migrationsDir}/${f}`, "utf8"))
    .join("\n");
  const envExample = readFileSync(`${repoRoot}.env.example`, "utf8");
  const prodInput = { migrationFiles, migrationSql, envExample };

  const prod = buildProdReadiness(prodInput);
  const deploy = buildDeployReadiness({
    pagePaths,
    hasNextConfig: true,
    hasBuildScript: availableScripts.includes("build"),
    prod: prodInput,
  });
  const seo = reconcileSeo(pagePaths);
  const emission = auditKeyEventEmission(loadSrcFiles());
  const env = monitoringEnvState({});
  const monitoring = buildMonitoringReadiness({
    emission,
    errorMonitorConfigured: env.errorMonitorConfigured,
    analyticsConfigured: env.analyticsConfigured,
  });
  const demo = buildDemoReadiness({ pagePaths, apiPaths, availableScripts });

  return { prod, deploy, seo, monitoring, demo };
}

const input = realLaunchInput();

// ── 1. The real launch state is ready, and the reconcile is clean ────────────

describe("launch checklist — launch-ready over the real Week-12 reports", () => {
  it("has a clean reconcile over the five real reports", () => {
    const r = reconcileLaunch(input);
    expect(r, JSON.stringify(r, null, 2)).toMatchObject({
      allGatesReady: true,
      gatesCoverAllAreas: true,
      outreachClean: true,
      clean: true,
    });
  });

  it("is non-vacuous — real gates, real templates, real jury size", () => {
    // The jury is really six, so template #3's "six jurors" is a real agreement.
    expect(JUROR_COUNT).toBe(6);
    expect(PERSONAS.length).toBe(JUROR_COUNT);
    // Each upstream gate's offline half is genuinely green (not vacuously absent).
    const gates = buildLaunchGates(input);
    expect(gates.length).toBe(LAUNCH_AREAS.length);
    expect(gates.every((g) => g.offlineReady)).toBe(true);
    // There are templates, and they actually use merge fields (so the checks bite).
    expect(OUTREACH_TEMPLATES.length).toBeGreaterThan(0);
    expect(usedPlaceholders(OUTREACH_TEMPLATES).length).toBeGreaterThan(0);
  });

  it("the offline checklist is ready with the live-launch steps left manual", () => {
    const readiness = buildLaunchChecklist(input);
    expect(readiness.ready).toBe(true);
    const manualIds = readiness.items.filter((i) => i.status === "manual").map((i) => i.id);
    expect(manualIds).toEqual(
      expect.arrayContaining(["live-walkthrough", "collect-testimonials", "announce"]),
    );
    // Every offline gate is a ready item; the three live-launch actions stay manual.
    const readyIds = readiness.items.filter((i) => i.status === "ready").map((i) => i.id);
    expect(readyIds).toEqual(
      expect.arrayContaining([
        "gate:prod-config",
        "gate:deploy",
        "gate:seo",
        "gate:monitoring",
        "gate:demo",
        "outreach-templates",
      ]),
    );
  });

  it("rolls up exactly the Week-12 launch areas, in order", () => {
    const gates = buildLaunchGates(input);
    expect(gates.map((g) => g.id)).toEqual(LAUNCH_AREAS.map((a) => a.id));
    expect(gates.map((g) => g.id)).toEqual([
      "prod-config",
      "deploy",
      "seo",
      "monitoring",
      "demo",
    ]);
  });
});

// ── 2. Each check bites a planted fault ──────────────────────────────────────

/** The real input with one gate's offline half forced red. */
function withGateRed(gate: keyof LaunchGateInput): LaunchGateInput {
  if (gate === "seo") return { ...input, seo: { ...input.seo, ok: false } };
  const report = input[gate] as { ready: boolean };
  return { ...input, [gate]: { ...report, ready: false } } as LaunchGateInput;
}

describe("launch checklist — reconcile catches a red gate", () => {
  it.each(["prod", "deploy", "seo", "monitoring", "demo"] as const)(
    "flags the %s gate going offline-red",
    (gate) => {
      const r = reconcileLaunch(withGateRed(gate));
      expect(r.allGatesReady).toBe(false);
      expect(r.clean).toBe(false);
      expect(buildLaunchChecklist(withGateRed(gate)).ready).toBe(false);
    },
  );
});

/** A fresh, mutable copy of the real templates. */
function validTemplates(): OutreachTemplate[] {
  return OUTREACH_TEMPLATES.map((t) => ({ ...t }));
}

describe("outreach reconcile — catches malformed / off-brand templates", () => {
  it("is clean over the real templates", () => {
    const r = reconcileOutreach();
    expect(r, JSON.stringify(r, null, 2)).toMatchObject({
      allWellFormed: true,
      placeholdersKnown: true,
      jurorCountAccurate: true,
      namesProduct: true,
      clean: true,
    });
  });

  it("flags an email template with no subject", () => {
    const bad = validTemplates();
    const email = bad.find((t) => t.channel === "email");
    if (!email) throw new Error("expected an email template");
    email.subject = "";
    const r = reconcileOutreach(bad);
    expect(r.allWellFormed).toBe(false);
    expect(r.clean).toBe(false);
  });

  it("flags duplicate template ids", () => {
    const bad = validTemplates();
    bad[1] = { ...bad[1], id: bad[0].id };
    const r = reconcileOutreach(bad);
    expect(r.allWellFormed).toBe(false);
    expect(r.clean).toBe(false);
  });

  it("flags an unknown merge field", () => {
    const bad = validTemplates();
    bad[0] = { ...bad[0], body: `${bad[0].body}\nPS — {{unknown_field}}` };
    const r = reconcileOutreach(bad);
    expect(r.placeholdersKnown).toBe(false);
    expect(r.unknownPlaceholders).toContain("unknown_field");
    expect(r.clean).toBe(false);
  });

  it("flags a template that states the wrong jury size", () => {
    const bad = validTemplates();
    bad[0] = { ...bad[0], body: `${bad[0].body}\nAll five jurors weigh in.` };
    const r = reconcileOutreach(bad);
    expect(r.jurorCountAccurate).toBe(false);
    expect(r.clean).toBe(false);
  });

  it("flags templates that never state the jury size", () => {
    const silent = validTemplates().map((t) => ({
      ...t,
      body: t.body.replace(/\bsix\b/gi, "the"),
    }));
    const r = reconcileOutreach(silent);
    expect(r.jurorCountAccurate).toBe(false);
  });

  it("flags a mis-cased product name", () => {
    const bad = validTemplates();
    bad[0] = { ...bad[0], body: bad[0].body.replace(/AdJury/g, "Adjury") };
    const r = reconcileOutreach(bad);
    expect(r.namesProduct).toBe(false);
    expect(r.clean).toBe(false);
  });

  it("is proven to key on the real roster — a seventh juror breaks the copy", () => {
    const r = reconcileOutreach(OUTREACH_TEMPLATES, OUTREACH_PLACEHOLDERS, 7);
    expect(r.jurorCountAccurate).toBe(false);
  });
});

// ── 3. Gates, templates, and helpers ─────────────────────────────────────────

describe("launch checklist — gates, templates, helpers", () => {
  it("counts total manual steps as the gates' live steps plus the three launch actions", () => {
    const readiness = buildLaunchChecklist(input);
    const gateManual = readiness.gates.reduce((n, g) => n + g.manualSteps, 0);
    expect(readiness.manualSteps).toBe(gateManual + 3);
    expect(gateManual).toBeGreaterThan(0); // the gates really do have live steps
  });

  it("every used merge field is a known placeholder", () => {
    const allowed = new Set(OUTREACH_PLACEHOLDERS);
    for (const p of usedPlaceholders(OUTREACH_TEMPLATES)) {
      expect(allowed.has(p), `unexpected merge field {{${p}}}`).toBe(true);
    }
  });

  it("every template has a non-empty audience, purpose, and body; emails have a subject", () => {
    for (const t of OUTREACH_TEMPLATES) {
      expect(t.id.trim().length).toBeGreaterThan(0);
      expect(t.audience.trim().length).toBeGreaterThan(0);
      expect(t.purpose.trim().length).toBeGreaterThan(0);
      expect(t.body.trim().length).toBeGreaterThan(0);
      if (t.channel === "email") expect((t.subject ?? "").trim().length).toBeGreaterThan(0);
    }
  });

  it("template ids are unique", () => {
    const ids = OUTREACH_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("summarizes the jury size from the real roster", () => {
    expect(launchJurySummary()).toBe("six jurors");
  });

  it("each launch area names a real runbook doc path", () => {
    for (const area of LAUNCH_AREAS) {
      expect(area.runbook.startsWith("docs/")).toBe(true);
      expect(area.day).toBeGreaterThan(0);
    }
  });
});
