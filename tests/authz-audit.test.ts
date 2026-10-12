import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  API_ENDPOINT_INVENTORY,
  API_METHODS,
  auditApiRoutes,
  auditRouteSource,
  findExportedHandlers,
  reconcileInventory,
  postureFor,
  type RouteSource,
} from "@/lib/auth/authz-audit";
import type { SessionContext } from "@/lib/auth/session";
import type { InsertReviewParams, ListReviewsOptions } from "@/lib/db/queries";
import {
  getReviewForCompany,
  listReviewsForCompany,
} from "@/lib/reviews/read-reviews";
import { createReview } from "@/lib/reviews/create-review";
import {
  checkExportRateLimit,
  createInMemoryExportRateStore,
} from "@/lib/reviews/export-access";
import { ReviewRequestSchema } from "@/lib/schema/juror";
import type { ReviewWithScores } from "@/types/db";

/**
 * Authorization audit (DailyPlan Day 44 — Week 7 security pass).
 *
 * "Server-side authorization review across all `/api` routes. DoD: no route
 * trusts client-supplied identity."
 *
 * Part 1 reads the REAL route source files and enforces, per handler module:
 * identity is resolved server-side (`getSessionContext()`), that resolution
 * fails closed, and no identity field is read from any client-controlled source
 * (body / URL query / path params). It also reconciles the on-disk routes with
 * `API_ENDPOINT_INVENTORY` so a new route can't escape the audit.
 *
 * Part 2 drives the REAL endpoint cores to prove the runtime consequence: an
 * unauthenticated caller is denied (fail closed), and the company reaching the
 * data layer is always the session's — never a value the client supplied.
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
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (entry.name === "route.ts") {
        out.push({ path: rel, src: readFileSync(abs, "utf8") });
      }
    }
  }
  walk(apiDir, "api");
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const routes = loadApiRoutes();
const audits = auditApiRoutes(routes);
const auditFor = (path: string) => audits.find((a) => a.path === path)!;

// ── Part 1: static audit of the real route source ───────────────────────────

describe("authz audit — /api route source", () => {
  it("discovers the real route modules (scanner is not silently empty)", () => {
    expect(routes.length).toBeGreaterThanOrEqual(4);
    // Each discovered module exports at least one HTTP handler.
    for (const a of audits) {
      expect(a.methods.length, `${a.path} exports a handler`).toBeGreaterThan(0);
    }
  });

  it("matches the declared endpoint inventory exactly (no unaudited or stale routes)", () => {
    const { missingFromInventory, missingFromDisk, methodMismatches } =
      reconcileInventory(audits);
    expect(missingFromInventory, "routes on disk but not in the inventory").toEqual([]);
    expect(missingFromDisk, "inventory entries with no route on disk").toEqual([]);
    expect(methodMismatches, "inventory methods vs. on-disk handlers").toEqual([]);
  });

  it("resolves identity server-side on every route", () => {
    for (const a of audits) {
      expect(
        a.resolvesSessionServerSide,
        `${a.path} calls getSessionContext()`,
      ).toBe(true);
    }
  });

  it("fails closed on session resolution for every session-required route", () => {
    for (const a of audits) {
      const posture = postureFor(a.path);
      expect(posture, `${a.path} is in the inventory`).toBeDefined();
      if (posture?.requiresSession) {
        expect(
          a.sessionFailsClosed,
          `${a.path} maps a session-resolution failure to no session`,
        ).toBe(true);
      }
    }
  });

  it("reads NO client-supplied identity field on any route", () => {
    for (const a of audits) {
      expect(
        a.clientIdentityReads,
        `${a.path} reads identity from client input: ${a.clientIdentityReads.join(", ")}`,
      ).toEqual([]);
    }
  });

  it("every current endpoint requires an authenticated session", () => {
    // Today all four /api endpoints serve a tenant's own data; none is public.
    for (const entry of API_ENDPOINT_INVENTORY) {
      expect(entry.requiresSession, `${entry.path} requiresSession`).toBe(true);
    }
  });
});

// ── Scanner sensitivity: it genuinely rejects a bad route ────────────────────

describe("authz audit — scanner sensitivity", () => {
  it("flags a route that trusts client-supplied identity and does not fail closed", () => {
    // A deliberately insecure handler: takes company_id from the URL and the
    // body, the role from path params, and never fails closed. The scanner must
    // catch every vector — otherwise the clean result above proves nothing.
    const badSrc = `
      import { getSessionContext } from "@/lib/auth/session";
      export async function GET(request, { params }) {
        const { role } = await params;
        const companyId = new URL(request.url).searchParams.get("company_id");
        const session = await getSessionContext();
        const who = session?.companyId;
        return handle(companyId, role, who);
      }
      export async function POST(request) {
        const body = await request.json();
        return persist({ companyId: body.company_id, submittedBy: body["submitted_by"] });
      }
    `;
    const bad = auditRouteSource("api/bad/route.ts", badSrc);

    expect(bad.methods).toEqual(["GET", "POST"]);
    expect(bad.resolvesSessionServerSide).toBe(true);
    // No `.catch(() => null)` on the resolution → not fail-closed.
    expect(bad.sessionFailsClosed).toBe(false);
    // Every client-identity vector is caught.
    expect(bad.clientIdentityReads).toEqual(
      expect.arrayContaining([
        "URL query parameter",
        "destructured path param",
        "request body property",
        "request body index",
      ]),
    );
  });

  it("does not flag server-derived identity (session.companyId) as a client read", () => {
    const goodSrc = `
      import { getSessionContext } from "@/lib/auth/session";
      export async function GET() {
        const session = await getSessionContext().catch(() => null);
        const companyId = session?.companyId;
        const submittedBy = session?.authUserId;
        return list(companyId, submittedBy);
      }
    `;
    const good = auditRouteSource("api/good/route.ts", goodSrc);
    expect(good.resolvesSessionServerSide).toBe(true);
    expect(good.sessionFailsClosed).toBe(true);
    expect(good.clientIdentityReads).toEqual([]);
  });

  it("allows a path `id` (resource selector) — only identity fields are forbidden", () => {
    const src = `
      export async function GET(_r, { params }) {
        const { id } = await params;
        return getReviewForCompany(id, deps);
      }
    `;
    expect(auditRouteSource("api/reviews/[id]/route.ts", src).clientIdentityReads).toEqual([]);
  });

  it("findExportedHandlers ignores non-handler exports", () => {
    const src = `
      export const runtime = "nodejs";
      export const dynamic = "force-dynamic";
      export async function GET() {}
      function POST() {} // not exported
    `;
    expect(findExportedHandlers(src)).toEqual(["GET"]);
  });

  it("API_METHODS covers the canonical order used for comparison", () => {
    expect(API_METHODS).toEqual(["GET", "POST", "PUT", "PATCH", "DELETE"]);
  });
});

// ── Part 2: behavioral proof over the real endpoint cores ────────────────────

const COMPANY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function sessionFor(companyId: string, authUserId: string): SessionContext {
  return {
    authUserId,
    email: "user@acme.test",
    companyId,
    role: "member",
    company: {
      id: companyId,
      name: "Acme",
      industry: null,
      plan_tier: "free",
      juror_weights: null,
      onboarded_at: "2026-08-31T00:00:00.000Z",
      created_at: "2026-08-31T00:00:00.000Z",
    },
  };
}

const SESSION_A = sessionFor(COMPANY_A, "11111111-1111-1111-1111-111111111111");
const SESSION_B = sessionFor(COMPANY_B, "22222222-2222-2222-2222-222222222222");

function recordingPersist() {
  const calls: InsertReviewParams[] = [];
  const persist = async (params: InsertReviewParams): Promise<ReviewWithScores> => {
    calls.push(params);
    return {
      review: {
        id: params.review.review_id,
        company_id: params.companyId,
        submitted_by: params.submittedBy,
        content_text: params.content_text,
        content_type: params.review.content_type as never,
        platform: params.review.platform,
        aggregate_score: params.review.aggregate_score,
        verdict: params.review.verdict,
        created_at: "2026-09-01T00:00:00.000Z",
      },
      scores: [],
    };
  };
  return { calls, persist };
}

describe("authz audit — unauthenticated callers fail closed", () => {
  it("POST /api/reviews core denies with 401 and never persists", async () => {
    const { calls, persist } = recordingPersist();
    const result = await createReview(
      { content_text: "Hello there, buy now.", content_type: "ad_copy", platform: null },
      { session: null, persist },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected denial");
    expect(result.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("GET /api/reviews/[id] core denies with 401 and never reads", async () => {
    const fetch = vi.fn();
    const result = await getReviewForCompany("00000000-0000-0000-0000-000000000001", {
      session: null,
      fetch,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected denial");
    expect(result.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("GET /api/reviews (list) core denies with 401 and never reads", async () => {
    const list = vi.fn();
    const result = await listReviewsForCompany({ session: null, list });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected denial");
    expect(result.status).toBe(401);
    expect(list).not.toHaveBeenCalled();
  });
});

describe("authz audit — identity comes from the session, never the client", () => {
  // The successful review path logs a redacted usage line (Day 18); silence it.
  it("POST /api/reviews ignores body-supplied company_id / submitted_by / role", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const { calls, persist } = recordingPersist();
      // A hostile body: valid content fields PLUS forged identity fields.
      const result = await createReview(
        {
          content_text: "Introducing our new sleep supplement.",
          content_type: "ad_copy",
          platform: "instagram",
          company_id: COMPANY_B, // forged — must be ignored
          submitted_by: "99999999-9999-9999-9999-999999999999", // forged
          role: "admin", // forged
        },
        { session: SESSION_A, persist },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(calls).toHaveLength(1);
      // Persisted identity is the SESSION's, not the forged body values.
      expect(calls[0].companyId).toBe(COMPANY_A);
      expect(calls[0].submittedBy).toBe(SESSION_A.authUserId);
    } finally {
      infoSpy.mockRestore();
    }
  });

  it("ReviewRequestSchema strips identity fields from the client body", () => {
    const parsed = ReviewRequestSchema.parse({
      content_text: "Buy our thing today.",
      content_type: "ad_copy",
      platform: "instagram",
      company_id: COMPANY_B,
      submitted_by: "forged",
      role: "admin",
    });
    // Only the client-supplied content/format fields survive; no identity field
    // is accepted (media_type/image are the ad-format inputs, added Day 15a).
    expect(Object.keys(parsed).sort()).toEqual([
      "content_text",
      "content_type",
      "image",
      "media_type",
      "platform",
    ]);
    expect("company_id" in parsed).toBe(false);
    expect("submitted_by" in parsed).toBe(false);
    expect("role" in parsed).toBe(false);
  });

  it("GET /api/reviews/[id] scopes the read to the session's company", async () => {
    const seen: { reviewId: string; companyId: string }[] = [];
    const fetch = async (reviewId: string, companyId: string) => {
      seen.push({ reviewId, companyId });
      return null; // 404 downstream — we only assert the companyId passed.
    };
    const REVIEW = "00000000-0000-0000-0000-000000000001";

    await getReviewForCompany(REVIEW, { session: SESSION_A, fetch });
    await getReviewForCompany(REVIEW, { session: SESSION_B, fetch });

    // The resource id (REVIEW) is the client's to choose; the company is always
    // the session's — company A's session can only ever query company A's data.
    expect(seen).toEqual([
      { reviewId: REVIEW, companyId: COMPANY_A },
      { reviewId: REVIEW, companyId: COMPANY_B },
    ]);
  });

  it("GET /api/reviews (list) scopes the read to the session's company", async () => {
    const seen: string[] = [];
    const list = async (companyId: string, _opts: ListReviewsOptions) => {
      seen.push(companyId);
      return [];
    };
    await listReviewsForCompany({ session: SESSION_A, list });
    await listReviewsForCompany({ session: SESSION_B, list });
    expect(seen).toEqual([COMPANY_A, COMPANY_B]);
  });

  it("export rate limiting is keyed to the session's company", () => {
    // The export routes gate the limiter on a non-null session and key it on the
    // session's company — never a client value. Two companies get independent
    // budgets from the same store.
    const store = createInMemoryExportRateStore();
    const recorded: string[] = [];
    const spyStore = {
      peek: store.peek.bind(store),
      record: (companyId: string, nowMs: number) => {
        recorded.push(companyId);
        store.record(companyId, nowMs);
      },
    };
    const a = checkExportRateLimit({ session: SESSION_A, store: spyStore });
    const b = checkExportRateLimit({ session: SESSION_B, store: spyStore });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(recorded).toEqual([COMPANY_A, COMPANY_B]);
  });
});
