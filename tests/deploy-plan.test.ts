import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  LOGIN_ROUTE,
  CORE_FLOW_STEPS,
  DEPLOY_STAGES,
  routeForPagePath,
  routeForApiPath,
  auditRoutePostures,
  buildSmokePlan,
  runSmokeProbe,
  joinUrl,
  buildDeployReadiness,
  reconcileDeployPlan,
  type ProbeFetch,
  type ProbeResponse,
  type DeployReadinessInput,
} from "@/lib/deploy/deploy-plan";

/**
 * Deploy plan & production smoke test (DailyPlan Day 79 — Week 12 deploy & launch prep).
 *
 * "Deploy to Vercel; smoke-test production. DoD: app live on a public URL; core
 *  flow works."
 *
 * The offline-verifiable half of the DoD runs here over the REAL repo: every page
 * route on disk is classified into a posture (no undeclared route), the smoke plan
 * is well-formed and covers exactly the static public/guarded routes, the
 * authenticated core-flow steps all resolve to real routes/endpoints on disk, and
 * the whole thing composes with the Day-78 prod readiness. The genuinely
 * live-deploy steps are asserted to be reported as `manual`, never faked. Each
 * scanner is also shown to BITE a planted fault so the clean result isn't vacuous.
 */

// ── Load the real route tree + prod inputs, as the script does ───────────────

const appDir = fileURLToPath(new URL("../src/app", import.meta.url));
const migrationsDir = fileURLToPath(new URL("../supabase/migrations", import.meta.url));
const envExamplePath = fileURLToPath(new URL("../.env.example", import.meta.url));

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

function realPagePaths(): string[] {
  return collectAppFiles("page.tsx");
}
function realApiPaths(): string[] {
  return collectAppFiles("route.ts");
}
function migrationFiles(): string[] {
  return readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
}
function migrationSql(): string {
  return migrationFiles()
    .slice()
    .sort()
    .map((f) => readFileSync(`${migrationsDir}/${f}`, "utf8"))
    .join("\n");
}
function envExample(): string {
  return readFileSync(envExamplePath, "utf8");
}

function realReadinessInput(overrides?: Partial<DeployReadinessInput>): DeployReadinessInput {
  return {
    pagePaths: realPagePaths(),
    hasNextConfig: true,
    hasBuildScript: true,
    prod: { migrationFiles: migrationFiles(), migrationSql: migrationSql(), envExample: envExample() },
    ...overrides,
  };
}

/** Build a fake probe response. */
function res(status: number, location?: string): ProbeResponse {
  return {
    status,
    headers: { get: (n: string) => (n.toLowerCase() === "location" ? location ?? null : null) },
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Day 79 — route posture over the real route tree", () => {
  const postures = auditRoutePostures(realPagePaths());

  it("loaded a non-trivial route set (so clean results aren't vacuous)", () => {
    expect(postures.count).toBeGreaterThan(8);
  });

  it("is clean — every page route on disk is classified, none undeclared", () => {
    expect(postures.undeclared, JSON.stringify(postures.undeclared)).toEqual([]);
    expect(postures.clean).toBe(true);
  });

  it("classifies (auth) + ungrouped marketing routes as public", () => {
    const byRoute = new Map(postures.pages.map((p) => [p.route, p]));
    for (const r of ["/", "/login", "/signup", "/pricing"]) {
      expect(byRoute.get(r)?.posture, `${r} should be public`).toBe("public");
    }
    // The bearer-token accept page is public and dynamic.
    expect(byRoute.get("/invite/[token]")?.posture).toBe("public");
    expect(byRoute.get("/invite/[token]")?.dynamic).toBe(true);
  });

  it("classifies (dashboard) routes + standalone onboarding as guarded", () => {
    const byRoute = new Map(postures.pages.map((p) => [p.route, p]));
    for (const r of [
      "/dashboard",
      "/review",
      "/history",
      "/analytics",
      "/brand",
      "/team",
      "/settings",
      "/account",
      "/onboarding",
    ]) {
      expect(byRoute.get(r)?.posture, `${r} should be guarded`).toBe("guarded");
    }
  });

  it("marks parameterized routes dynamic", () => {
    const review = postures.pages.find((p) => p.route === "/review/[id]");
    expect(review?.dynamic).toBe(true);
  });
});

describe("Day 79 — route path resolvers", () => {
  it("resolves page paths, stripping route groups", () => {
    expect(routeForPagePath("src/app/page.tsx")).toBe("/");
    expect(routeForPagePath("src/app/(auth)/login/page.tsx")).toBe("/login");
    expect(routeForPagePath("src/app/(dashboard)/review/[id]/page.tsx")).toBe("/review/[id]");
    expect(routeForPagePath("src/app/api/reviews/route.ts")).toBeNull();
  });

  it("resolves api route paths, stripping route groups", () => {
    expect(routeForApiPath("src/app/api/reviews/route.ts")).toBe("/api/reviews");
    expect(routeForApiPath("src/app/api/reviews/[id]/export/route.ts")).toBe(
      "/api/reviews/[id]/export",
    );
    expect(routeForApiPath("src/app/page.tsx")).toBeNull();
  });
});

describe("Day 79 — route posture bites planted faults", () => {
  it("records an undeclared ungrouped route rather than guessing its posture", () => {
    const audit = auditRoutePostures([
      "src/app/page.tsx",
      "src/app/secret-admin/page.tsx", // ungrouped, no declared posture
    ]);
    expect(audit.undeclared).toContain("/secret-admin");
    expect(audit.clean).toBe(false);
  });

  it("is not clean when the route set is empty", () => {
    const audit = auditRoutePostures([]);
    expect(audit.count).toBe(0);
    expect(audit.clean).toBe(false);
  });
});

describe("Day 79 — smoke plan", () => {
  const postures = auditRoutePostures(realPagePaths());
  const plan = buildSmokePlan(postures);

  it("has automatable + manual checks (non-vacuous)", () => {
    expect(plan.automatable.length).toBeGreaterThan(0);
    expect(plan.manual.length).toBeGreaterThan(0);
  });

  it("expects 2xx for public routes and a login redirect for guarded routes", () => {
    const byId = new Map(plan.checks.map((c) => [c.id, c]));
    expect(byId.get("route:/")?.expect).toBe("ok-2xx");
    expect(byId.get("route:/pricing")?.expect).toBe("ok-2xx");
    expect(byId.get("route:/dashboard")?.expect).toBe("redirect-to-login");
    expect(byId.get("route:/settings")?.expect).toBe("redirect-to-login");
  });

  it("covers exactly the static (non-dynamic) public + guarded routes", () => {
    const staticRoutes = postures.pages
      .filter((p) => !p.dynamic)
      .map((p) => p.route)
      .sort();
    expect([...plan.coveredRoutes].sort()).toEqual(staticRoutes);
  });

  it("routes dynamic pages + the authenticated core flow to the manual list", () => {
    const manualRoutes = new Set(plan.manual.map((c) => c.route));
    expect(manualRoutes.has("/review/[id]")).toBe(true); // dynamic page
    expect(manualRoutes.has("/invite/[token]")).toBe(true); // dynamic page
    // Every core-flow step appears as a manual check.
    for (const step of CORE_FLOW_STEPS) {
      expect(plan.manual.some((c) => c.id === `flow:${step.id}`)).toBe(true);
    }
  });
});

describe("Day 79 — smoke probe (injectable fetch)", () => {
  const plan = buildSmokePlan(auditRoutePostures(realPagePaths()));

  function fetchWith(map: Record<string, ProbeResponse>): ProbeFetch {
    return async (url) => {
      // Match by the route path suffix.
      const hit = Object.entries(map).find(([route]) => url.endsWith(route));
      if (!hit) throw new Error(`no stub for ${url}`);
      return hit[1];
    };
  }

  it("passes when public routes 2xx and guarded routes redirect to login", async () => {
    const fetchImpl: ProbeFetch = async (url) => {
      const route = url.replace("https://live.example", "");
      // Public routes 200; guarded routes 307 → /login.
      const check = plan.automatable.find((c) => c.route === route);
      if (check?.expect === "ok-2xx") return res(200);
      return res(307, `${LOGIN_ROUTE}?next=${route}`);
    };
    const run = await runSmokeProbe("https://live.example", plan, fetchImpl);
    expect(run.ok, JSON.stringify(run.results.filter((r) => !r.ok))).toBe(true);
    expect(run.failed).toBe(0);
    expect(run.passed).toBe(plan.automatable.length);
  });

  it("fails a public route that does not answer 2xx", async () => {
    const run = await runSmokeProbe(
      "https://live.example",
      buildSmokePlan(auditRoutePostures(["src/app/page.tsx"])),
      fetchWith({ "/": res(500) }),
    );
    expect(run.ok).toBe(false);
    expect(run.results[0].status).toBe(500);
  });

  it("fails a guarded route that does NOT fail closed (serves 200 while signed out)", async () => {
    const run = await runSmokeProbe(
      "https://live.example",
      buildSmokePlan(auditRoutePostures(["src/app/(dashboard)/settings/page.tsx"])),
      fetchWith({ "/settings": res(200) }),
    );
    expect(run.ok).toBe(false);
    expect(run.results[0].message).toContain(LOGIN_ROUTE);
  });

  it("fails a guarded route that redirects somewhere other than login", async () => {
    const run = await runSmokeProbe(
      "https://live.example",
      buildSmokePlan(auditRoutePostures(["src/app/(dashboard)/settings/page.tsx"])),
      fetchWith({ "/settings": res(307, "/elsewhere") }),
    );
    expect(run.ok).toBe(false);
  });

  it("records a thrown request as a failed check, not a crash", async () => {
    const throwing: ProbeFetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    const run = await runSmokeProbe(
      "https://live.example",
      buildSmokePlan(auditRoutePostures(["src/app/page.tsx"])),
      throwing,
    );
    expect(run.ok).toBe(false);
    expect(run.results[0].status).toBe(0);
    expect(run.results[0].message).toContain("request failed");
  });

  it("joinUrl composes base + route without a double slash", () => {
    expect(joinUrl("https://x.example/", "/review")).toBe("https://x.example/review");
    expect(joinUrl("https://x.example", "review")).toBe("https://x.example/review");
  });
});

describe("Day 79 — deploy readiness over the real repo", () => {
  const readiness = buildDeployReadiness(realReadinessInput());

  it("is offline-ready — the three repo-provable items pass", () => {
    const byId = new Map(readiness.items.map((i) => [i.id, i]));
    expect(byId.get("deploy-target")?.status).toBe("ready");
    expect(byId.get("smoke-plan")?.status).toBe("ready");
    expect(byId.get("prod-config-ready")?.status).toBe("ready");
    expect(readiness.ready).toBe(true);
  });

  it("reports the live-deploy steps as manual, never auto-done", () => {
    const manual = new Set(
      readiness.items.filter((i) => i.status === "manual").map((i) => i.id),
    );
    for (const id of [
      "vercel-deploy",
      "vercel-env",
      "prod-infra",
      "promote-prod",
      "custom-domain",
      "live-smoke",
    ]) {
      expect(manual.has(id), `${id} must be manual`).toBe(true);
    }
    expect(readiness.manualSteps).toBeGreaterThanOrEqual(6);
  });

  it("composes the Day-78 prod readiness", () => {
    expect(readiness.prod.ready).toBe(true);
    expect(readiness.prod.manualSteps).toBeGreaterThan(0);
  });

  it("is NOT ready when the deploy target is missing (no next config / build script)", () => {
    expect(buildDeployReadiness(realReadinessInput({ hasNextConfig: false })).ready).toBe(false);
    expect(buildDeployReadiness(realReadinessInput({ hasBuildScript: false })).ready).toBe(false);
  });

  it("is NOT ready when the Day-78 prod config is broken (e.g. no migrations)", () => {
    const broken = buildDeployReadiness(
      realReadinessInput({ prod: { migrationFiles: [], migrationSql: "", envExample: envExample() } }),
    );
    const byId = new Map(broken.items.map((i) => [i.id, i]));
    expect(byId.get("prod-config-ready")?.status).toBe("manual");
    expect(broken.ready).toBe(false);
  });
});

describe("Day 79 — reconcile (drift guard) over the real repo", () => {
  const reconcile = reconcileDeployPlan({
    pagePaths: realPagePaths(),
    apiPaths: realApiPaths(),
  });

  it("is clean — routes classified, smoke covers static routes, core flow real, stages intact", () => {
    expect(reconcile.routesAllClassified).toBe(true);
    expect(reconcile.smokeCoversStaticRoutes).toBe(true);
    expect(reconcile.coreFlowRoutesExist).toBe(true);
    expect(reconcile.stagesWellFormed).toBe(true);
    expect(reconcile.clean).toBe(true);
  });

  it("every core-flow step resolves to a real page route or API endpoint on disk", () => {
    const pageRoutes = new Set(
      auditRoutePostures(realPagePaths()).pages.map((p) => p.route),
    );
    const apiRoutes = new Set(
      realApiPaths()
        .map((p) => routeForApiPath(p))
        .filter((r): r is string => r !== null),
    );
    for (const step of CORE_FLOW_STEPS) {
      expect(
        pageRoutes.has(step.route) || apiRoutes.has(step.route),
        `core-flow step "${step.id}" → ${step.route} must be a real route`,
      ).toBe(true);
    }
  });

  it("is NOT clean when a core-flow route no longer exists on disk", () => {
    // Drop the pages that back the export endpoint AND the review routes, so a
    // core-flow step dangles.
    const reduced = reconcileDeployPlan({
      pagePaths: ["src/app/page.tsx", "src/app/(auth)/login/page.tsx"],
      apiPaths: [], // no API routes → the export step dangles
    });
    expect(reduced.coreFlowRoutesExist).toBe(false);
    expect(reduced.clean).toBe(false);
  });
});

describe("Day 79 — deploy stages + core flow shape", () => {
  it("names the test → prod → domain progression", () => {
    const ids = DEPLOY_STAGES.map((s) => s.id);
    expect(ids).toEqual(["test", "prod", "domain"]);
    for (const stage of DEPLOY_STAGES) {
      expect(stage.precondition.length).toBeGreaterThan(0);
    }
  });

  it("the core flow is the submit → scorecard → history → export spine", () => {
    const ids = CORE_FLOW_STEPS.map((s) => s.id);
    for (const id of ["log-in", "submit", "scorecard", "history", "export"]) {
      expect(ids).toContain(id);
    }
  });
});
