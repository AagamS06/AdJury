import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  parseSchemaSql,
  auditSchema,
  auditAuthCompanyIdFn,
  policyAllows,
  type Principal,
  type TenantRowRef,
} from "@/lib/db/rls-audit";
import {
  API_ENDPOINT_INVENTORY,
  auditApiRoutes,
  reconcileInventory,
  postureFor,
  type RouteSource,
} from "@/lib/auth/authz-audit";
import {
  INPUT_SCHEMA_SOURCE_FILES,
  findExportedSchemaNames,
  reconcileAuditedSchemas,
} from "@/lib/validation/input-audit";
import {
  buildModuleGraph,
  auditClientBundle,
  auditEnvExample,
  auditGitignore,
  envValueLooksLikeSecret,
  type SourceModule,
} from "@/lib/security/secrets-audit";
import {
  ABUSE_MECHANISMS,
  ABUSE_SURFACE_POSTURE,
  auditAbuseSurface,
  reconcileAbuseSurface,
} from "@/lib/security/abuse-audit";
import { auditLoggingSurface, type SourceFile } from "@/lib/observability/logging-audit";
import {
  REDACTED_KEYS,
  REDACTED_VALUE,
  REDACTED_SECRET_VALUE,
  redactLogContext,
} from "@/lib/observability/logger";
import { createInMemorySlidingWindowStore } from "@/lib/security/rate-limit-store";

import { getReviewForCompany } from "@/lib/reviews/read-reviews";
import { ReviewRequestSchema } from "@/lib/schema/juror";
import { credentialsSchema } from "@/lib/auth/schema";
import { MAX_CONTENT_CHARS } from "@/lib/ai/cost";
import { MAX_EMAIL_CHARS } from "@/lib/validation/limits";
import { evaluateRateLimit, resolveRateLimitPolicy } from "@/lib/rate-limit";
import {
  checkReadRateLimit,
  createInMemoryReadRateStore,
  resolveReadRateLimitPolicy,
} from "@/lib/reviews/read-access";
import {
  checkExportRateLimit,
  createInMemoryExportRateStore,
  resolveExportRateLimitPolicy,
} from "@/lib/reviews/export-access";

import type { SessionContext } from "@/lib/auth/session";
import type { PlanTier, ReviewWithScores } from "@/types/db";

/**
 * Week 7 hardening (DailyPlan Day 49) — security & cost pass integration.
 *
 * Week 7 shipped six audits, each proved in isolation by its own per-day suite:
 * Day 43 (RLS — `rls-audit.test`), Day 44 (authz — `authz-audit.test`), Day 45
 * (input hardening — `input-hardening.test`), Day 46 (secrets — `secrets-audit.
 * test`), Day 47 (abuse protections — `abuse-audit.test` / `read-access.test`),
 * and Day 48 (observability — `observability.test` / `logging-audit.test`). Each
 * of those loads only its own slice of the codebase and proves its own invariant.
 *
 * This is the week-end integration complement (mirroring the Day 7/14/21/28/35/42
 * passes): no new product surface — it wires the REAL Week-7 cores together over
 * ONE shared snapshot of the real repository and proves the week's invariants
 * COMPOSE across the whole surface, and that the audits AGREE with one another
 * and with the runtime cores — properties no single-day suite can see because
 * each reads only its own slice:
 *
 *  1. The entire security posture audits clean TOGETHER on one on-disk snapshot:
 *     all six audits pass simultaneously over the same real `src/**`, `/api`
 *     routes, migrations, `.env.example`, and `.gitignore`.
 *  2. The audit inventories AGREE with each other: the Day-44 authz endpoint
 *     inventory, the Day-47 abuse-surface inventory, and the routes actually on
 *     disk name the identical `/api` route set, and every cost-bearing route is
 *     also an authenticated one. (No per-day suite cross-checks two inventories.)
 *  3. Tenancy is defense-in-depth: the SAME cross-tenant read is denied at BOTH
 *     the DB layer (the Day-43 RLS model) AND the app layer (the real Day-6 read
 *     core) — the two layers agree on one shared fixture.
 *  4. The three rate limiters are provably ONE mechanism: review/export/read
 *     share identical decision semantics (fail-closed to free, block at the
 *     limit, a blocked request consumes no slot), and the export + read stores are
 *     literally the same shared `SlidingWindowStore` factory (the Day-47
 *     consolidation).
 *  5. The content/secret boundary composes across input + logging: an oversized
 *     field is rejected at the input boundary AND the logger's redactor drops that
 *     same field from any failure log, and the secret-shaped-value heuristic is
 *     ONE function shared by the secrets audit (`.env.example`) and the log
 *     redactor — so a credential is caught in both places (Rules.md §7).
 *
 * All offline (no live model/DB/bundler) — the audits read the real committed
 * source and the cores are the trust boundary, so exercising them together over
 * one snapshot is a faithful integration test.
 */

// ── Load ONE shared snapshot of the real repository ──────────────────────────

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(`${repoRoot}${rel}`, "utf8");

/** Every `.ts`/`.tsx` under `src/`, path repo-relative WITH the `src/` prefix
 *  (the module-graph key convention the secrets audit resolves `@/` against). */
function loadSrcModules(): SourceModule[] {
  const out: SourceModule[] = [];
  function walk(absDir: string, rel: string): void {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const abs = `${absDir}/${entry.name}`;
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(abs, childRel);
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        out.push({ path: childRel, src: readFileSync(abs, "utf8") });
      }
    }
  }
  walk(`${repoRoot}src`, "src");
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** The same files keyed relative to `src/` (no prefix) — the logging audit's
 *  convention. Derived from the single snapshot so both views are consistent. */
function toLoggingFiles(modules: readonly SourceModule[]): SourceFile[] {
  return modules.map((m) => ({ path: m.path.replace(/^src\//, ""), src: m.src }));
}

/** Every `route.ts` under `src/app/api`, path relative to `src/app`. */
function loadApiRoutes(): RouteSource[] {
  const apiDir = `${repoRoot}src/app/api`;
  const out: RouteSource[] = [];
  function walk(dir: string, rel: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = `${dir}/${entry.name}`;
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(abs, childRel);
      else if (entry.name === "route.ts") {
        out.push({ path: childRel, src: readFileSync(abs, "utf8") });
      }
    }
  }
  walk(apiDir, "api");
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** All committed migrations concatenated in order (the effective schema). */
function loadMigrations(): string {
  const dir = `${repoRoot}supabase/migrations`;
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(`${dir}/${f}`, "utf8"))
    .join("\n");
}

const SRC_MODULES = loadSrcModules();
const SRC_LOGGING_FILES = toLoggingFiles(SRC_MODULES);
const API_ROUTES = loadApiRoutes();
const MIGRATIONS_SQL = loadMigrations();
const ENV_EXAMPLE = read(".env.example");
const GITIGNORE = read(".gitignore");

// ── shared identity ──────────────────────────────────────────────────────────

const COMPANY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function session(
  companyId: string,
  opts: { role?: "admin" | "member"; plan?: PlanTier } = {},
): SessionContext {
  const plan = opts.plan ?? "free";
  return {
    authUserId: `${companyId.slice(0, 8)}-0000-0000-0000-000000000001`,
    email: "user@acme.test",
    companyId,
    role: opts.role ?? "admin",
    company: {
      id: companyId,
      name: "Acme",
      industry: null,
      plan_tier: plan,
      juror_weights: null,
      onboarded_at: "2026-08-31T00:00:00.000Z",
      created_at: "2026-08-31T00:00:00.000Z",
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Week 7 hardening — security & cost pass integration", () => {
  // ── 1. the whole security posture audits clean TOGETHER ───────────────────
  describe("all six Week-7 audits pass over one real on-disk snapshot", () => {
    it("loaded a non-trivial snapshot (so a clean audit actually means something)", () => {
      expect(SRC_MODULES.length).toBeGreaterThan(40);
      expect(API_ROUTES.length).toBeGreaterThan(0);
      expect(MIGRATIONS_SQL.length).toBeGreaterThan(500);
    });

    it("Day 43 — RLS: every tenant table is policy-sound and the helper is hardened", () => {
      const parsed = parseSchemaSql(MIGRATIONS_SQL);
      for (const audit of auditSchema(parsed)) {
        expect(audit.rlsEnabled, `${audit.table} RLS disabled`).toBe(true);
        expect(audit.allPoliciesCompanyScoped, `${audit.table} not company-scoped`).toBe(true);
        expect(audit.hasWildcardPolicy, `${audit.table} has a using(true) policy`).toBe(false);
        expect(audit.postureMatches, `${audit.table} posture drift`).toBe(true);
        expect(audit.adminGatesPresent, `${audit.table} missing admin gate`).toBe(true);
      }
      // The recursion fix (Day 43 finding): the effective helper is SECURITY
      // DEFINER with a pinned search_path.
      const fn = auditAuthCompanyIdFn(parsed);
      expect(fn).toEqual({ defined: true, securityDefiner: true, pinnedSearchPath: true });
    });

    it("Day 44 — authz: every /api route resolves the session server-side, fails closed, trusts no client identity", () => {
      const audits = auditApiRoutes(API_ROUTES);
      for (const a of audits) {
        expect(a.resolvesSessionServerSide, `${a.path} does not resolve a session`).toBe(true);
        expect(a.sessionFailsClosed, `${a.path} does not fail closed`).toBe(true);
        expect(a.clientIdentityReads, `${a.path} reads client identity`).toEqual([]);
      }
      const recon = reconcileInventory(audits);
      expect(recon.missingFromInventory).toEqual([]);
      expect(recon.missingFromDisk).toEqual([]);
      expect(recon.methodMismatches).toEqual([]);
    });

    it("Day 45 — input hardening: every exported input schema is audited (no drift)", () => {
      const discovered: string[] = [];
      for (const rel of INPUT_SCHEMA_SOURCE_FILES) {
        discovered.push(...findExportedSchemaNames(read(`src/${rel}`)));
      }
      const recon = reconcileAuditedSchemas(discovered);
      expect(recon.unaudited).toEqual([]);
      expect(recon.missingFromSource).toEqual([]);
    });

    it("Day 46 — secrets: no client-reachable module leaks a secret; .env.example + .gitignore clean", () => {
      const bundle = auditClientBundle(buildModuleGraph(SRC_MODULES));
      expect(bundle.leaks).toEqual([]);
      expect(bundle.reachable.length).toBeGreaterThan(0);

      const env = auditEnvExample(ENV_EXAMPLE);
      expect(env.missingFromExample).toEqual([]);
      expect(env.extraInExample).toEqual([]);
      expect(env.exposureMismatches).toEqual([]);
      expect(env.secretValueLeaks).toEqual([]);
      expect(env.duplicateKeys).toEqual([]);

      const ignore = auditGitignore(GITIGNORE);
      expect(ignore.ignoresEnvLocal).toBe(true);
      expect(ignore.ignoresEnvFile).toBe(true);
    });

    it("Day 47 — abuse: every cost-bearing route wires its limiter and the surface has no drift", () => {
      for (const audit of auditAbuseSurface(API_ROUTES)) {
        expect(audit.missingMechanisms, `${audit.path} dropped a limiter`).toEqual([]);
      }
      const recon = reconcileAbuseSurface(API_ROUTES.map((r) => r.path));
      expect(recon.missingFromPosture).toEqual([]);
      expect(recon.missingFromDisk).toEqual([]);
    });

    it("Day 48 — observability: no unsanctioned console.* anywhere in the tree", () => {
      const result = auditLoggingSurface(SRC_LOGGING_FILES);
      expect(result.unsanctioned).toEqual([]);
      expect(result.staleSinks).toEqual([]);
    });
  });

  // ── 2. the audit inventories AGREE with one another ───────────────────────
  describe("the authz and abuse inventories agree on the same /api surface", () => {
    it("both inventories and the disk name the identical set of routes", () => {
      const onDisk = API_ROUTES.map((r) => r.path).sort();
      const authzPaths = API_ENDPOINT_INVENTORY.map((e) => e.path).sort();
      const abusePaths = ABUSE_SURFACE_POSTURE.map((e) => e.path).sort();

      expect(authzPaths).toEqual(onDisk);
      expect(abusePaths).toEqual(onDisk);
      // ...hence equal to each other (transitively), proven explicitly:
      expect(abusePaths).toEqual(authzPaths);
    });

    it("every route with a rate limiter is also declared to require a session", () => {
      // A cost-bearing endpoint serves tenant data, so it must fail closed for an
      // anonymous caller — the authz inventory and the abuse inventory must agree
      // on that for the SAME route, or one audit's guarantee would undercut the
      // other's.
      for (const entry of ABUSE_SURFACE_POSTURE) {
        if (entry.mechanisms.length === 0) continue; // an explicit exemption
        const posture = postureFor(entry.path);
        expect(posture, `${entry.path} missing from the authz inventory`).toBeDefined();
        expect(posture!.requiresSession, `${entry.path} limited but public`).toBe(true);
      }
    });

    it("every declared limiter mechanism is backed by a marker symbol", () => {
      // The two inventories reference mechanisms by name; each name must resolve to
      // a concrete source marker so the static scanner can actually find it.
      for (const entry of ABUSE_SURFACE_POSTURE) {
        for (const mechanism of entry.mechanisms) {
          expect(ABUSE_MECHANISMS[mechanism]?.marker, `no marker for ${mechanism}`).toBeTruthy();
        }
      }
    });
  });

  // ── 3. tenancy is defense-in-depth (DB model AND app core agree) ──────────
  describe("a cross-tenant read is denied at both the RLS layer and the app layer", () => {
    const reviewRow: ReviewWithScores = {
      review: {
        id: "11111111-1111-1111-1111-111111111111",
        company_id: COMPANY_A,
        submitted_by: `${COMPANY_A.slice(0, 8)}-0000-0000-0000-000000000001`,
        content_text: "COMPANY-A-SECRET widget copy",
        content_type: "ad_copy",
        platform: "instagram",
        aggregate_score: 7.6,
        verdict: "pass",
        created_at: "2026-10-14T12:00:00.000Z",
      },
      scores: [],
    };

    // The injected fetch enforces tenancy exactly as RLS + the explicit
    // company_id filter do in production: another company's row returns null.
    const fetch = async (
      id: string,
      companyId: string,
    ): Promise<ReviewWithScores | null> => {
      if (id !== reviewRow.review.id) return null;
      return reviewRow.review.company_id === companyId ? reviewRow : null;
    };

    const principalB: Principal = {
      userId: "b-user",
      companyId: COMPANY_B,
      role: "admin",
    };
    const rowA: TenantRowRef = { companyId: COMPANY_A };

    it("the Day-43 RLS model denies company B SELECT on company A's review", () => {
      expect(policyAllows("reviews", "select", principalB, rowA)).toBe(false);
      // ...and the same principal is allowed on its OWN company's rows.
      expect(
        policyAllows("reviews", "select", principalB, { companyId: COMPANY_B }),
      ).toBe(true);
    });

    it("the Day-6 read core returns 404 (no body) for the same cross-tenant read", async () => {
      const result = await getReviewForCompany(reviewRow.review.id, {
        session: session(COMPANY_B),
        fetch,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(404);
      expect("review" in result).toBe(false);
    });

    it("company A reads its own review through the same core", async () => {
      const result = await getReviewForCompany(reviewRow.review.id, {
        session: session(COMPANY_A),
        fetch,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.review.content_text).toBe("COMPANY-A-SECRET widget copy");
    });
  });

  // ── 4. the three rate limiters are ONE consistent mechanism ───────────────
  describe("review, export, and read limiters share identical semantics and store", () => {
    it("the export and read stores are literally the same shared factory", () => {
      // The Day-47 consolidation: both aliases point at the one generic
      // SlidingWindowStore factory, so there is exactly one implementation to
      // reason about — not three drifting copies (Rules.md §7).
      expect(createInMemoryReadRateStore).toBe(createInMemorySlidingWindowStore);
      expect(createInMemoryExportRateStore).toBe(createInMemorySlidingWindowStore);
    });

    it("all three resolve an unknown plan to the most restrictive (free) policy", () => {
      const bogus = "platinum" as unknown as PlanTier;
      expect(resolveRateLimitPolicy(bogus)).toEqual(resolveRateLimitPolicy("free"));
      expect(resolveReadRateLimitPolicy(bogus)).toEqual(resolveReadRateLimitPolicy("free"));
      expect(resolveExportRateLimitPolicy(bogus)).toEqual(resolveExportRateLimitPolicy("free"));
    });

    it("read + export block exactly at the limit and a blocked request consumes no slot", () => {
      const now = new Date("2026-10-14T00:00:00.000Z");

      for (const kind of ["read", "export"] as const) {
        const store = createInMemorySlidingWindowStore();
        const sess = session(COMPANY_A, { plan: "free" });
        const check = kind === "read" ? checkReadRateLimit : checkExportRateLimit;
        const limit =
          kind === "read"
            ? resolveReadRateLimitPolicy("free").limit
            : resolveExportRateLimitPolicy("free").limit;

        // Spend the whole budget.
        for (let n = 0; n < limit; n += 1) {
          expect(check({ session: sess, store, now }).ok).toBe(true);
        }
        // Several blocked attempts at the limit.
        for (let n = 0; n < 3; n += 1) {
          const blocked = check({ session: sess, store, now });
          expect(blocked.ok).toBe(false);
          if (!blocked.ok) expect(blocked.status).toBe(429);
        }

        // A blocked decision matches a direct evaluateRateLimit over the same
        // at-limit usage — the limiters route every decision through the one
        // shared evaluator, so they can't disagree.
        const policy =
          kind === "read"
            ? resolveReadRateLimitPolicy("free")
            : resolveExportRateLimitPolicy("free");
        const windowStartMs = now.getTime() - policy.windowMs;
        const usage = store.peek(COMPANY_A, windowStartMs);
        const direct = evaluateRateLimit(policy, usage, now);
        expect(direct.allowed).toBe(false);
        expect(direct.remaining).toBe(0);

        // The blocked attempts recorded nothing: after the window elapses a full
        // budget is available again (not one shrunk by the retries).
        const later = new Date(now.getTime() + policy.windowMs + 1);
        for (let n = 0; n < limit; n += 1) {
          expect(check({ session: sess, store, now: later }).ok).toBe(true);
        }
      }
    });

    it("the limiters isolate companies (one company exhausting its budget never affects another)", () => {
      const store = createInMemorySlidingWindowStore();
      const now = new Date("2026-10-14T00:00:00.000Z");
      const limit = resolveReadRateLimitPolicy("free").limit;

      const a = session(COMPANY_A, { plan: "free" });
      for (let n = 0; n < limit; n += 1) {
        expect(checkReadRateLimit({ session: a, store, now }).ok).toBe(true);
      }
      expect(checkReadRateLimit({ session: a, store, now }).ok).toBe(false);

      // Company B is untouched.
      const b = session(COMPANY_B, { plan: "free" });
      expect(checkReadRateLimit({ session: b, store, now }).ok).toBe(true);
    });
  });

  // ── 5. the content/secret boundary composes (input + logging) ─────────────
  describe("oversized inputs are rejected at the boundary AND redacted in logs", () => {
    it("rejects oversized review content and an oversized email at the input boundary", () => {
      // Content over the cap never reaches the model/DB.
      const okContent = ReviewRequestSchema.safeParse({
        content_text: "a".repeat(MAX_CONTENT_CHARS),
        content_type: "ad_copy",
        platform: "instagram",
      });
      expect(okContent.success).toBe(true);
      const tooLong = ReviewRequestSchema.safeParse({
        content_text: "a".repeat(MAX_CONTENT_CHARS + 1),
        content_type: "ad_copy",
        platform: "instagram",
      });
      expect(tooLong.success).toBe(false);

      // Email over the RFC ceiling never reaches Supabase Auth / the DB.
      const okEmail = credentialsSchema.safeParse({
        email: `${"a".repeat(MAX_EMAIL_CHARS - "@e.co".length)}@e.co`,
        password: "a-good-password",
      });
      expect(okEmail.success).toBe(true);
      const bigEmail = credentialsSchema.safeParse({
        email: `${"a".repeat(MAX_EMAIL_CHARS)}@e.co`,
        password: "a-good-password",
      });
      expect(bigEmail.success).toBe(false);
    });

    it("the log redactor drops exactly the content/secret fields those inputs carry, keeping the ids", () => {
      // A plausible failure-log context built from a review request + session: the
      // redactor drops the content/credentials, so even a log of a rejected
      // oversized request can't leak what the user submitted — while the ids that
      // make a failure traceable survive (Rules.md §3/§6).
      const redacted = redactLogContext({
        op: "createReview",
        companyId: COMPANY_A,
        reviewId: "11111111-1111-1111-1111-111111111111",
        jurorCount: 6,
        content_text: "COMPANY-A-SECRET widget copy",
        suggested_rewrite: "a rewritten line that is still user content",
        feedback_text: "the juror's prose",
        brand_summary: "the company's bounded brand voice",
        email: "user@acme.test",
      });

      expect(redacted.op).toBe("createReview");
      expect(redacted.companyId).toBe(COMPANY_A);
      expect(redacted.reviewId).toBe("11111111-1111-1111-1111-111111111111");
      expect(redacted.jurorCount).toBe(6);
      for (const key of [
        "content_text",
        "suggested_rewrite",
        "feedback_text",
        "brand_summary",
        "email",
      ]) {
        expect(redacted[key], `${key} leaked into the log`).toBe(REDACTED_VALUE);
      }
    });

    it("every content-bearing field the review input/output carries is on the redactor's denylist", () => {
      // Cross-audit property: the fields a review actually produces/accepts and
      // could land in a log are all keys the redactor drops by omission — so the
      // boundary and the log sink cover the SAME content surface.
      for (const key of ["content_text", "suggested_rewrite", "feedback_text"]) {
        expect(REDACTED_KEYS.has(key.toLowerCase()), `${key} not denylisted`).toBe(true);
      }
    });

    it("a secret-shaped value is caught by the ONE shared heuristic — in .env.example AND in a log line", () => {
      // The secrets audit and the log redactor must agree on what "looks like a
      // secret" or one could pass where the other blocks. They share
      // envValueLooksLikeSecret: prove it on the two real credential shapes.
      const jwt =
        "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJlLXZhbHVl";
      const providerKey = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCD";

      for (const secret of [jwt, providerKey]) {
        // (a) The secrets audit would reject it in a committed .env file.
        expect(envValueLooksLikeSecret(secret)).toBe(true);
        // (b) The log redactor masks it even under a non-denylisted key — so a
        // credential that slipped into an otherwise-safe field never reaches a log.
        const redacted = redactLogContext({ someValue: secret });
        expect(redacted.someValue).toBe(REDACTED_SECRET_VALUE);
      }

      // And a genuine placeholder trips neither surface.
      expect(envValueLooksLikeSecret("your-service-role-key")).toBe(false);
      expect(redactLogContext({ someValue: "your-service-role-key" }).someValue).toBe(
        "your-service-role-key",
      );
    });
  });
});
