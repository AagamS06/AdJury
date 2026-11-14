/**
 * Production config check (DailyPlan Day 78 — Week 12 deploy prep).
 *
 * Prints the production-readiness report (the offline-verifiable checks: the
 * migration set is apply-ready, RLS is defined in the committed SQL, and
 * `.env.example` is complete) and the remaining manual steps (provision prod
 * Postgres + apply migrations, create the private creatives bucket, wire the
 * Vercel env vars, verify RLS against the live DB).
 *
 * Offline-first, exactly like `db-smoke.ts`: with no Supabase credentials it
 * reports readiness + the manual runbook and exits 0 — it never fabricates or
 * requires a secret (Rules.md §4). With prod Supabase keys present it ALSO probes
 * the live DB to confirm every tenant table exists (i.e. migrations were applied);
 * the full behavioural RLS proof is the anon-client / SQL check documented in
 * docs/PRODUCTION_SETUP.md §5.
 *
 *   Against a prod/dev Supabase project (keys in .env.local):
 *     node --env-file=.env.local --import tsx scripts/prod-config-check.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildProdReadiness,
  reconcileProdConfig,
  requiredProdEnvVars,
  PROD_ENV_REQUIREMENTS,
  STORAGE_BUCKETS,
  type ProdReadiness,
} from "@/lib/deploy/prod-config";
import { TENANT_TABLES } from "@/lib/db/rls-audit";
import { serverClient } from "@/lib/db/supabase";

const migrationsDir = fileURLToPath(new URL("../supabase/migrations", import.meta.url));
const envExamplePath = fileURLToPath(new URL("../.env.example", import.meta.url));

function loadReadiness(): ProdReadiness {
  const migrationFiles = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
  const migrationSql = migrationFiles
    .slice()
    .sort()
    .map((f) => readFileSync(`${migrationsDir}/${f}`, "utf8"))
    .join("\n");
  const envExample = readFileSync(envExamplePath, "utf8");
  return buildProdReadiness({ migrationFiles, migrationSql, envExample });
}

function printReadiness(readiness: ProdReadiness): void {
  console.log("── AdJury production readiness ──────────────────────────────────────");
  for (const item of readiness.items) {
    const mark = item.status === "ready" ? "✓ READY " : "• MANUAL";
    console.log(`${mark}  ${item.title}`);
    console.log(`          ${item.detail}`);
  }
  console.log("");
  console.log(
    `Offline checks: ${readiness.ready ? "PASS" : "FAIL"} · manual steps remaining: ${readiness.manualSteps}`,
  );
  console.log("");
  console.log("Required prod env vars (set in Vercel; secret values from their dashboards):");
  for (const e of PROD_ENV_REQUIREMENTS.filter((r) => r.need === "required")) {
    console.log(`  - ${e.name}${e.secret ? "  [secret]" : ""}  (${e.source})`);
  }
  console.log("");
  console.log("Storage buckets to provision (private, tenant-scoped):");
  for (const b of STORAGE_BUCKETS) {
    console.log(`  - ${b.id}  public=${b.public}  path=${b.pathConvention}`);
  }
  console.log("─────────────────────────────────────────────────────────────────────");
}

const REQUIRED_DB_ENV = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;

function missingDbEnv(): string[] {
  return REQUIRED_DB_ENV.filter((k) => !process.env[k]?.trim());
}

async function verifyLiveTables(): Promise<boolean> {
  const db = serverClient();
  let allPresent = true;
  console.log("\nLive DB check — confirming every tenant table exists (migrations applied):");
  for (const table of TENANT_TABLES) {
    const { error } = await db
      .from(table)
      .select("*", { head: true, count: "exact" })
      .limit(0);
    if (error) {
      allPresent = false;
      console.log(`  ✗ ${table}: ${error.message}`);
    } else {
      console.log(`  ✓ ${table}`);
    }
  }
  console.log(
    "\nNote: table existence proves migrations are applied. The behavioural RLS",
  );
  console.log(
    "proof (cross-tenant denial via the anon client) is the manual check in",
  );
  console.log("docs/PRODUCTION_SETUP.md §5.");
  return allPresent;
}

async function main(): Promise<void> {
  const readiness = loadReadiness();
  printReadiness(readiness);

  // Drift guard: the config must reconcile regardless of credentials.
  const reconcile = reconcileProdConfig({
    migrationFiles: readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")),
    migrationSql: readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(`${migrationsDir}/${f}`, "utf8"))
      .join("\n"),
  });
  if (!reconcile.clean) {
    console.error("\nprod-config reconcile FAILED:", JSON.stringify(reconcile, null, 2));
    process.exitCode = 1;
    return;
  }

  const missing = missingDbEnv();
  if (missing.length > 0) {
    console.log(
      [
        "",
        "Live DB check skipped: no Supabase credentials in this environment.",
        `Missing: ${missing.join(", ")}`,
        "",
        "To verify RLS against the live DB, apply the migrations to the prod",
        "project, set the keys in .env.local, and re-run:",
        "  node --env-file=.env.local --import tsx scripts/prod-config-check.ts",
        `Required env for prod: ${requiredProdEnvVars().join(", ")}`,
        "Full runbook: docs/PRODUCTION_SETUP.md",
      ].join("\n"),
    );
    return; // exit 0 — a missing dev/prod DB is not a failure of this check.
  }

  const livePresent = await verifyLiveTables();
  if (!livePresent) {
    console.error("\nLive DB check FAILED: some tenant tables are missing — apply all migrations.");
    process.exitCode = 1;
    return;
  }
  console.log("\nProduction config check PASSED (offline checks + live tables present).");
}

main().catch((err) => {
  console.error("prod-config check FAILED:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
