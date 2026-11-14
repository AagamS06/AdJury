/**
 * Production configuration & readiness (DailyPlan Day 78 — Week 12 deploy prep).
 *
 * "Vercel + Supabase prod env wiring (secrets in dashboards, not repo). Provision
 *  the prod Postgres + a media-storage bucket; apply all migrations.
 *  DoD: prod config documented and ready; RLS verified against the live DB."
 *
 * This is the single source of truth for what a production deployment needs, and
 * the executable half of the DoD — everything here is PURE and node-testable, so
 * "prod config … ready" is a check that runs offline with no Vercel, no Supabase,
 * no network and no live credential (Rules.md §4). The parts that genuinely need a
 * live credential or a dashboard click (creating the prod Postgres, applying the
 * migrations to it, creating the storage bucket, wiring the Vercel env vars, and
 * verifying RLS against the LIVE DB) are declared as explicit `manual` steps with
 * their runbook — never faked, never marked done without the real thing.
 *
 * It composes the existing inventories rather than restating them, so it cannot
 * drift from what the app actually uses:
 *   - the env surface is derived from the Day-46 `ENV_VAR_POSTURE` (secrets-audit);
 *   - the RLS "ready" proxy is the Day-43 `auditSchema` / `auditAuthCompanyIdFn`
 *     run over the real committed migrations;
 *   - the `.env.example` completeness check reuses the Day-46 `auditEnvExample`.
 *
 * Four surfaces:
 *   1. PROD ENV REQUIREMENTS — every env var's production home (Vercel), the
 *      dashboard its VALUE comes from, and whether prod needs it. Derived 1:1 from
 *      `ENV_VAR_POSTURE` (the reconcile guard pins it), so a new key can't ship
 *      without a documented prod posture.
 *   2. MIGRATION SET AUDIT — the committed migrations form a gapless, well-formed,
 *      correctly-ordered 0001…NNNN sequence, so "apply all migrations" has one
 *      canonical order with no gap or duplicate.
 *   3. STORAGE BUCKETS — the tenant-scoped, PRIVATE media bucket for uploaded
 *      creatives (the production upgrade over today's inline image ads).
 *   4. READINESS REPORT + RECONCILE — composes the above plus the static RLS proxy
 *      into a ready/manual report and a drift guard.
 */

import {
  ENV_VAR_POSTURE,
  auditEnvExample,
  type EnvExposure,
  type EnvVarPosture,
} from "@/lib/security/secrets-audit";
import {
  TENANT_TABLES,
  parseSchemaSql,
  auditSchema,
  auditAuthCompanyIdFn,
} from "@/lib/db/rls-audit";

// ── 1. Production env requirements ───────────────────────────────────────────

/**
 * How strongly a correctly-functioning production deployment needs a var:
 *  - `required`    — the app cannot run in prod without it.
 *  - `recommended` — prod should set it; a safe fallback exists (e.g. the AI key
 *                    is blank ⇒ offline mock, fine for a demo, wrong for a live
 *                    product).
 *  - `optional`    — needed only once a dependent feature goes live (the Stripe
 *                    scaffold is test-mode in v1; billing is not wired to prod).
 */
export type ProdNeed = "required" | "recommended" | "optional";

/** The dashboard a value is created in (and copied FROM — never into the repo). */
export type ValueSource =
  | "Supabase dashboard"
  | "Anthropic console"
  | "Stripe dashboard"
  | "Deployment config";

/**
 * One env var's production posture. `surface` is always `vercel` — the deployed
 * Next app reads every env var from the Vercel project's environment settings;
 * `source` is where a secret value is minted so the operator copies it into
 * Vercel (Rules.md §4 — "secrets live in the Vercel and Supabase dashboards, not
 * in the repo"). Enriches, and stays 1:1 with, the Day-46 `ENV_VAR_POSTURE`.
 */
export interface ProdEnvRequirement {
  name: string;
  exposure: EnvExposure;
  secret: boolean;
  need: ProdNeed;
  /** Always "vercel": the deployed app reads all env from the Vercel project. */
  surface: "vercel";
  source: ValueSource;
  note: string;
}

/** Per-var prod enrichment, keyed by env var name. Reconciled 1:1 with the inventory. */
interface ProdEnvOverride {
  need: ProdNeed;
  source: ValueSource;
  note: string;
}

const PROD_ENV_OVERRIDES: Record<string, ProdEnvOverride> = {
  NEXT_PUBLIC_APP_URL: {
    need: "required",
    source: "Deployment config",
    note: "The public prod origin (custom domain) — absolute invite links break without it in prod.",
  },
  NEXT_PUBLIC_SUPABASE_URL: {
    need: "required",
    source: "Supabase dashboard",
    note: "Prod project URL — Settings → API.",
  },
  NEXT_PUBLIC_SUPABASE_ANON_KEY: {
    need: "required",
    source: "Supabase dashboard",
    note: "Prod anon key — Settings → API. Public; RLS enforces tenancy.",
  },
  SUPABASE_SERVICE_ROLE_KEY: {
    need: "required",
    source: "Supabase dashboard",
    note: "Prod service-role key — Settings → API. Vercel env only, never the repo or the client bundle.",
  },
  AI_PROVIDER: {
    need: "recommended",
    source: "Deployment config",
    note: "Provider selector (anthropic in v1).",
  },
  AI_API_KEY: {
    need: "recommended",
    source: "Anthropic console",
    note: "Blank ⇒ offline mock (fine for a demo, wrong for a live product). Set a real key for prod reviews.",
  },
  AI_MODEL: {
    need: "recommended",
    source: "Deployment config",
    note: "Model id (defaults to claude-haiku-4-5).",
  },
  AI_TEMPERATURE: {
    need: "optional",
    source: "Deployment config",
    note: "Sampling temperature; defaults keep scoring reproducible.",
  },
  STRIPE_SECRET_KEY: {
    need: "optional",
    source: "Stripe dashboard",
    note: "Needed only when billing goes live. v1 ships the test-mode scaffold; blank ⇒ offline mock.",
  },
  STRIPE_PRICE_ENTRY_MONTHLY: {
    need: "optional",
    source: "Stripe dashboard",
    note: "Entry-plan Price id; needed only when billing goes live.",
  },
  STRIPE_TRIAL_DAYS: {
    need: "optional",
    source: "Deployment config",
    note: "Trial length (0–90, default 30); config value, not a secret.",
  },
  STRIPE_WEBHOOK_SECRET: {
    need: "optional",
    source: "Stripe dashboard",
    note: "Webhook signing secret; needed only when billing goes live.",
  },
};

/**
 * The production env surface, derived from the single inventory so it cannot
 * drift: one requirement per `ENV_VAR_POSTURE` entry, enriched with its prod
 * need/source. A var with no override would throw at module load (caught by the
 * reconcile guard's test), so adding a key forces adding its prod posture.
 */
export const PROD_ENV_REQUIREMENTS: readonly ProdEnvRequirement[] =
  ENV_VAR_POSTURE.map((v: EnvVarPosture): ProdEnvRequirement => {
    const override = PROD_ENV_OVERRIDES[v.name];
    if (!override) {
      // A new inventoried var with no prod posture: fail loud, don't guess.
      throw new Error(`prod-config: no production posture declared for env var "${v.name}"`);
    }
    return {
      name: v.name,
      exposure: v.exposure,
      secret: v.secret,
      need: override.need,
      surface: "vercel",
      source: override.source,
      note: override.note,
    };
  });

/** Prod-required var names (the app cannot run in prod without these). */
export function requiredProdEnvVars(): string[] {
  return PROD_ENV_REQUIREMENTS.filter((e) => e.need === "required").map((e) => e.name);
}

/** Secret var names that must be set in a dashboard (never committed). */
export function secretProdEnvVars(): string[] {
  return PROD_ENV_REQUIREMENTS.filter((e) => e.secret).map((e) => e.name);
}

// ── 2. Migration set audit ───────────────────────────────────────────────────

export interface MigrationEntry {
  file: string;
  /** The numeric prefix (0001 → 1). */
  number: number;
  slug: string;
}

export interface MigrationSetAudit {
  entries: MigrationEntry[];
  /** Files that do not match the `NNNN_slug.sql` convention. */
  malformed: string[];
  /** Missing numbers in the 1…max sequence (a gap breaks "apply all in order"). */
  gaps: number[];
  /** Numbers that appear more than once. */
  duplicates: number[];
  /** Lexical filename order equals ascending numeric order (so a lexical sort IS the apply order). */
  orderConsistent: boolean;
  count: number;
  /** All well-formed, no gaps, no duplicates, order consistent, at least one migration. */
  clean: boolean;
}

const MIGRATION_RE = /^(\d{4})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;

/**
 * Audit the set of migration filenames. A clean result is the executable form of
 * "apply all migrations": the files form a gapless, well-formed, consecutively
 * numbered 0001…NNNN sequence whose lexical order is exactly the apply order, so
 * there is one canonical order with no gap or duplicate to trip up `supabase db
 * push` / a manual psql run. Pure — the caller supplies the filenames.
 */
export function auditMigrationSet(files: readonly string[]): MigrationSetAudit {
  const sqlFiles = files.filter((f) => f.endsWith(".sql")).slice().sort();
  const entries: MigrationEntry[] = [];
  const malformed: string[] = [];

  for (const file of sqlFiles) {
    const m = MIGRATION_RE.exec(file);
    if (!m) {
      malformed.push(file);
      continue;
    }
    entries.push({ file, number: parseInt(m[1], 10), slug: m[2] });
  }

  const numbers = entries.map((e) => e.number);
  const seen = new Set<number>();
  const duplicates: number[] = [];
  for (const n of numbers) {
    if (seen.has(n) && !duplicates.includes(n)) duplicates.push(n);
    seen.add(n);
  }

  const gaps: number[] = [];
  if (numbers.length > 0) {
    const max = Math.max(...numbers);
    for (let i = 1; i <= max; i++) {
      if (!seen.has(i)) gaps.push(i);
    }
  }

  // Lexical order (sqlFiles is already sorted) must equal ascending numeric order.
  const orderConsistent = entries.every(
    (e, i) => i === 0 || e.number > entries[i - 1].number,
  );

  const clean =
    entries.length > 0 &&
    malformed.length === 0 &&
    gaps.length === 0 &&
    duplicates.length === 0 &&
    orderConsistent;

  return {
    entries,
    malformed,
    gaps,
    duplicates,
    orderConsistent,
    count: entries.length,
    clean,
  };
}

// ── 3. Storage buckets ───────────────────────────────────────────────────────

/**
 * A Supabase Storage bucket the production deployment must provision. Image ads
 * currently pass the creative inline per request (Day 15a); durable, tenant-
 * scoped object storage is the production upgrade (Week 12 note). The bucket is
 * PRIVATE — a public bucket would expose one tenant's uploaded creatives to the
 * world, violating the multi-tenant safety rule (Rules.md §5). Access is brokered
 * server-side (signed URLs / the service-role client), scoped by `company_id`.
 */
export interface StorageBucketSpec {
  id: string;
  /** Must be false — a public bucket would leak tenant creatives. */
  public: boolean;
  purpose: string;
  /** Object key convention that keeps objects tenant-scoped. */
  pathConvention: string;
  note: string;
}

export const STORAGE_BUCKETS: readonly StorageBucketSpec[] = [
  {
    id: "creatives",
    public: false,
    purpose: "Uploaded image (and later video) ad creatives for review.",
    pathConvention: "{company_id}/{review_id}/{filename}",
    note: "Private; access brokered server-side via signed URLs, scoped by company_id (Rules.md §5). Size/type guarded before upload, mirroring the inline image guard.",
  },
];

// ── 4. Readiness report + reconcile ──────────────────────────────────────────

/**
 * `ready`  — verified HERE, offline, with no credential (a static/structural check).
 * `manual` — needs a live credential or a dashboard action; documented, never faked.
 */
export type ReadinessStatus = "ready" | "manual";

export interface ReadinessItem {
  id: string;
  title: string;
  status: ReadinessStatus;
  detail: string;
}

export interface RlsStaticProxy {
  allEnabled: boolean;
  allScoped: boolean;
  noWildcard: boolean;
  postureClean: boolean;
  helperHardened: boolean;
  /** The offline RLS proxy is clean (the live-DB proof is a separate manual step). */
  clean: boolean;
}

export interface ProdReadiness {
  items: ReadinessItem[];
  migrations: MigrationSetAudit;
  rls: RlsStaticProxy;
  envDocClean: boolean;
  /** Every offline-verifiable (`ready`) item actually passed. */
  ready: boolean;
  /** Count of steps that still need a live credential / dashboard action. */
  manualSteps: number;
}

/** The static RLS proxy over committed migration SQL (Day-43 audit, reused). */
export function rlsStaticProxy(migrationSql: string): RlsStaticProxy {
  const parsed = parseSchemaSql(migrationSql);
  const tableAudits = auditSchema(parsed);
  const fn = auditAuthCompanyIdFn(parsed);

  const allEnabled = TENANT_TABLES.every(
    (t) => tableAudits.find((a) => a.table === t)?.rlsEnabled === true,
  );
  const allScoped = tableAudits.every((a) => a.allPoliciesCompanyScoped);
  const noWildcard = tableAudits.every((a) => !a.hasWildcardPolicy);
  const postureClean = tableAudits.every((a) => a.postureMatches && a.adminGatesPresent);
  const helperHardened = fn.defined && fn.securityDefiner && fn.pinnedSearchPath;

  return {
    allEnabled,
    allScoped,
    noWildcard,
    postureClean,
    helperHardened,
    clean: allEnabled && allScoped && noWildcard && postureClean && helperHardened,
  };
}

export interface ProdReadinessInput {
  migrationFiles: readonly string[];
  migrationSql: string;
  envExample: string;
}

/**
 * Compose the production-readiness report. The `ready` items are the ones this
 * repo can prove offline — the migration set is apply-ready, RLS is defined
 * correctly in the committed SQL (the static proxy), and `.env.example` documents
 * the full env surface with no leaked secret. The `manual` items are the genuine
 * credential/dashboard steps (provision prod Postgres + apply migrations, create
 * the private creatives bucket, wire the Vercel env vars, and verify RLS against
 * the LIVE DB) — each carries its runbook pointer and is never auto-marked done.
 */
export function buildProdReadiness(input: ProdReadinessInput): ProdReadiness {
  const migrations = auditMigrationSet(input.migrationFiles);
  const rls = rlsStaticProxy(input.migrationSql);
  const env = auditEnvExample(input.envExample);
  const envDocClean =
    env.missingFromExample.length === 0 &&
    env.extraInExample.length === 0 &&
    env.exposureMismatches.length === 0 &&
    env.secretValueLeaks.length === 0 &&
    env.duplicateKeys.length === 0;

  const items: ReadinessItem[] = [
    {
      id: "migration-set",
      title: "Migrations form a gapless, ordered, apply-ready sequence",
      status: migrations.clean ? "ready" : "manual",
      detail: `${migrations.count} migration(s), 0001…${String(migrations.count).padStart(4, "0")}; gaps=${migrations.gaps.length}, duplicates=${migrations.duplicates.length}, malformed=${migrations.malformed.length}.`,
    },
    {
      id: "rls-static",
      title: "RLS is defined on every tenant table in the committed SQL (offline proxy)",
      status: rls.clean ? "ready" : "manual",
      detail:
        "Static proxy for the live-DB check: RLS enabled + every policy company-scoped + no wildcard + posture matches + auth_company_id() hardened. The authoritative live-DB verification is a separate manual step.",
    },
    {
      id: "env-doc",
      title: "`.env.example` documents the full env surface with no committed secret",
      status: envDocClean ? "ready" : "manual",
      detail:
        "Every inventoried var documented, prefixes match exposure, no real secret value committed (Day-46 audit).",
    },
    {
      id: "supabase-prod",
      title: "Provision prod Supabase (Postgres) and apply all migrations",
      status: "manual",
      detail:
        "Create the prod project, then `supabase db push` (or psql) to apply supabase/migrations/* in order. See docs/PRODUCTION_SETUP.md §2.",
    },
    {
      id: "storage-bucket",
      title: "Create the private, tenant-scoped creatives storage bucket",
      status: "manual",
      detail: `Create bucket "${STORAGE_BUCKETS[0].id}" (public=${STORAGE_BUCKETS[0].public}). See docs/PRODUCTION_SETUP.md §3.`,
    },
    {
      id: "vercel-env",
      title: "Wire required env vars in the Vercel project (secrets in dashboards, not repo)",
      status: "manual",
      detail: `Set ${requiredProdEnvVars().length} required var(s) in Vercel; secret values come from their dashboards. See docs/PRODUCTION_SETUP.md §4.`,
    },
    {
      id: "rls-live",
      title: "Verify RLS against the LIVE DB",
      status: "manual",
      detail:
        "Run `npm run prod:check` with prod Supabase keys (confirms migrations applied) and the SQL/anon probes in docs/PRODUCTION_SETUP.md §5 to confirm RLS on the real DB.",
    },
  ];

  // The repo is "ready" when the three offline-verifiable items all pass; the
  // remaining items are intrinsically manual (live credential / dashboard).
  const OFFLINE_ITEM_IDS = ["migration-set", "rls-static", "env-doc"];
  const ready = items
    .filter((i) => OFFLINE_ITEM_IDS.includes(i.id))
    .every((i) => i.status === "ready");
  const manualSteps = items.filter((i) => i.status === "manual").length;

  return { items, migrations, rls, envDocClean, ready, manualSteps };
}

export interface ProdConfigReconcile {
  /** PROD_ENV_REQUIREMENTS is 1:1 with ENV_VAR_POSTURE (no undocumented/stale var). */
  envSurfaceMatchesInventory: boolean;
  /** Every secret var's value comes from a dashboard, never a committed source. */
  secretsRoutedOffRepo: boolean;
  /** Migration set is apply-ready. */
  migrationsClean: boolean;
  /** Static RLS proxy is clean. */
  rlsStaticClean: boolean;
  clean: boolean;
}

/**
 * Executable DoD + drift guard (the Day 43–73 "inventory + reconcile" pattern):
 * the prod env surface still mirrors the one env inventory, every secret is
 * sourced from a dashboard (not the repo), the migrations are apply-ready, and
 * RLS is defined across every tenant table in the committed SQL.
 */
export function reconcileProdConfig(input: {
  migrationFiles: readonly string[];
  migrationSql: string;
}): ProdConfigReconcile {
  const inventoryNames = new Set(ENV_VAR_POSTURE.map((e) => e.name));
  const prodNames = new Set(PROD_ENV_REQUIREMENTS.map((e) => e.name));
  const envSurfaceMatchesInventory =
    inventoryNames.size === prodNames.size &&
    [...inventoryNames].every((n) => prodNames.has(n)) &&
    PROD_ENV_REQUIREMENTS.length === ENV_VAR_POSTURE.length;

  // A committed source is never a value source — only a dashboard/deploy config is.
  const secretsRoutedOffRepo = PROD_ENV_REQUIREMENTS.filter((e) => e.secret).every(
    (e) => e.source !== "Deployment config" && e.surface === "vercel",
  );

  const migrations = auditMigrationSet(input.migrationFiles);
  const rls = rlsStaticProxy(input.migrationSql);

  return {
    envSurfaceMatchesInventory,
    secretsRoutedOffRepo,
    migrationsClean: migrations.clean,
    rlsStaticClean: rls.clean,
    clean:
      envSurfaceMatchesInventory &&
      secretsRoutedOffRepo &&
      migrations.clean &&
      rls.clean,
  };
}
