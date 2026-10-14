/**
 * Abuse-protection audit (DailyPlan Day 47 — Week 7 security pass).
 *
 * "Abuse protections — review rate limits + basic abuse safeguards end-to-end.
 *  DoD: limits enforced consistently."
 *
 * The fourth Week-7 audit, after Day 43 (RLS), Day 44 (authz), Day 45 (input
 * hardening), and Day 46 (secrets). Where those proved the tenancy, identity,
 * input, and secret postures, this proves the ABUSE-PROTECTION posture of the
 * HTTP surface: every `/api` endpoint that costs real resources to serve — a
 * model fan-out, a serialization, or a tenant-data read — enforces a per-plan
 * rate limit, and it does so through ONE shared decision mechanism so the three
 * limiters can't drift ("limits enforced consistently").
 *
 * The app has three limiters, all built on the same pure `evaluateRateLimit`
 * decision + `rateLimitHeaders` / `composeRateLimitMessage` response helpers and
 * (for the two that count no persisted rows) the same `SlidingWindowStore`:
 *   - the REVIEW limiter   (Day 17) — `POST /api/reviews`, counts `reviews` rows;
 *   - the EXPORT limiter   (Day 40) — the two `…/export` routes, in-memory window;
 *   - the READ limiter     (Day 47) — the two JSON read routes, in-memory window.
 * Day 47 added the read limiter to close the real gap the audit surfaces: the
 * JSON read endpoints returned the same tenant data as their rate-limited export
 * siblings but were themselves un-limited, so a scraper could bypass the export
 * guard by hitting the JSON endpoints.
 *
 * Two pure, node-testable surfaces so the invariant is provable offline with no
 * Next request plumbing and no live database:
 *
 *  1. An ABUSE-SURFACE INVENTORY (`ABUSE_SURFACE_POSTURE`) — the single source of
 *     truth for every `/api` route module and the limiter mechanism(s) its
 *     handlers must enforce (a route may enforce more than one — `api/reviews`
 *     runs the review limiter on POST and the read limiter on GET). An unguarded
 *     route must be declared with an explicit `exemptReason` so leaving an
 *     endpoint un-limited is a deliberate, reviewed decision, never an oversight.
 *
 *  2. A STATIC SCANNER (`auditRouteAbuseProtection` / `auditAbuseSurface`) that
 *     reads the real route source and confirms each required mechanism's marker
 *     symbol (the limiter call it wires) is actually present — catching a route
 *     that is classified as guarded but silently drops its limiter.
 *
 * Plus a DRIFT GUARD (`reconcileAbuseSurface`): the test reconciles the inventory
 * against the routes discovered on disk so a NEW route can't ship without being
 * classified here (the same drift guard as Day 43's `POLICY_POSTURE`, Day 44's
 * endpoint inventory, Day 45's audited-schema set, and Day 46's env inventory).
 *
 * The scanner catches drift in the route source; the behavioral proofs in the
 * test drive the REAL limiters (`checkReadRateLimit`, `checkExportRateLimit`, and
 * `createReview`'s review limiter) to prove they share identical semantics — fail
 * closed to `free` for an unknown plan, block at the limit, and never consume a
 * slot when blocked — so "enforced consistently" holds at runtime, not just on
 * paper.
 *
 * Scope: the `/api` HTTP rate-limit surface, as the DoD names. Cost guardrails
 * (content size + token budget, Day 18) and input bounds (Day 45) are separate
 * abuse surfaces covered by their own suites and are intentionally not re-audited
 * here.
 */
import { stripTsComments, type RouteSource } from "@/lib/auth/authz-audit";

// ── Limiter mechanisms ───────────────────────────────────────────────────────

/** The three rate limiters a cost-bearing endpoint can enforce. */
export type AbuseMechanism = "review-limiter" | "export-limiter" | "read-limiter";

export interface AbuseMechanismSpec {
  /** The symbol whose presence in the route source proves the limiter is wired. */
  marker: string;
  /** What the mechanism guards and why it costs resources to serve. */
  note: string;
}

/**
 * Each mechanism's source marker — the limiter entry point a route must reference
 * for the protection to be live. The review limiter is wired by passing
 * `getRateUsage` into `createReview` (which enforces the limit before the
 * five-juror fan-out); the export/read limiters are called directly in the route.
 */
export const ABUSE_MECHANISMS: Record<AbuseMechanism, AbuseMechanismSpec> = {
  "review-limiter": {
    marker: "getRateUsage",
    note: "POST review — gates the five-juror model fan-out (AI cost, Day 17).",
  },
  "export-limiter": {
    marker: "checkExportRateLimit",
    note: "Export — gates serialization + anti-scraping of tenant data (Day 40).",
  },
  "read-limiter": {
    marker: "checkReadRateLimit",
    note: "JSON read — anti-scraping/DoS burst guard on tenant data (Day 47).",
  },
};

// ── Abuse-surface inventory ──────────────────────────────────────────────────

/**
 * The abuse posture of one `/api` route module. `path` is relative to `src/app`
 * (forward slashes, stable across OSes). `mechanisms` are the limiters its
 * handlers must enforce — empty only when the route is deliberately exempt, in
 * which case `exemptReason` must say why (so an un-limited endpoint is a reviewed
 * decision in the open, never a silent gap).
 */
export interface AbuseSurfaceEntry {
  path: string;
  mechanisms: readonly AbuseMechanism[];
  exemptReason?: string;
}

export const ABUSE_SURFACE_POSTURE: readonly AbuseSurfaceEntry[] = [
  // POST runs a review (review limiter → gates the model fan-out); GET lists the
  // company's reviews (read limiter → anti-scraping). Both in one module file.
  {
    path: "api/reviews/route.ts",
    mechanisms: ["review-limiter", "read-limiter"],
  },
  // GET one review as JSON — read limiter (same tenant data as its export sibling).
  { path: "api/reviews/[id]/route.ts", mechanisms: ["read-limiter"] },
  // GET history export (CSV) — export limiter.
  { path: "api/reviews/export/route.ts", mechanisms: ["export-limiter"] },
  // GET single-review export (CSV/PDF) — export limiter.
  { path: "api/reviews/[id]/export/route.ts", mechanisms: ["export-limiter"] },
];

// ── Static scanner over route source ─────────────────────────────────────────

export interface RouteAbuseAudit {
  /** Route module path relative to `src/app` (forward slashes). */
  path: string;
  /** Mechanisms the inventory requires this route to enforce. */
  requiredMechanisms: AbuseMechanism[];
  /** Required mechanisms whose marker symbol is present in the source. */
  presentMechanisms: AbuseMechanism[];
  /** Required mechanisms whose marker is ABSENT — a dropped-limiter defect. */
  missingMechanisms: AbuseMechanism[];
  /** True when the route is declared exempt (no mechanisms + a reason). */
  exempt: boolean;
}

/**
 * Audit one route module's source against its declared abuse posture. A required
 * mechanism is satisfied when its marker symbol appears in the comment-stripped
 * source (so a commented-out limiter can't pass). An exempt route (no required
 * mechanisms) is reported as such — the test additionally asserts it carries a
 * reason.
 */
export function auditRouteAbuseProtection(
  entry: AbuseSurfaceEntry,
  rawSrc: string,
): RouteAbuseAudit {
  const src = stripTsComments(rawSrc);
  const required = [...entry.mechanisms];
  const present: AbuseMechanism[] = [];
  const missing: AbuseMechanism[] = [];

  for (const mechanism of required) {
    const marker = ABUSE_MECHANISMS[mechanism].marker;
    if (src.includes(marker)) present.push(mechanism);
    else missing.push(mechanism);
  }

  return {
    path: entry.path,
    requiredMechanisms: required,
    presentMechanisms: present,
    missingMechanisms: missing,
    exempt: required.length === 0,
  };
}

/**
 * Audit every supplied route module against the inventory. A route on disk with
 * no inventory entry is NOT audited here (it would silently pass); the drift
 * guard (`reconcileAbuseSurface`) is what forces it to be classified first.
 */
export function auditAbuseSurface(
  routes: readonly RouteSource[],
): RouteAbuseAudit[] {
  const byPath = new Map(routes.map((r) => [r.path, r]));
  return ABUSE_SURFACE_POSTURE.map((entry) => {
    const route = byPath.get(entry.path);
    // A classified route that isn't on disk surfaces via reconcileAbuseSurface;
    // scanning its (absent) source as empty reports every mechanism missing,
    // which is the honest result.
    return auditRouteAbuseProtection(entry, route?.src ?? "");
  });
}

// ── Drift guard ──────────────────────────────────────────────────────────────

export interface AbuseSurfaceReconciliation {
  /** Route paths on disk but absent from `ABUSE_SURFACE_POSTURE` (unclassified). */
  missingFromPosture: string[];
  /** Inventory paths absent on disk (stale entries). */
  missingFromDisk: string[];
}

/**
 * Reconcile the declared inventory against the route paths discovered on disk. A
 * clean result (both arrays empty) means every `/api` route is accounted for in
 * `ABUSE_SURFACE_POSTURE` — so a newly added route forces an abuse-posture
 * decision (enforce a limiter, or declare an explicit exemption) rather than
 * silently escaping the audit.
 */
export function reconcileAbuseSurface(
  routePathsOnDisk: readonly string[],
): AbuseSurfaceReconciliation {
  const onDisk = new Set(routePathsOnDisk);
  const declared = new Set(ABUSE_SURFACE_POSTURE.map((e) => e.path));

  const missingFromPosture = [...onDisk].filter((p) => !declared.has(p)).sort();
  const missingFromDisk = [...declared].filter((p) => !onDisk.has(p)).sort();

  return { missingFromPosture, missingFromDisk };
}

/** The posture for a route path, or undefined if it is not classified. */
export function abusePostureFor(path: string): AbuseSurfaceEntry | undefined {
  return ABUSE_SURFACE_POSTURE.find((e) => e.path === path);
}
