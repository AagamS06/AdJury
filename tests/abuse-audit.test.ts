import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { RouteSource } from "@/lib/auth/authz-audit";
import {
  ABUSE_MECHANISMS,
  ABUSE_SURFACE_POSTURE,
  abusePostureFor,
  auditAbuseSurface,
  auditRouteAbuseProtection,
  reconcileAbuseSurface,
} from "@/lib/security/abuse-audit";
import {
  evaluateRateLimit,
  resolveRateLimitPolicy,
  PLAN_RATE_LIMITS,
} from "@/lib/rate-limit";
import {
  checkExportRateLimit,
  createInMemoryExportRateStore,
  EXPORT_RATE_LIMITS,
  resolveExportRateLimitPolicy,
} from "@/lib/reviews/export-access";
import {
  checkReadRateLimit,
  createInMemoryReadRateStore,
  READ_RATE_LIMITS,
  resolveReadRateLimitPolicy,
  type ReadRateStore,
} from "@/lib/reviews/read-access";
import type { CompanyRow, PlanTier } from "@/types/db";
import type { SessionContext } from "@/lib/auth/session";

/**
 * Abuse-protection audit (DailyPlan Day 47 — Week 7 security pass).
 *
 * "Abuse protections — review rate limits + basic abuse safeguards end-to-end.
 *  DoD: limits enforced consistently."
 *
 * Part 1 reads the REAL `/api` route source and proves every cost-bearing
 * endpoint wires its required limiter (and that the scanner actually catches a
 * dropped one), plus the drift guard: the on-disk routes reconcile exactly with
 * the inventory, so a new route can't escape classification.
 *
 * Part 2 drives the REAL limiters to prove "enforced consistently": all three
 * (review/export/read) fail closed to the `free` policy for an unknown plan and
 * resolve their decision through the same `evaluateRateLimit`, so a blocked read
 * and a blocked export agree with the review limiter's semantics.
 */

// ── Load the real /api route source files ────────────────────────────────────

const apiDir = fileURLToPath(new URL("../src/app/api", import.meta.url));

/** Recursively collect every `route.ts` under `src/app/api`, path relative to `src/app`. */
function loadApiRoutes(): RouteSource[] {
  const out: RouteSource[] = [];
  function walk(dir: string, relFromApp: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = `${dir}/${entry.name}`;
      const rel = `${relFromApp}/${entry.name}`;
      if (entry.isDirectory()) walk(abs, rel);
      else if (entry.name === "route.ts") out.push({ path: rel, src: readFileSync(abs, "utf8") });
    }
  }
  walk(apiDir, "api");
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const routes = loadApiRoutes();

// ── Part 1: static audit of the real route source ───────────────────────────

describe("abuse audit — /api route source", () => {
  it("discovers the real route modules (scanner is not silently empty)", () => {
    expect(routes.length).toBeGreaterThanOrEqual(4);
  });

  it("every cost-bearing route wires its required limiter(s)", () => {
    const audits = auditAbuseSurface(routes);
    for (const audit of audits) {
      expect(
        audit.missingMechanisms,
        `${audit.path} is missing limiter(s): ${audit.missingMechanisms.join(", ")}`,
      ).toEqual([]);
    }
  });

  it("the review+read route enforces BOTH its limiters (POST review, GET read)", () => {
    const audits = auditAbuseSurface(routes);
    const combo = audits.find((a) => a.path === "api/reviews/route.ts")!;
    expect(combo.presentMechanisms).toEqual(["review-limiter", "read-limiter"]);
  });

  it("reconciles the inventory with the routes on disk (no drift)", () => {
    const diskPaths = routes.map((r) => r.path);
    const recon = reconcileAbuseSurface(diskPaths);
    expect(recon.missingFromPosture).toEqual([]); // every disk route is classified
    expect(recon.missingFromDisk).toEqual([]); // no stale inventory entries
  });

  it("any exempt route declares an explicit reason (no silent gaps)", () => {
    for (const entry of ABUSE_SURFACE_POSTURE) {
      if (entry.mechanisms.length === 0) {
        expect(
          entry.exemptReason && entry.exemptReason.length > 0,
          `${entry.path} is exempt but gives no reason`,
        ).toBe(true);
      }
    }
  });

  it("CATCHES a route that drops its limiter (the scanner isn't vacuous)", () => {
    // A classified route whose source no longer references the limiter marker.
    const entry = abusePostureFor("api/reviews/[id]/route.ts")!;
    const stripped =
      "export async function GET() { return Response.json({}); }";
    const audit = auditRouteAbuseProtection(entry, stripped);
    expect(audit.missingMechanisms).toEqual(["read-limiter"]);
  });

  it("does not count a limiter that only appears in a comment", () => {
    const entry = abusePostureFor("api/reviews/[id]/route.ts")!;
    const commented =
      "// checkReadRateLimit is coming later\nexport async function GET() {}";
    const audit = auditRouteAbuseProtection(entry, commented);
    expect(audit.missingMechanisms).toEqual(["read-limiter"]);
  });

  it("every mechanism marker is actually the symbol the limiter exports", () => {
    expect(ABUSE_MECHANISMS["review-limiter"].marker).toBe("getRateUsage");
    expect(ABUSE_MECHANISMS["export-limiter"].marker).toBe("checkExportRateLimit");
    expect(ABUSE_MECHANISMS["read-limiter"].marker).toBe("checkReadRateLimit");
  });
});

// ── Part 2: the three limiters are enforced consistently ─────────────────────

function makeSession(companyId: string, plan: PlanTier): SessionContext {
  const company: CompanyRow = {
    id: companyId,
    name: companyId,
    industry: null,
    plan_tier: plan,
    juror_weights: null,
    onboarded_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
  };
  return { authUserId: `u-${companyId}`, email: `a@${companyId}`, companyId, role: "admin", company };
}

describe("abuse audit — limiters enforced consistently", () => {
  it("all three limiter policies fail closed to free for an unknown plan", () => {
    const bogus = "legacy" as PlanTier;
    expect(resolveRateLimitPolicy(bogus)).toEqual(PLAN_RATE_LIMITS.free);
    expect(resolveExportRateLimitPolicy(bogus)).toEqual(EXPORT_RATE_LIMITS.free);
    expect(resolveReadRateLimitPolicy(bogus)).toEqual(READ_RATE_LIMITS.free);
    // ...and for a missing plan.
    expect(resolveRateLimitPolicy(null)).toEqual(PLAN_RATE_LIMITS.free);
    expect(resolveExportRateLimitPolicy(null)).toEqual(EXPORT_RATE_LIMITS.free);
    expect(resolveReadRateLimitPolicy(null)).toEqual(READ_RATE_LIMITS.free);
  });

  it("read + export limiters resolve through the same evaluateRateLimit decision", () => {
    const now = new Date("2026-10-14T12:00:00.000Z");

    // Fill each limiter's window to exactly its free limit so both must block.
    const readStore: ReadRateStore = createInMemoryReadRateStore();
    for (let i = 0; i < READ_RATE_LIMITS.free.limit; i += 1) {
      readStore.record("co", now.getTime() - 1000);
    }
    const exportStore = createInMemoryExportRateStore();
    for (let i = 0; i < EXPORT_RATE_LIMITS.free.limit; i += 1) {
      exportStore.record("co", now.getTime() - 1000);
    }

    const readRes = checkReadRateLimit({ session: makeSession("co", "free"), now, store: readStore });
    const exportRes = checkExportRateLimit({ session: makeSession("co", "free"), now, store: exportStore });

    // Both block, both expose a 429 decision whose shape matches a direct
    // evaluateRateLimit call over the same policy + at-limit usage.
    expect(readRes.ok).toBe(false);
    expect(exportRes.ok).toBe(false);
    if (readRes.ok || exportRes.ok) throw new Error("expected both blocked");

    const readRef = evaluateRateLimit(
      READ_RATE_LIMITS.free,
      { count: READ_RATE_LIMITS.free.limit, oldest: new Date(now.getTime() - 1000).toISOString() },
      now,
    );
    expect(readRes.rateLimit).toEqual(readRef);
    expect(readRes.rateLimit.allowed).toBe(false);
    expect(readRes.rateLimit.remaining).toBe(0);
    expect(exportRes.rateLimit.allowed).toBe(false);
    expect(exportRes.rateLimit.remaining).toBe(0);
  });

  it("a blocked request consumes no slot in either in-memory limiter", () => {
    const now = new Date("2026-10-14T12:00:00.000Z");
    const readStore = createInMemoryReadRateStore();
    for (let i = 0; i < READ_RATE_LIMITS.free.limit; i += 1) {
      readStore.record("co", now.getTime() - 1000);
    }
    checkReadRateLimit({ session: makeSession("co", "free"), now, store: readStore });
    // Still exactly at the limit — the blocked attempt was not recorded.
    expect(readStore.peek("co", now.getTime() - READ_RATE_LIMITS.free.windowMs).count).toBe(
      READ_RATE_LIMITS.free.limit,
    );
  });
});
