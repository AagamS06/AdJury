/**
 * RLS audit (DailyPlan Day 43 — Week 7 security pass).
 *
 * Two pure, node-testable surfaces so "verify every tenant-table policy; no
 * cross-company access" is provable offline, with no live Postgres:
 *
 *  1. A faithful MODEL of the committed RLS policies (`policyAllows`) that lets
 *     the cross-tenant-isolation tests prove, for every tenant table and every
 *     client operation, that a principal from company A is denied on a company B
 *     row — and that the intended same-company / admin-gated access is allowed.
 *
 *  2. A STATIC SCANNER (`parseSchemaSql` + `auditSchema` + `auditAuthCompanyIdFn`)
 *     that reads the real migration SQL and enforces the structural invariants
 *     the model assumes: RLS enabled on every tenant table, every policy
 *     company-scoped (via `auth_company_id()`), no wildcard (`true`) policy, the
 *     policy posture matches the inventory, and the `auth_company_id()` helper is
 *     hardened (SECURITY DEFINER + a pinned search_path — the Day 43 finding).
 *
 * The scanner catches drift in the actual SQL; the model documents and proves
 * the isolation property. Together they are the audit's regression guard.
 *
 * Scope: this governs the RLS surface — the authenticated/anon client. The
 * service-role client bypasses RLS by design (Rules.md §4/§5) and is not modeled
 * here; app-layer tenancy on that path is proven by the Day 5/6/7 core + tenancy
 * tests.
 */
import type { UserRole } from "@/types/db";

// ── Tenant-table inventory ────────────────────────────────────────────────

export type TenantTable =
  | "companies"
  | "users"
  | "brand_profiles"
  | "reviews"
  | "persona_scores"
  | "invitations";

export const TENANT_TABLES: readonly TenantTable[] = [
  "companies",
  "users",
  "brand_profiles",
  "reviews",
  "persona_scores",
  "invitations",
];

/** RLS-governed client operations (service-role writes bypass RLS entirely). */
export type TenantOp = "select" | "insert" | "update" | "delete";

export const TENANT_OPS: readonly TenantOp[] = ["select", "insert", "update", "delete"];

/**
 * The intended policy posture per tenant table — the single source of truth the
 * static audit checks the committed SQL against. `command: "all"` is Postgres's
 * FOR ALL (covers every op); `adminOnly` means the policy additionally requires
 * `role = 'admin'`. A table with no entry for an op has no permissive policy for
 * it, so that op is denied to the client (fail-closed; written via service role).
 */
export interface PostureEntry {
  command: "select" | "insert" | "update" | "delete" | "all";
  adminOnly: boolean;
}

export const POLICY_POSTURE: Record<TenantTable, readonly PostureEntry[]> = {
  // Read your own company; all writes are server-side (service role).
  companies: [{ command: "select", adminOnly: false }],
  // Read members of your own company; writes server-side.
  users: [{ command: "select", adminOnly: false }],
  // Members read the brand guide; only admins write it (FOR ALL).
  brand_profiles: [
    { command: "select", adminOnly: false },
    { command: "all", adminOnly: true },
  ],
  // Read + insert within your company; no client UPDATE/DELETE (fail-closed).
  reviews: [
    { command: "select", adminOnly: false },
    { command: "insert", adminOnly: false },
  ],
  // Visible when the parent review is visible; writes server-side.
  persona_scores: [{ command: "select", adminOnly: false }],
  // Only an admin reads their company's invites; accept/create server-side.
  invitations: [{ command: "select", adminOnly: true }],
};

// ── Policy model (for cross-tenant-isolation proofs) ────────────────────────

export interface Principal {
  userId: string;
  companyId: string;
  role: UserRole;
}

/** A tenant row reduced to what the policies key on: its owning company. */
export interface TenantRowRef {
  /** For persona_scores this is the parent review's company_id. */
  companyId: string;
}

/**
 * Faithful model of the committed RLS policies: may `principal` perform `op` on
 * `row` of `table` as the authenticated client? Mirrors 0001/0004/0006 exactly.
 */
export function policyAllows(
  table: TenantTable,
  op: TenantOp,
  principal: Principal,
  row: TenantRowRef,
): boolean {
  const sameCompany = principal.companyId === row.companyId;
  const isAdmin = principal.role === "admin";

  switch (table) {
    case "companies":
      // companies_select only; no client write policy.
      return op === "select" && sameCompany;
    case "users":
      // users_select only; no client write policy.
      return op === "select" && sameCompany;
    case "brand_profiles":
      // Members read (brand_profiles_select); admins write (brand_profiles_write, FOR ALL).
      if (op === "select") return sameCompany;
      return sameCompany && isAdmin;
    case "reviews":
      // reviews_select + reviews_insert; no UPDATE/DELETE policy.
      if (op === "select" || op === "insert") return sameCompany;
      return false;
    case "persona_scores":
      // persona_scores_select via the parent review's company; no client write.
      return op === "select" && sameCompany;
    case "invitations":
      // invitations_select (admin-gated) only; no client write.
      return op === "select" && sameCompany && isAdmin;
    default: {
      const _exhaustive: never = table;
      return _exhaustive;
    }
  }
}

// ── Static SQL scanner ──────────────────────────────────────────────────────

export interface ParsedPolicy {
  name: string;
  table: string;
  command: "select" | "insert" | "update" | "delete" | "all";
  /** The policy body after `FOR <command>` (the USING / WITH CHECK clauses). */
  body: string;
}

export interface ParsedFunction {
  name: string;
  /** The full `create [or replace] function …` statement text. */
  definition: string;
}

export interface ParsedSchema {
  rlsEnabled: Set<string>;
  policies: ParsedPolicy[];
  functions: ParsedFunction[];
}

/** Strip `--` line comments. Our migrations never place `--` inside a literal. */
function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

/**
 * Split into top-level statements on `;`, treating `$$ … $$` dollar-quoted
 * blocks (the only kind used here, for function bodies) as opaque so a `;` or
 * `--` inside one never splits a statement.
 */
function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inDollar = false;
  let i = 0;
  while (i < sql.length) {
    if (sql.startsWith("$$", i)) {
      inDollar = !inDollar;
      buf += "$$";
      i += 2;
      continue;
    }
    const ch = sql[i];
    if (ch === ";" && !inDollar) {
      const s = buf.trim();
      if (s) out.push(s);
      buf = "";
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

const RLS_ENABLE_RE = /^alter\s+table\s+(\w+)\s+enable\s+row\s+level\s+security$/i;
const POLICY_RE =
  /^create\s+policy\s+(\w+)\s+on\s+(\w+)\s+for\s+(all|select|insert|update|delete)\b([\s\S]*)$/i;
const FUNCTION_RE = /^create\s+(?:or\s+replace\s+)?function\s+(\w+)\s*\(/i;

/** Parse the RLS-relevant statements out of one or more concatenated migrations. */
export function parseSchemaSql(sql: string): ParsedSchema {
  const rlsEnabled = new Set<string>();
  const policies: ParsedPolicy[] = [];
  const functions: ParsedFunction[] = [];

  for (const stmt of splitStatements(stripSqlComments(sql))) {
    const normalized = stmt.replace(/\s+/g, " ").trim();

    const rls = normalized.match(RLS_ENABLE_RE);
    if (rls) {
      rlsEnabled.add(rls[1].toLowerCase());
      continue;
    }

    const pol = normalized.match(POLICY_RE);
    if (pol) {
      policies.push({
        name: pol[1].toLowerCase(),
        table: pol[2].toLowerCase(),
        command: pol[3].toLowerCase() as ParsedPolicy["command"],
        body: pol[4].trim(),
      });
      continue;
    }

    const fn = normalized.match(FUNCTION_RE);
    if (fn) {
      functions.push({ name: fn[1].toLowerCase(), definition: normalized });
    }
  }

  return { rlsEnabled, policies, functions };
}

// ── Audit assertions over the parsed schema ─────────────────────────────────

export interface TableAudit {
  table: TenantTable;
  rlsEnabled: boolean;
  /** Policy commands present, lower-cased (e.g. ["select", "insert"]). */
  commands: string[];
  /** Every policy on the table constrains rows via auth_company_id(). */
  allPoliciesCompanyScoped: boolean;
  /** No policy uses an unscoped `using (true)` / `with check (true)`. */
  hasWildcardPolicy: boolean;
  /** Parsed policy posture equals POLICY_POSTURE for this table. */
  postureMatches: boolean;
  /** Admin-gated commands per POLICY_POSTURE actually require role = 'admin'. */
  adminGatesPresent: boolean;
}

const WILDCARD_RE = /\b(?:using|with\s+check)\s*\(\s*true\s*\)/i;
const COMPANY_SCOPE_RE = /auth_company_id\s*\(/i;
const ADMIN_GATE_RE = /role\s*=\s*'admin'/i;

export function auditSchema(parsed: ParsedSchema): TableAudit[] {
  return TENANT_TABLES.map((table) => {
    const tablePolicies = parsed.policies.filter((p) => p.table === table);
    const commands = tablePolicies.map((p) => p.command).sort();

    const expected = POLICY_POSTURE[table];
    const expectedCommands = expected.map((e) => e.command).sort();

    const postureMatches =
      commands.length === expectedCommands.length &&
      commands.every((c, i) => c === expectedCommands[i]);

    const adminGatesPresent = expected.every((e) => {
      if (!e.adminOnly) return true;
      const policy = tablePolicies.find((p) => p.command === e.command);
      return policy ? ADMIN_GATE_RE.test(policy.body) : false;
    });

    return {
      table,
      rlsEnabled: parsed.rlsEnabled.has(table),
      commands,
      allPoliciesCompanyScoped:
        tablePolicies.length > 0 &&
        tablePolicies.every((p) => COMPANY_SCOPE_RE.test(p.body)),
      hasWildcardPolicy: tablePolicies.some((p) => WILDCARD_RE.test(p.body)),
      postureMatches,
      adminGatesPresent,
    };
  });
}

export interface AuthCompanyIdAudit {
  defined: boolean;
  /** Resolves the caller's company by reading `users`, bypassing its RLS. */
  securityDefiner: boolean;
  /** Pins search_path so the SECURITY DEFINER function cannot be hijacked. */
  pinnedSearchPath: boolean;
}

/**
 * Audit the EFFECTIVE auth_company_id() definition (the last one wins, since
 * `create or replace` supersedes earlier definitions in migration order).
 */
export function auditAuthCompanyIdFn(parsed: ParsedSchema): AuthCompanyIdAudit {
  const defs = parsed.functions.filter((f) => f.name === "auth_company_id");
  const effective = defs[defs.length - 1];
  if (!effective) {
    return { defined: false, securityDefiner: false, pinnedSearchPath: false };
  }
  return {
    defined: true,
    securityDefiner: /security\s+definer/i.test(effective.definition),
    pinnedSearchPath: /set\s+search_path\s*=/i.test(effective.definition),
  };
}
