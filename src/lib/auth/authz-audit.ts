/**
 * Authorization audit (DailyPlan Day 44 — Week 7 security pass).
 *
 * "Server-side authorization review across all `/api` routes. DoD: no route
 * trusts client-supplied identity."
 *
 * The companion to Day 43's RLS audit. Where Day 43 proved the DATABASE-layer
 * tenancy posture (RLS policies), this proves the APPLICATION-layer authz
 * posture of the HTTP surface: every `/api` route resolves identity from the
 * server session and never from the request body, URL, or path — so no route
 * can be tricked into acting as another company (Rules.md §5) or as an
 * unauthenticated caller (Rules.md §6 — fail closed on anything touching authz).
 *
 * Two pure, node-testable surfaces so the invariant is provable offline with no
 * Next request plumbing and no live database:
 *
 *  1. A STATIC SCANNER (`auditRouteSource` / `auditApiRoutes`) that reads the
 *     real route source files and enforces, per handler file:
 *       - identity is resolved server-side via `getSessionContext()`;
 *       - that resolution FAILS CLOSED (`.catch(() => null)` → treated as no
 *         session) so a missing-env/transient failure denies rather than crashes
 *         or, worse, proceeds;
 *       - the file reads NO identity field (`company_id` / `submitted_by` /
 *         `role`) from any client-controlled source (request body, URL query, or
 *         path params) — a path `id` is a resource selector, not identity, and is
 *         allowed.
 *
 *  2. An ENDPOINT INVENTORY (`API_ENDPOINT_INVENTORY`) — the single source of
 *     truth for which `/api` endpoints exist and their intended posture (which
 *     methods, whether each requires an authenticated session). The test asserts
 *     the inventory equals what is actually on disk, so a NEW route cannot ship
 *     without being added here and meeting the posture (the same drift guard as
 *     Day 43's `POLICY_POSTURE`).
 *
 * The scanner catches drift in the route source; the behavioral proofs in the
 * test drive the REAL endpoint cores (`createReview`, `getReviewForCompany`,
 * `listReviewsForCompany`, `checkExportRateLimit`) to prove the runtime
 * consequence: an unauthenticated caller is denied, and the company reaching the
 * data layer is always the session's — never a value the client supplied.
 *
 * Scope: the `/api` HTTP routes, as the DoD names. The other server-side authz
 * surfaces are covered by their own suites and are intentionally NOT re-scanned
 * here: the Next middleware + route guards (`tests/auth-access.test.ts`), the
 * admin-gated server actions (`tests/company-*.test.ts`), and the DB-layer
 * tenancy (Day 43 RLS audit + `tests/reviews-tenancy.test.ts`).
 */

// ── API endpoint inventory ──────────────────────────────────────────────────

/** HTTP methods a Next App-Router route module can export as handlers. */
export type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export const API_METHODS: readonly ApiMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
];

/**
 * The intended authz posture of one `/api` route module — the single source of
 * truth the audit checks the on-disk routes against.
 *
 * `path` is the route module's path relative to `src/app` (forward slashes,
 * stable across OSes). `methods` are the HTTP handlers it is expected to export.
 * `requiresSession` is `true` for every current endpoint: all four serve a
 * tenant's own data and must fail closed for an unauthenticated caller. It is
 * kept explicit (rather than assumed) so a future public endpoint can be
 * declared `false` deliberately, in the open, rather than slipping the net.
 */
export interface EndpointPosture {
  path: string;
  methods: readonly ApiMethod[];
  requiresSession: boolean;
}

export const API_ENDPOINT_INVENTORY: readonly EndpointPosture[] = [
  // POST runs a review; GET lists the company's reviews. Both tenant-scoped.
  { path: "api/reviews/route.ts", methods: ["GET", "POST"], requiresSession: true },
  // GET one review by id, scoped to the caller's company (404 cross-tenant).
  { path: "api/reviews/[id]/route.ts", methods: ["GET"], requiresSession: true },
  // GET history export (CSV), same tenancy as the list endpoint.
  { path: "api/reviews/export/route.ts", methods: ["GET"], requiresSession: true },
  // GET single-review export (CSV/PDF), same tenancy as the by-id endpoint.
  {
    path: "api/reviews/[id]/export/route.ts",
    methods: ["GET"],
    requiresSession: true,
  },
];

// ── Client-supplied identity fields (must never drive authz) ────────────────

/**
 * Identity fields that determine WHO the caller is / WHAT company they act as.
 * These must always come from the server-resolved session, never the client
 * (Rules.md §5). A route reading any of these from the request body, URL query,
 * or path params would be trusting client-supplied identity — the exact defect
 * the DoD forbids.
 *
 * A path `id` (the review id in `/api/reviews/[id]`) is deliberately absent: it
 * selects WHICH resource, not WHO the caller is, and tenancy still collapses an
 * absent-or-other-company row to 404 downstream (Rules.md §6).
 */
export const CLIENT_IDENTITY_FIELDS = [
  "company_id",
  "companyId",
  "submitted_by",
  "submittedBy",
  "role",
] as const;

const IDENTITY_ALTERNATION = CLIENT_IDENTITY_FIELDS.join("|");

/**
 * Concrete ways a handler could read an identity field from a client-controlled
 * source. Each is labeled so a violation names the vector. Deliberately targeted
 * (not a blunt substring search) so legitimate server-derived reads —
 * `session.companyId`, `deps.session.companyId` — never match: none of these
 * patterns begin at a `session`/`deps` accessor.
 */
interface ClientReadPattern {
  label: string;
  re: RegExp;
}

const CLIENT_IDENTITY_READ_PATTERNS: readonly ClientReadPattern[] = [
  // URL query string: new URL(request.url).searchParams.get("company_id"), etc.
  {
    label: "URL query parameter",
    re: new RegExp(`\\.get\\(\\s*["'\`](?:${IDENTITY_ALTERNATION})["'\`]`, "i"),
  },
  // Path params: params.company_id / params.role (params.id is allowed — it is
  // a resource selector, not an identity field, so it is not in the list).
  {
    label: "path param property",
    re: new RegExp(`\\bparams\\s*\\.\\s*(?:${IDENTITY_ALTERNATION})\\b`, "i"),
  },
  // Destructured path params: const { company_id } = await params.
  {
    label: "destructured path param",
    re: new RegExp(
      `\\{[^{}]*\\b(?:${IDENTITY_ALTERNATION})\\b[^{}]*\\}\\s*=\\s*await\\s+params`,
      "i",
    ),
  },
  // Request body dot-access: body.company_id (body is parsed client JSON).
  {
    label: "request body property",
    re: new RegExp(`\\bbody\\s*\\.\\s*(?:${IDENTITY_ALTERNATION})\\b`, "i"),
  },
  // Request body bracket-access: body["company_id"].
  {
    label: "request body index",
    re: new RegExp(
      `\\bbody\\[\\s*["'\`](?:${IDENTITY_ALTERNATION})["'\`]\\s*\\]`,
      "i",
    ),
  },
  // A validated payload that still surfaced an identity field: parsed.data.role.
  {
    label: "validated-payload identity field",
    re: new RegExp(
      `\\bparsed\\.data\\s*\\.\\s*(?:${IDENTITY_ALTERNATION})\\b`,
      "i",
    ),
  },
];

// ── Static scanner over route source ────────────────────────────────────────

export interface RouteAudit {
  /** Route module path relative to `src/app` (forward slashes). */
  path: string;
  /** HTTP handlers the module exports, in `API_METHODS` order. */
  methods: ApiMethod[];
  /** The module calls `getSessionContext()` — identity is resolved server-side. */
  resolvesSessionServerSide: boolean;
  /**
   * The session resolution fails closed: a resolution failure is turned into
   * "no session" (`getSessionContext().catch(() => null)`), so a missing-env or
   * transient Supabase failure denies rather than crashes or proceeds.
   */
  sessionFailsClosed: boolean;
  /**
   * Labeled client-identity reads found in the source (empty == clean). A
   * non-empty list means the route reads an identity field from client input —
   * a DoD violation.
   */
  clientIdentityReads: string[];
}

/** Strip line and block comments so commented-out code can't match (or hide) a pattern. */
export function stripTsComments(src: string): string {
  // Block comments first, then line comments. Good enough for audit scanning —
  // the route files don't contain comment markers inside string literals that
  // would matter here.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const EXPORT_HANDLER_RE =
  /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g;

/** Methods a route module exports as HTTP handlers, in canonical order. */
export function findExportedHandlers(src: string): ApiMethod[] {
  const found = new Set<ApiMethod>();
  for (const m of src.matchAll(EXPORT_HANDLER_RE)) {
    found.add(m[1] as ApiMethod);
  }
  return API_METHODS.filter((m) => found.has(m));
}

const SESSION_RESOLVE_RE = /getSessionContext\s*\(/;
// Fail-closed: the resolution's rejection is mapped to null (no session). We
// accept any `.catch(` immediately on the getSessionContext() call so an
// equivalent handler (e.g. `.catch(() => null)`) still passes.
const SESSION_FAILS_CLOSED_RE = /getSessionContext\s*\(\s*\)\s*\.catch\s*\(/;

/** Audit a single route module's source against the authz invariants. */
export function auditRouteSource(path: string, rawSrc: string): RouteAudit {
  const src = stripTsComments(rawSrc);

  const clientIdentityReads: string[] = [];
  for (const { label, re } of CLIENT_IDENTITY_READ_PATTERNS) {
    if (re.test(src)) clientIdentityReads.push(label);
  }

  return {
    path,
    methods: findExportedHandlers(src),
    resolvesSessionServerSide: SESSION_RESOLVE_RE.test(src),
    sessionFailsClosed: SESSION_FAILS_CLOSED_RE.test(src),
    clientIdentityReads,
  };
}

export interface RouteSource {
  /** Route module path relative to `src/app` (forward slashes). */
  path: string;
  src: string;
}

/** Audit every supplied route module. */
export function auditApiRoutes(routes: readonly RouteSource[]): RouteAudit[] {
  return routes.map((r) => auditRouteSource(r.path, r.src));
}

// ── Inventory reconciliation ────────────────────────────────────────────────

export interface InventoryReconciliation {
  /** Paths on disk but absent from `API_ENDPOINT_INVENTORY` (unaudited routes). */
  missingFromInventory: string[];
  /** Paths in the inventory but absent on disk (stale inventory entries). */
  missingFromDisk: string[];
  /** Inventory paths whose exported methods don't match what's on disk. */
  methodMismatches: {
    path: string;
    expected: ApiMethod[];
    actual: ApiMethod[];
  }[];
}

/**
 * Reconcile the declared inventory against the routes discovered on disk. A
 * clean result (all three arrays empty) means every `/api` route is accounted
 * for in `API_ENDPOINT_INVENTORY` with the expected methods — so a newly added
 * route forces an inventory update (and thus a posture decision) rather than
 * silently escaping the audit.
 */
export function reconcileInventory(
  audits: readonly RouteAudit[],
): InventoryReconciliation {
  const onDisk = new Map(audits.map((a) => [a.path, a]));
  const declared = new Map(API_ENDPOINT_INVENTORY.map((e) => [e.path, e]));

  const missingFromInventory = audits
    .map((a) => a.path)
    .filter((p) => !declared.has(p))
    .sort();

  const missingFromDisk = API_ENDPOINT_INVENTORY.map((e) => e.path)
    .filter((p) => !onDisk.has(p))
    .sort();

  const methodMismatches: InventoryReconciliation["methodMismatches"] = [];
  for (const entry of API_ENDPOINT_INVENTORY) {
    const audit = onDisk.get(entry.path);
    if (!audit) continue;
    const expected = API_METHODS.filter((m) => entry.methods.includes(m));
    const actual = audit.methods;
    const same =
      expected.length === actual.length &&
      expected.every((m, i) => m === actual[i]);
    if (!same) methodMismatches.push({ path: entry.path, expected, actual });
  }

  return { missingFromInventory, missingFromDisk, methodMismatches };
}

/**
 * The posture for a route path, or undefined if it is not in the inventory.
 * Lets the test assert that a `requiresSession` route actually fails closed and
 * resolves the session server-side.
 */
export function postureFor(path: string): EndpointPosture | undefined {
  return API_ENDPOINT_INVENTORY.find((e) => e.path === path);
}
