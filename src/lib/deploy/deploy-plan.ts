/**
 * Deploy plan & production smoke test (DailyPlan Day 79 — Week 12 deploy & launch prep).
 *
 * "Deploy to Vercel; smoke-test production.
 *  DoD: app live on a public URL; core flow works."
 *
 * This is the single source of truth for HOW AdJury reaches production and for
 * what "the core flow works" means as an executable check. Like the Day-78
 * prod-config core, everything here is PURE and node-testable, so the parts the
 * repo can prove offline — the deploy target is a standard Next app Vercel
 * auto-detects, the smoke plan is well-formed and derived from the REAL route
 * tree, and the Day-78 prod config is offline-ready — are checks that run with no
 * Vercel, no network and no live credential. The parts that genuinely need a
 * live deploy (running `vercel`, wiring the Vercel env, promoting preview→prod,
 * attaching the domain, and the live smoke run against the public URL) are
 * declared as explicit `manual` steps with their runbook — never faked.
 *
 * It composes, rather than restating:
 *   - the deploy target is gated on the Day-78 `buildProdReadiness` (prod config);
 *   - the route postures are derived from the REAL `src/app` route tree on disk,
 *     so the smoke plan can't drift from the routes that actually ship (mirrors
 *     the Day 54/63/66 "agrees with the real route tree" invariant);
 *   - the authenticated core-flow walkthrough points at the Day-68 user-test
 *     script rather than duplicating it.
 *
 * Four surfaces:
 *   1. ROUTE POSTURE — every page route on disk is `public` (served to anyone) or
 *      `guarded` (auth required; the middleware redirects an unauthenticated visit
 *      to /login). Grouped routes are classified by their `(group)` segment; the
 *      handful of ungrouped routes have an explicit declared posture, and an
 *      undeclared ungrouped route is surfaced as drift (never guessed).
 *   2. SMOKE PLAN — from the postures, the checks a deploy must pass: every public
 *      route answers 2xx, every guarded route FAILS CLOSED to /login when
 *      unauthenticated (a security smoke, not just a liveness one), and the
 *      authenticated core flow (submit → scorecard → history → export) is the
 *      manual walkthrough.
 *   3. SMOKE PROBE — an injectable runner that executes the automatable checks
 *      against a live base URL (used by `scripts/deploy-smoke.ts`); pure given a
 *      `fetch` impl, so it is node-testable with a fake.
 *   4. DEPLOY STAGES + READINESS + RECONCILE — the test→domain→prod progression,
 *      a ready/manual readiness report composing Day-78, and a drift guard.
 */

import {
  buildProdReadiness,
  type ProdReadiness,
  type ProdReadinessInput,
  type ReadinessItem,
} from "@/lib/deploy/prod-config";

// ── 1. Route posture ─────────────────────────────────────────────────────────

/** Where the login screen lives; every guarded route fails closed to here. */
export const LOGIN_ROUTE = "/login";

/**
 * `public`  — served to an unauthenticated visitor (landing, auth screens,
 *             pricing, the bearer-token invite accept page).
 * `guarded` — behind auth; an unauthenticated GET is redirected to /login by the
 *             middleware (the Day-4 coarse auth gate). Admin-only sub-gates live
 *             in Server Components on top of this.
 */
export type RoutePosture = "public" | "guarded";

export interface RoutePage {
  /** URL route, e.g. "/", "/review", "/review/[id]". */
  route: string;
  /** Repo-relative page path, e.g. "src/app/(dashboard)/review/page.tsx". */
  path: string;
  posture: RoutePosture;
  /** True when the route has a `[param]` segment (can't be GET-probed blindly). */
  dynamic: boolean;
}

export interface RoutePostureAudit {
  pages: RoutePage[];
  /**
   * Ungrouped routes with no declared posture — a new top-level route must
   * declare whether it is public or guarded rather than defaulting silently.
   */
  undeclared: string[];
  count: number;
  /** Every route classified (no undeclared), at least one page. */
  clean: boolean;
}

/**
 * Posture for the ungrouped (no `(group)`) page routes. Grouped routes are
 * classified by their group segment; these few are declared explicitly so a new
 * top-level route forces a posture decision (the drift guard flags an omission).
 */
const UNGROUPED_ROUTE_POSTURE: Record<string, RoutePosture> = {
  "/": "public", // marketing landing
  "/pricing": "public", // public pricing page (Day 73)
  "/onboarding": "guarded", // standalone, but admin-only behind auth (Day 22)
  "/invite/[token]": "public", // bearer-token accept page, reachable signed-out (Day 24)
};

/** The App-Router route a `src/app/.../page.tsx` renders (route groups stripped). */
export function routeForPagePath(path: string): string | null {
  const m = /^src\/app\/(.*)page\.tsx$/.exec(path);
  if (!m) return null;
  const segments = m[1]
    .split("/")
    .filter((s) => s.length > 0 && !(s.startsWith("(") && s.endsWith(")")));
  return `/${segments.join("/")}`;
}

/** The API path a `src/app/api/.../route.ts` serves (route groups stripped). */
export function routeForApiPath(path: string): string | null {
  const m = /^src\/app\/(.*)route\.ts$/.exec(path);
  if (!m) return null;
  const segments = m[1]
    .split("/")
    .filter((s) => s.length > 0 && !(s.startsWith("(") && s.endsWith(")")));
  return `/${segments.join("/")}`;
}

function postureForPagePath(path: string, route: string): RoutePosture | null {
  // A route-group segment is the primary signal.
  if (path.includes("/(dashboard)/")) return "guarded";
  if (path.includes("/(auth)/")) return "public";
  // Ungrouped: must be declared.
  return UNGROUPED_ROUTE_POSTURE[route] ?? null;
}

/**
 * Classify every page route on disk into a posture. Pure — the caller supplies
 * the page paths (the script/test read them from `src/app`). A route whose
 * posture can't be determined (an ungrouped route with no declared posture) is
 * recorded in `undeclared` rather than guessed, so the smoke plan never silently
 * treats a new guarded route as public.
 */
export function auditRoutePostures(pagePaths: readonly string[]): RoutePostureAudit {
  const pages: RoutePage[] = [];
  const undeclared: string[] = [];

  for (const path of pagePaths) {
    const route = routeForPagePath(path);
    if (route === null) continue;
    const posture = postureForPagePath(path, route);
    if (posture === null) {
      undeclared.push(route);
      continue;
    }
    pages.push({
      route,
      path,
      posture,
      dynamic: route.includes("["),
    });
  }

  pages.sort((a, b) => a.route.localeCompare(b.route));

  return {
    pages,
    undeclared,
    count: pages.length,
    clean: pages.length > 0 && undeclared.length === 0,
  };
}

// ── 2. Smoke plan ────────────────────────────────────────────────────────────

/**
 * `automatable` — a check `scripts/deploy-smoke.ts` runs against the live URL with
 *                 no credential (a GET of a static route).
 * `manual`      — needs a seeded account / live model (the authenticated core
 *                 flow) or a real id (a dynamic route).
 */
export type SmokeKind = "automatable" | "manual";

/** What a passing probe looks like for an automatable check. */
export type SmokeExpectation = "ok-2xx" | "redirect-to-login";

export interface SmokeCheck {
  id: string;
  kind: SmokeKind;
  /** The route or flow this check exercises. */
  route: string;
  title: string;
  /** Set for automatable checks — the response a live probe must see. */
  expect?: SmokeExpectation;
  detail: string;
}

export interface SmokePlan {
  checks: SmokeCheck[];
  automatable: SmokeCheck[];
  manual: SmokeCheck[];
  /** Routes the automatable checks cover (for the reconcile coverage proof). */
  coveredRoutes: string[];
}

/**
 * The ordered authenticated core-flow walkthrough — the "core flow works" half of
 * the DoD. Each step resolves to a real route (the reconcile proves it) and is a
 * manual check because it needs a signed-in, seeded account and the live model;
 * the end-to-end script for a human is docs/USER_TEST_SCRIPT.md (Day 68).
 */
export interface CoreFlowStep {
  id: string;
  title: string;
  route: string;
}

export const CORE_FLOW_STEPS: readonly CoreFlowStep[] = [
  { id: "log-in", title: "Log in with a seeded account", route: "/login" },
  { id: "submit", title: "Submit content and run the six jurors", route: "/review" },
  { id: "scorecard", title: "Read the returned scorecard (aggregate + verdict + jurors)", route: "/review" },
  { id: "history", title: "Open review history", route: "/history" },
  { id: "detail", title: "Open a past review's detail page", route: "/review/[id]" },
  { id: "export", title: "Export the review (CSV + PDF)", route: "/api/reviews/[id]/export" },
  { id: "analytics", title: "View the analytics dashboard", route: "/analytics" },
] as const;

/**
 * Build the production smoke plan from the classified routes. Every public,
 * non-dynamic route gets an "answers 2xx" liveness check; every guarded,
 * non-dynamic route gets a "redirects to /login when unauthenticated" check —
 * fail-closed, so the smoke proves tenancy isn't wide open, not merely that the
 * page renders. Dynamic routes and the authenticated core flow are the manual
 * walkthrough (they need a real id / a seeded session).
 */
export function buildSmokePlan(postures: RoutePostureAudit): SmokePlan {
  const checks: SmokeCheck[] = [];

  for (const page of postures.pages) {
    if (page.dynamic) {
      checks.push({
        id: `route:${page.route}`,
        kind: "manual",
        route: page.route,
        title: `Open ${page.route} with a real id`,
        detail:
          "Dynamic route — needs a real id/token from a seeded tenant; part of the authenticated walkthrough.",
      });
      continue;
    }
    if (page.posture === "public") {
      checks.push({
        id: `route:${page.route}`,
        kind: "automatable",
        route: page.route,
        title: `GET ${page.route} answers 2xx`,
        expect: "ok-2xx",
        detail: "Public route — must render for an unauthenticated visitor.",
      });
    } else {
      checks.push({
        id: `route:${page.route}`,
        kind: "automatable",
        route: page.route,
        title: `GET ${page.route} (unauthenticated) redirects to ${LOGIN_ROUTE}`,
        expect: "redirect-to-login",
        detail: "Guarded route — must fail closed to the login screen when signed out.",
      });
    }
  }

  for (const step of CORE_FLOW_STEPS) {
    checks.push({
      id: `flow:${step.id}`,
      kind: "manual",
      route: step.route,
      title: step.title,
      detail: "Authenticated core flow — walk it per docs/USER_TEST_SCRIPT.md (Day 68).",
    });
  }

  const automatable = checks.filter((c) => c.kind === "automatable");
  const manual = checks.filter((c) => c.kind === "manual");
  const coveredRoutes = automatable.map((c) => c.route);

  return { checks, automatable, manual, coveredRoutes };
}

// ── 3. Smoke probe (injectable) ──────────────────────────────────────────────

export interface SmokeProbeResult {
  check: SmokeCheck;
  ok: boolean;
  /** HTTP status the probe observed (0 if the request threw). */
  status: number;
  /** For a redirect, the observed Location header (if any). */
  location?: string;
  message: string;
}

export interface SmokeRunResult {
  baseUrl: string;
  results: SmokeProbeResult[];
  passed: number;
  failed: number;
  ok: boolean;
}

/** The minimal response shape the probe needs (a subset of the Fetch `Response`). */
export interface ProbeResponse {
  status: number;
  headers: { get(name: string): string | null };
}

export type ProbeFetch = (
  url: string,
  init: { redirect: "manual"; method: "GET" },
) => Promise<ProbeResponse>;

/** Join a base origin and an absolute route path without a double slash. */
export function joinUrl(baseUrl: string, route: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const path = route.startsWith("/") ? route : `/${route}`;
  return `${base}${path}`;
}

function evaluateProbe(
  check: SmokeCheck,
  res: ProbeResponse,
): { ok: boolean; location?: string; message: string } {
  const status = res.status;
  if (check.expect === "ok-2xx") {
    const ok = status >= 200 && status < 300;
    return { ok, message: ok ? `${status} OK` : `expected 2xx, got ${status}` };
  }
  // redirect-to-login: a 3xx whose Location points at the login route.
  const location = res.headers.get("location") ?? undefined;
  const isRedirect = status >= 300 && status < 400;
  const toLogin = location != null && location.includes(LOGIN_ROUTE);
  const ok = isRedirect && toLogin;
  return {
    ok,
    location,
    message: ok
      ? `${status} → ${location}`
      : isRedirect
        ? `redirected to ${location ?? "(no location)"}, expected ${LOGIN_ROUTE}`
        : `expected a redirect to ${LOGIN_ROUTE}, got ${status}`,
  };
}

/**
 * Run the automatable smoke checks against a live base URL. Injectable `fetchImpl`
 * (the script passes the real `fetch`; tests pass a fake), so this is pure and
 * node-testable. Requests use manual redirect handling so a guarded route's
 * redirect is observed rather than followed. A thrown request is a failed check,
 * never a crash.
 */
export async function runSmokeProbe(
  baseUrl: string,
  plan: SmokePlan,
  fetchImpl: ProbeFetch,
): Promise<SmokeRunResult> {
  const results: SmokeProbeResult[] = [];

  for (const check of plan.automatable) {
    const url = joinUrl(baseUrl, check.route);
    try {
      const res = await fetchImpl(url, { redirect: "manual", method: "GET" });
      const verdict = evaluateProbe(check, res);
      results.push({
        check,
        ok: verdict.ok,
        status: res.status,
        location: verdict.location,
        message: verdict.message,
      });
    } catch (err) {
      results.push({
        check,
        ok: false,
        status: 0,
        message: `request failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  return { baseUrl, results, passed, failed, ok: failed === 0 };
}

// ── 4. Deploy stages + readiness + reconcile ─────────────────────────────────

/**
 * The deploy progression (Architecture.md §6, Week 12 note): Vercel preview/test →
 * custom domain → production. Each stage names what must be true before it.
 */
export interface DeployStage {
  id: string;
  title: string;
  precondition: string;
}

export const DEPLOY_STAGES: readonly DeployStage[] = [
  {
    id: "test",
    title: "Vercel preview/test deploy",
    precondition:
      "Repo builds (`npm run build`) and the Vercel project exists; env vars set for the Preview scope.",
  },
  {
    id: "prod",
    title: "Promote to production",
    precondition:
      "Day-78 prod infra is live (prod Supabase + migrations + creatives bucket) and the required env vars are set for the Production scope.",
  },
  {
    id: "domain",
    title: "Attach the custom domain",
    precondition:
      "Production deploy is healthy; set NEXT_PUBLIC_APP_URL to the domain so absolute invite links resolve.",
  },
] as const;

export interface DeployReadinessInput {
  /** Page paths from `src/app` (to derive route postures + the smoke plan). */
  pagePaths: readonly string[];
  /** True when `next.config.mjs` (or equivalent) is present. */
  hasNextConfig: boolean;
  /** True when package.json defines a `build` script Vercel can run. */
  hasBuildScript: boolean;
  /** The Day-78 prod-config inputs (migrations + env example). */
  prod: ProdReadinessInput;
}

export interface DeployReadiness {
  items: ReadinessItem[];
  postures: RoutePostureAudit;
  plan: SmokePlan;
  prod: ProdReadiness;
  /** Every offline-verifiable item passed. */
  ready: boolean;
  manualSteps: number;
}

/**
 * Compose the deploy-readiness report. The `ready` items are what the repo proves
 * offline — the deploy target is a standard Next app Vercel auto-detects, the
 * smoke plan is well-formed and derived from the real route tree, and the Day-78
 * prod config is offline-ready. The `manual` items are the genuine live-deploy
 * steps (run `vercel`, wire the Vercel env, finish the Day-78 infra, promote to
 * prod, attach the domain, run the live smoke) — each carries its runbook pointer
 * and is never auto-marked done.
 */
export function buildDeployReadiness(input: DeployReadinessInput): DeployReadiness {
  const postures = auditRoutePostures(input.pagePaths);
  const plan = buildSmokePlan(postures);
  const prod = buildProdReadiness(input.prod);

  const targetReady = input.hasNextConfig && input.hasBuildScript;
  const planReady =
    postures.clean && plan.automatable.length > 0 && plan.manual.length > 0;

  const items: ReadinessItem[] = [
    {
      id: "deploy-target",
      title: "Deploy target is a standard Next.js app Vercel auto-detects",
      status: targetReady ? "ready" : "manual",
      detail:
        "next.config.mjs present and a `build` script defined — Vercel builds and serves the App Router with no extra config.",
    },
    {
      id: "smoke-plan",
      title: "Smoke plan is well-formed and derived from the real route tree",
      status: planReady ? "ready" : "manual",
      detail: `${plan.automatable.length} automatable check(s) + ${plan.manual.length} manual; every route classified (undeclared=${postures.undeclared.length}).`,
    },
    {
      id: "prod-config-ready",
      title: "Day-78 production config is offline-ready",
      status: prod.ready ? "ready" : "manual",
      detail:
        "Migrations apply-ready, RLS defined in the committed SQL, `.env.example` complete (see `npm run prod:check`).",
    },
    {
      id: "vercel-deploy",
      title: "Create the Vercel project and run a preview/test deploy",
      status: "manual",
      detail: "`vercel link` + `vercel` (preview). See docs/DEPLOYMENT.md §2.",
    },
    {
      id: "vercel-env",
      title: "Wire the required env vars in Vercel (secrets from their dashboards)",
      status: "manual",
      detail: "Set Production-scope env per docs/PRODUCTION_SETUP.md §4 / docs/DEPLOYMENT.md §3.",
    },
    {
      id: "prod-infra",
      title: "Finish the Day-78 live infra before promoting to prod",
      status: "manual",
      detail:
        "Prod Supabase + migrations + the private creatives bucket + live RLS verification (docs/PRODUCTION_SETUP.md §2–§5).",
    },
    {
      id: "promote-prod",
      title: "Promote the deploy to production",
      status: "manual",
      detail: "`vercel --prod` once the preview is healthy. See docs/DEPLOYMENT.md §4.",
    },
    {
      id: "custom-domain",
      title: "Attach the custom domain and set NEXT_PUBLIC_APP_URL",
      status: "manual",
      detail: "Add the domain in Vercel, then set NEXT_PUBLIC_APP_URL to it. See docs/DEPLOYMENT.md §5.",
    },
    {
      id: "live-smoke",
      title: "Run the live smoke against the public URL + the authenticated walkthrough",
      status: "manual",
      detail:
        "`SMOKE_BASE_URL=<url> npm run deploy:smoke` (automatable checks) + the core-flow walkthrough (docs/USER_TEST_SCRIPT.md). See docs/DEPLOYMENT.md §6.",
    },
  ];

  const OFFLINE_ITEM_IDS = ["deploy-target", "smoke-plan", "prod-config-ready"];
  const ready = items
    .filter((i) => OFFLINE_ITEM_IDS.includes(i.id))
    .every((i) => i.status === "ready");
  const manualSteps = items.filter((i) => i.status === "manual").length;

  return { items, postures, plan, prod, ready, manualSteps };
}

export interface DeployPlanReconcile {
  /** Every page route on disk is classified (no undeclared ungrouped route). */
  routesAllClassified: boolean;
  /** Every non-dynamic public/guarded route has an automatable smoke check. */
  smokeCoversStaticRoutes: boolean;
  /** Every core-flow step resolves to a real route on disk. */
  coreFlowRoutesExist: boolean;
  /** The deploy stages name the test→prod→domain progression. */
  stagesWellFormed: boolean;
  clean: boolean;
}

/**
 * Executable DoD + drift guard (the Day 43–78 "inventory + reconcile" pattern):
 * every route on disk is classified, the automatable smoke checks cover exactly
 * the static (non-dynamic) public/guarded routes, every authenticated core-flow
 * step points at a real route (page or API) on disk, and the staged progression
 * is intact. `realApiRoutes` is the set of API paths on disk so a core-flow step
 * that targets an endpoint is proven real too.
 */
export function reconcileDeployPlan(input: {
  pagePaths: readonly string[];
  apiPaths: readonly string[];
}): DeployPlanReconcile {
  const postures = auditRoutePostures(input.pagePaths);
  const plan = buildSmokePlan(postures);

  const routesAllClassified = postures.undeclared.length === 0 && postures.count > 0;

  const staticRoutes = postures.pages
    .filter((p) => !p.dynamic)
    .map((p) => p.route)
    .sort();
  const covered = [...plan.coveredRoutes].sort();
  const smokeCoversStaticRoutes =
    staticRoutes.length === covered.length &&
    staticRoutes.every((r, i) => r === covered[i]);

  const realPageRoutes = new Set(postures.pages.map((p) => p.route));
  const realApiRoutes = new Set(
    input.apiPaths
      .map((p) => routeForApiPath(p))
      .filter((r): r is string => r !== null),
  );
  const coreFlowRoutesExist = CORE_FLOW_STEPS.every(
    (s) => realPageRoutes.has(s.route) || realApiRoutes.has(s.route),
  );

  const stageIds = DEPLOY_STAGES.map((s) => s.id);
  const stagesWellFormed =
    stageIds.includes("test") && stageIds.includes("prod") && stageIds.includes("domain");

  return {
    routesAllClassified,
    smokeCoversStaticRoutes,
    coreFlowRoutesExist,
    stagesWellFormed,
    clean:
      routesAllClassified &&
      smokeCoversStaticRoutes &&
      coreFlowRoutesExist &&
      stagesWellFormed,
  };
}
