import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  TENANT_TABLES,
  TENANT_OPS,
  POLICY_POSTURE,
  policyAllows,
  parseSchemaSql,
  auditSchema,
  auditAuthCompanyIdFn,
  type Principal,
  type TenantTable,
  type TenantOp,
} from "@/lib/db/rls-audit";

/**
 * RLS audit (DailyPlan Day 43 — Week 7 security pass).
 *
 * "Verify every tenant-table policy; add cross-tenant-isolation tests. DoD: no
 * cross-company access; tests prove it."
 *
 * Part 1 reads the REAL committed migration SQL and enforces the structural
 * invariants (RLS on, every policy company-scoped, no wildcard policy, posture
 * matches the inventory, the auth_company_id() helper hardened — the Day 43
 * finding). Part 2 proves, over the policy model, that no principal from one
 * company can touch another company's row on any tenant table or operation.
 */

// ── Load the real migrations, in order ──────────────────────────────────────

const migrationsDir = fileURLToPath(
  new URL("../supabase/migrations", import.meta.url),
);

function loadAllMigrations(): string {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // 0001_, 0002_, … lexical == migration order
  return files.map((f) => readFileSync(`${migrationsDir}/${f}`, "utf8")).join("\n");
}

const parsed = parseSchemaSql(loadAllMigrations());
const tableAudits = auditSchema(parsed);
const auditFor = (t: TenantTable) => tableAudits.find((a) => a.table === t)!;

// ── Part 1: static audit of the committed SQL ───────────────────────────────

describe("RLS audit — committed migration SQL", () => {
  it("parses the expected tenant tables, policies, and the helper function", () => {
    // Sanity that the scanner actually found the schema (not silently empty).
    expect(parsed.policies.length).toBeGreaterThanOrEqual(8);
    expect(parsed.functions.some((f) => f.name === "auth_company_id")).toBe(true);
  });

  it("enables Row-Level Security on every tenant table", () => {
    for (const table of TENANT_TABLES) {
      expect(auditFor(table).rlsEnabled, `${table} RLS enabled`).toBe(true);
    }
  });

  it("scopes every tenant-table policy to the caller's company", () => {
    for (const table of TENANT_TABLES) {
      expect(
        auditFor(table).allPoliciesCompanyScoped,
        `${table}: every policy constrains rows via auth_company_id()`,
      ).toBe(true);
    }
  });

  it("has no wildcard (`using (true)`) policy on any tenant table", () => {
    for (const table of TENANT_TABLES) {
      expect(
        auditFor(table).hasWildcardPolicy,
        `${table}: no cross-tenant-exposing wildcard policy`,
      ).toBe(false);
    }
  });

  it("matches the intended policy posture exactly (no missing or extra policies)", () => {
    for (const table of TENANT_TABLES) {
      expect(auditFor(table).postureMatches, `${table}: posture matches inventory`).toBe(
        true,
      );
    }
  });

  it("admin-gates the policies the inventory marks admin-only", () => {
    // brand_profiles write + invitations read require role = 'admin'.
    for (const table of TENANT_TABLES) {
      const hasAdminOnly = POLICY_POSTURE[table].some((e) => e.adminOnly);
      if (!hasAdminOnly) continue;
      expect(auditFor(table).adminGatesPresent, `${table}: admin gate present`).toBe(true);
    }
  });

  it("keeps server-side-only tables fail-closed (no client write policy)", () => {
    // companies/users/persona_scores/invitations expose SELECT only; reviews
    // adds INSERT but no UPDATE/DELETE. No tenant table grants client DELETE.
    const noClientWrite: TenantTable[] = [
      "companies",
      "users",
      "persona_scores",
      "invitations",
    ];
    for (const table of noClientWrite) {
      expect(auditFor(table).commands, `${table}: select-only`).toEqual(["select"]);
    }
    expect(auditFor("reviews").commands.sort()).toEqual(["insert", "select"]);
    expect(auditFor("reviews").commands).not.toContain("update");
    expect(auditFor("reviews").commands).not.toContain("delete");
  });

  it("hardens auth_company_id() as SECURITY DEFINER with a pinned search_path (Day 43 fix)", () => {
    const fn = auditAuthCompanyIdFn(parsed);
    expect(fn.defined).toBe(true);
    // SECURITY DEFINER breaks the users_select → auth_company_id() → users
    // recursion by reading `users` with RLS bypassed.
    expect(fn.securityDefiner, "auth_company_id() is SECURITY DEFINER").toBe(true);
    // A SECURITY DEFINER function MUST pin search_path or it is a priv-esc hole.
    expect(fn.pinnedSearchPath, "auth_company_id() pins search_path").toBe(true);
  });
});

// ── Part 2: cross-tenant isolation over the policy model ─────────────────────

const ACME: Principal = { userId: "u-acme", companyId: "co-acme", role: "member" };
const ACME_ADMIN: Principal = { userId: "u-acme-admin", companyId: "co-acme", role: "admin" };
const RIVAL: Principal = { userId: "u-rival", companyId: "co-rival", role: "admin" };

const OWN_ROW = { companyId: "co-acme" };
const OTHER_ROW = { companyId: "co-rival" };

describe("RLS audit — cross-tenant isolation (no cross-company access)", () => {
  it("denies a principal EVERY operation on another company's row, on every tenant table", () => {
    for (const table of TENANT_TABLES) {
      for (const op of TENANT_OPS) {
        // Try the strongest principal available (admin) against a rival row —
        // if even an admin is denied cross-tenant, a member certainly is.
        expect(
          policyAllows(table, op, ACME_ADMIN, OTHER_ROW),
          `${table}.${op}: company A admin on company B row → denied`,
        ).toBe(false);
        expect(
          policyAllows(table, op, ACME, OTHER_ROW),
          `${table}.${op}: company A member on company B row → denied`,
        ).toBe(false);
      }
    }
  });

  it("is symmetric: the rival admin cannot touch ACME's rows either", () => {
    for (const table of TENANT_TABLES) {
      for (const op of TENANT_OPS) {
        expect(policyAllows(table, op, RIVAL, OWN_ROW)).toBe(false);
      }
    }
  });

  it("never grants cross-company DELETE anywhere", () => {
    for (const table of TENANT_TABLES) {
      expect(
        policyAllows(table, "delete", ACME_ADMIN, OTHER_ROW),
        `${table}.delete cross-tenant → denied`,
      ).toBe(false);
    }
  });

  it("allows same-company DELETE only on brand_profiles, and only for an admin (its FOR ALL policy)", () => {
    // brand_profiles_write is FOR ALL, so a same-company admin may delete their
    // own brand guide; no other tenant table grants client DELETE at all.
    for (const table of TENANT_TABLES) {
      const allowed = policyAllows(table, "delete", ACME_ADMIN, OWN_ROW);
      expect(allowed, `${table}.delete same-company admin`).toBe(table === "brand_profiles");
    }
    // Even on brand_profiles a non-admin member cannot delete.
    expect(policyAllows("brand_profiles", "delete", ACME, OWN_ROW)).toBe(false);
  });
});

describe("RLS audit — intended same-company access is allowed", () => {
  it("lets any member read their own company's rows where a SELECT policy exists", () => {
    // Every tenant table has a company-scoped SELECT (invitations is admin-only).
    expect(policyAllows("companies", "select", ACME, OWN_ROW)).toBe(true);
    expect(policyAllows("users", "select", ACME, OWN_ROW)).toBe(true);
    expect(policyAllows("brand_profiles", "select", ACME, OWN_ROW)).toBe(true);
    expect(policyAllows("reviews", "select", ACME, OWN_ROW)).toBe(true);
    expect(policyAllows("persona_scores", "select", ACME, OWN_ROW)).toBe(true);
  });

  it("lets a member insert a review for their own company but not update/delete it", () => {
    expect(policyAllows("reviews", "insert", ACME, OWN_ROW)).toBe(true);
    expect(policyAllows("reviews", "update", ACME, OWN_ROW)).toBe(false);
    expect(policyAllows("reviews", "delete", ACME, OWN_ROW)).toBe(false);
  });

  it("gates brand-profile writes to admins of the owning company", () => {
    // Member reads but cannot write; admin of the same company writes.
    expect(policyAllows("brand_profiles", "select", ACME, OWN_ROW)).toBe(true);
    expect(policyAllows("brand_profiles", "insert", ACME, OWN_ROW)).toBe(false);
    expect(policyAllows("brand_profiles", "update", ACME, OWN_ROW)).toBe(false);
    expect(policyAllows("brand_profiles", "insert", ACME_ADMIN, OWN_ROW)).toBe(true);
    expect(policyAllows("brand_profiles", "update", ACME_ADMIN, OWN_ROW)).toBe(true);
    // …but never for another company, even as an admin.
    expect(policyAllows("brand_profiles", "update", ACME_ADMIN, OTHER_ROW)).toBe(false);
  });

  it("gates invitation reads to admins of the owning company", () => {
    expect(policyAllows("invitations", "select", ACME, OWN_ROW)).toBe(false); // member
    expect(policyAllows("invitations", "select", ACME_ADMIN, OWN_ROW)).toBe(true); // admin
    expect(policyAllows("invitations", "select", ACME_ADMIN, OTHER_ROW)).toBe(false);
  });

  it("denies client writes to server-side-only tables even within the company", () => {
    const serverOnly: Array<[TenantTable, TenantOp]> = [
      ["companies", "insert"],
      ["companies", "update"],
      ["companies", "delete"],
      ["users", "insert"],
      ["users", "update"],
      ["persona_scores", "insert"],
      ["invitations", "insert"],
      ["invitations", "update"],
    ];
    for (const [table, op] of serverOnly) {
      expect(policyAllows(table, op, ACME_ADMIN, OWN_ROW), `${table}.${op} denied`).toBe(
        false,
      );
    }
  });
});
