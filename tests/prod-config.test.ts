import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  PROD_ENV_REQUIREMENTS,
  STORAGE_BUCKETS,
  auditMigrationSet,
  rlsStaticProxy,
  buildProdReadiness,
  reconcileProdConfig,
  requiredProdEnvVars,
  secretProdEnvVars,
} from "@/lib/deploy/prod-config";
import { ENV_VAR_POSTURE } from "@/lib/security/secrets-audit";

/**
 * Production config & readiness (DailyPlan Day 78 — Week 12 deploy prep).
 *
 * "Vercel + Supabase prod env wiring; provision prod Postgres + media bucket;
 *  apply all migrations. DoD: prod config documented and ready; RLS verified
 *  against the live DB."
 *
 * The offline-verifiable half of the DoD runs here over the REAL repo: the
 * migration set is apply-ready, RLS is defined across every tenant table in the
 * committed SQL (the static proxy for the live-DB check), `.env.example` is
 * complete, and the prod env surface + storage bucket inventories are correct and
 * drift-guarded. The genuinely credential-bound steps are asserted to be reported
 * as `manual`, never silently marked done.
 */

// ── Load the real migrations + env example, as the scripts do ────────────────

const migrationsDir = fileURLToPath(new URL("../supabase/migrations", import.meta.url));
const envExamplePath = fileURLToPath(new URL("../.env.example", import.meta.url));

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
const envExample = readFileSync(envExamplePath, "utf8");

// ── Migration set audit ──────────────────────────────────────────────────────

describe("prod-config — migration set audit (apply all migrations)", () => {
  const audit = auditMigrationSet(migrationFiles());

  it("finds the real migrations (non-vacuous)", () => {
    expect(audit.count).toBeGreaterThanOrEqual(12);
    expect(audit.entries[0].file).toBe("0001_init.sql");
  });

  it("is a gapless, well-formed, consecutively-numbered, ordered sequence", () => {
    expect(audit.malformed).toEqual([]);
    expect(audit.gaps).toEqual([]);
    expect(audit.duplicates).toEqual([]);
    expect(audit.orderConsistent).toBe(true);
    expect(audit.clean).toBe(true);
    // Consecutive 1..N with no gap means number N == count.
    expect(audit.entries[audit.entries.length - 1].number).toBe(audit.count);
  });

  it("catches a gap in the sequence", () => {
    const a = auditMigrationSet(["0001_init.sql", "0003_later.sql"]);
    expect(a.gaps).toEqual([2]);
    expect(a.clean).toBe(false);
  });

  it("catches a duplicate number", () => {
    const a = auditMigrationSet(["0001_init.sql", "0001_dupe.sql", "0002_next.sql"]);
    expect(a.duplicates).toEqual([1]);
    expect(a.clean).toBe(false);
  });

  it("catches a malformed filename and ignores non-.sql files", () => {
    const a = auditMigrationSet(["0001_init.sql", "nope.sql", "README.md"]);
    expect(a.malformed).toEqual(["nope.sql"]);
    expect(a.entries.map((e) => e.file)).toEqual(["0001_init.sql"]);
    expect(a.clean).toBe(false);
  });

  it("is empty-safe and reports an empty set as not clean", () => {
    const a = auditMigrationSet([]);
    expect(a.count).toBe(0);
    expect(a.clean).toBe(false);
  });
});

// ── Prod env surface ─────────────────────────────────────────────────────────

describe("prod-config — production env surface", () => {
  it("is 1:1 with the Day-46 env inventory (no undocumented or stale var)", () => {
    const inventory = ENV_VAR_POSTURE.map((e) => e.name).sort();
    const prod = PROD_ENV_REQUIREMENTS.map((e) => e.name).sort();
    expect(prod).toEqual(inventory);
    expect(PROD_ENV_REQUIREMENTS.length).toBe(ENV_VAR_POSTURE.length);
  });

  it("carries over each var's exposure and secret flag unchanged from the inventory", () => {
    for (const req of PROD_ENV_REQUIREMENTS) {
      const inv = ENV_VAR_POSTURE.find((e) => e.name === req.name)!;
      expect(req.exposure).toBe(inv.exposure);
      expect(req.secret).toBe(inv.secret);
    }
  });

  it("requires exactly the three vars the app cannot run without", () => {
    expect(requiredProdEnvVars().sort()).toEqual(
      [
        "NEXT_PUBLIC_APP_URL",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "NEXT_PUBLIC_SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
      ].sort(),
    );
  });

  it("routes every secret value to a dashboard source on the Vercel surface (never the repo)", () => {
    const secrets = PROD_ENV_REQUIREMENTS.filter((e) => e.secret);
    expect(secrets.length).toBeGreaterThan(0);
    for (const s of secrets) {
      expect(s.surface).toBe("vercel");
      expect(s.source).not.toBe("Deployment config"); // a credential is minted in a dashboard
      expect(s.note.length).toBeGreaterThan(0);
    }
    // The secret set agrees with the inventory's secret set.
    expect(secretProdEnvVars().sort()).toEqual(
      ENV_VAR_POSTURE.filter((e) => e.secret).map((e) => e.name).sort(),
    );
  });

  it("gives every requirement a valid need, a vercel surface, and a note", () => {
    for (const req of PROD_ENV_REQUIREMENTS) {
      expect(["required", "recommended", "optional"]).toContain(req.need);
      expect(req.surface).toBe("vercel");
      expect(req.note.trim().length).toBeGreaterThan(0);
    }
  });
});

// ── Storage buckets ──────────────────────────────────────────────────────────

describe("prod-config — media storage bucket", () => {
  it("declares a private, tenant-scoped creatives bucket", () => {
    const creatives = STORAGE_BUCKETS.find((b) => b.id === "creatives");
    expect(creatives).toBeDefined();
    expect(creatives!.public).toBe(false); // a public bucket would leak tenant creatives
    expect(creatives!.pathConvention).toContain("{company_id}");
  });

  it("marks no bucket as public (multi-tenant safety, Rules.md §5)", () => {
    for (const b of STORAGE_BUCKETS) expect(b.public).toBe(false);
  });
});

// ── Static RLS proxy ─────────────────────────────────────────────────────────

describe("prod-config — static RLS proxy over committed SQL", () => {
  it("is clean over the real migrations (RLS defined on every tenant table)", () => {
    const rls = rlsStaticProxy(migrationSql());
    expect(rls.allEnabled).toBe(true);
    expect(rls.allScoped).toBe(true);
    expect(rls.noWildcard).toBe(true);
    expect(rls.postureClean).toBe(true);
    expect(rls.helperHardened).toBe(true);
    expect(rls.clean).toBe(true);
  });

  it("is non-vacuous: dropping an `enable row level security` makes it dirty", () => {
    const broken = migrationSql().replace(
      /alter table reviews\s+enable row level security;/i,
      "-- removed for the test",
    );
    const rls = rlsStaticProxy(broken);
    expect(rls.allEnabled).toBe(false);
    expect(rls.clean).toBe(false);
  });
});

// ── Readiness report ─────────────────────────────────────────────────────────

describe("prod-config — readiness report", () => {
  const readiness = buildProdReadiness({
    migrationFiles: migrationFiles(),
    migrationSql: migrationSql(),
    envExample,
  });

  it("marks the three offline-verifiable items ready and reports overall ready", () => {
    const byId = Object.fromEntries(readiness.items.map((i) => [i.id, i]));
    expect(byId["migration-set"].status).toBe("ready");
    expect(byId["rls-static"].status).toBe("ready");
    expect(byId["env-doc"].status).toBe("ready");
    expect(readiness.ready).toBe(true);
    expect(readiness.envDocClean).toBe(true);
  });

  it("keeps the genuinely credential-bound steps as manual (never faked)", () => {
    const byId = Object.fromEntries(readiness.items.map((i) => [i.id, i]));
    for (const id of ["supabase-prod", "storage-bucket", "vercel-env", "rls-live"]) {
      expect(byId[id].status).toBe("manual");
    }
    expect(readiness.manualSteps).toBe(4);
  });

  it("gives every item an id, a title, and a detail", () => {
    for (const item of readiness.items) {
      expect(item.id.length).toBeGreaterThan(0);
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.detail.length).toBeGreaterThan(0);
    }
  });

  it("reports not-ready when the migration set is broken (non-vacuous)", () => {
    const broken = buildProdReadiness({
      migrationFiles: ["0001_init.sql", "0003_gap.sql"],
      migrationSql: migrationSql(),
      envExample,
    });
    const byId = Object.fromEntries(broken.items.map((i) => [i.id, i]));
    expect(byId["migration-set"].status).toBe("manual");
    expect(broken.ready).toBe(false);
  });
});

// ── Reconcile / drift guard ──────────────────────────────────────────────────

describe("prod-config — reconcile (executable DoD + drift guard)", () => {
  it("is clean over the real repo", () => {
    const r = reconcileProdConfig({
      migrationFiles: migrationFiles(),
      migrationSql: migrationSql(),
    });
    expect(r.envSurfaceMatchesInventory).toBe(true);
    expect(r.secretsRoutedOffRepo).toBe(true);
    expect(r.migrationsClean).toBe(true);
    expect(r.rlsStaticClean).toBe(true);
    expect(r.clean).toBe(true);
  });

  it("is non-vacuous: a malformed migration set fails reconcile", () => {
    const r = reconcileProdConfig({
      migrationFiles: ["0001_init.sql", "bad-name.sql"],
      migrationSql: migrationSql(),
    });
    expect(r.migrationsClean).toBe(false);
    expect(r.clean).toBe(false);
  });
});
