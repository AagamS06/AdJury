/**
 * Seed the demo dataset for a small user test (DailyPlan Day 68 — user-testing
 * prep). Populates a dev Supabase project with the realistic tenant defined in
 * `src/lib/demo/seed-data.ts` — a demo company (onboarded, with a cached business
 * context), a brand guide (with its cache), an admin + a member user, and a spread
 * of reviews whose verdicts cover pass / revise / fail — so a tester can log in and
 * run the whole core flow end-to-end against real data. The accompanying
 * walkthrough is `docs/USER_TEST_SCRIPT.md`.
 *
 * Runs ONLY when Supabase env vars are present. With no keys — as in the CI/offline
 * sandbox — it prints the manual steps and a preview of what WOULD be seeded, then
 * exits 0: it never fabricates or requires secrets (Rules.md §4). Reviews are
 * generated with the offline mock orchestrator (no AI key needed); with a live
 * `AI_API_KEY` set, real model output is stored instead.
 *
 *   With a dev project (keys in .env.local):
 *     node --env-file=.env.local --import tsx scripts/seed-demo.ts
 *     # or, if your Node is older than v20.6:
 *     npx dotenvx run -f .env.local -- npx tsx scripts/seed-demo.ts
 *
 * Re-running is guarded: if the demo users already exist the script refuses (so it
 * never silently duplicates a tenant). Pass SEED_RESET=1 to delete the prior demo
 * company + users first and re-seed cleanly:
 *     SEED_RESET=1 node --env-file=.env.local --import tsx scripts/seed-demo.ts
 *
 * A fresh random password is generated for each demo user at run time, printed once
 * here, and never written to disk or the repo (Rules.md §4).
 */
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runReview } from "@/lib/ai/orchestrator";
import { serverClient } from "@/lib/db/supabase";
import {
  completeCompanyOnboarding,
  insertBrandProfile,
  insertCompany,
  insertReviewWithScores,
  insertUser,
  updateUserDisplayName,
} from "@/lib/db/queries";
import { normalizeWebsiteUrl } from "@/lib/company/business-context";
import {
  DEMO_BRAND_GUIDE,
  DEMO_COMPANY,
  DEMO_REVIEW_SCENARIOS,
  DEMO_USERS,
  demoBrandCache,
  demoBusinessContextCache,
  demoReviewInput,
  type DemoUser,
} from "@/lib/demo/seed-data";

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

function missingEnv(): string[] {
  return REQUIRED.filter((k) => !process.env[k]?.trim());
}

function printManualSteps(missing: string[]): void {
  const scenarioLines = DEMO_REVIEW_SCENARIOS.map(
    (s) => `       • ${s.title}`,
  ).join("\n");
  console.log(
    [
      "── AdJury demo seed ─────────────────────────────────────────────────",
      "Skipped: no Supabase credentials in this environment.",
      `Missing: ${missing.join(", ")}`,
      "",
      "This dataset is still fully defined and unit-tested; it just needs a dev",
      "DB to land in. What it WOULD seed:",
      "",
      `  Company:  ${DEMO_COMPANY.name} (${DEMO_COMPANY.industry}, ${DEMO_COMPANY.plan_tier})`,
      `  Website:  ${DEMO_COMPANY.website_url}`,
      `  Users:    ${DEMO_USERS.map((u) => `${u.email} (${u.role})`).join(", ")}`,
      "  Brand:    a measured, concrete tone guide (with its cache)",
      "  Reviews:",
      scenarioLines,
      "",
      "To run it against a dev Supabase project:",
      "  1. Create a Supabase project (or use a local `supabase start`).",
      "  2. Apply the migrations in supabase/migrations/ (0001 … latest).",
      "  3. Copy .env.example -> .env.local and fill in:",
      "       NEXT_PUBLIC_SUPABASE_URL",
      "       NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "       SUPABASE_SERVICE_ROLE_KEY   (server-only; never commit)",
      "  4. Run:",
      "       node --env-file=.env.local --import tsx scripts/seed-demo.ts",
      "",
      "A fresh random password is generated per demo user and printed once.",
      "No secrets are ever written to disk. See docs/USER_TEST_SCRIPT.md.",
      "─────────────────────────────────────────────────────────────────────",
    ].join("\n"),
  );
}

/** A throwaway, run-time-only password for a demo auth user (never persisted). */
function generatePassword(): string {
  // base64url of 18 random bytes → 24 url-safe chars; prefix keeps it readable.
  return `Demo-${randomBytes(18).toString("base64url")}`;
}

interface ExistingDemoRow {
  id: string;
  company_id: string;
  email: string;
}

/** Find any already-seeded demo users by their (reserved) demo emails. */
async function findExistingDemoUsers(
  db: SupabaseClient,
): Promise<ExistingDemoRow[]> {
  const emails = DEMO_USERS.map((u) => u.email);
  const { data, error } = await db
    .from("users")
    .select("id, company_id, email")
    .in("email", emails);
  if (error) throw new Error(`lookup existing demo users failed: ${error.message}`);
  return (data as ExistingDemoRow[] | null) ?? [];
}

/**
 * Tear down a prior demo seed (SEED_RESET=1). Scoped strictly to the demo emails:
 * deletes each demo user's company (cascading users / brand_profiles / reviews /
 * persona_scores) and then the backing auth users. Never issues a broad delete.
 */
async function resetDemo(
  db: SupabaseClient,
  existing: ExistingDemoRow[],
): Promise<void> {
  const companyIds = [...new Set(existing.map((r) => r.company_id))];
  for (const companyId of companyIds) {
    const { error } = await db.from("companies").delete().eq("id", companyId);
    if (error) throw new Error(`reset: delete company ${companyId} failed: ${error.message}`);
  }
  for (const row of existing) {
    const { error } = await db.auth.admin.deleteUser(row.id);
    // The public row is already gone via the company cascade; only the auth user
    // remains to clean up. A missing auth user is fine.
    if (error && !/not.?found/i.test(error.message)) {
      console.warn(`reset: delete auth user ${row.email} warning: ${error.message}`);
    }
  }
  console.log(`✓ reset: removed ${companyIds.length} prior demo company/companies`);
}

async function seedUser(
  db: SupabaseClient,
  companyId: string,
  user: DemoUser,
): Promise<{ id: string; email: string; role: string; password: string }> {
  const password = generatePassword();
  const { data: authData, error: authErr } = await db.auth.admin.createUser({
    email: user.email,
    password,
    email_confirm: true,
  });
  if (authErr) throw new Error(`auth.admin.createUser(${user.email}): ${authErr.message}`);
  const authId = authData.user.id;

  await insertUser(db, {
    id: authId,
    company_id: companyId,
    email: user.email,
    role: user.role,
  });
  await updateUserDisplayName(db, companyId, authId, user.display_name);
  return { id: authId, email: user.email, role: user.role, password };
}

async function main(): Promise<void> {
  const missing = missingEnv();
  if (missing.length > 0) {
    printManualSteps(missing);
    return; // exit 0 — a missing dev DB is not a failure.
  }

  const db = serverClient();

  // Guard against accidental duplicate seeds.
  const existing = await findExistingDemoUsers(db);
  if (existing.length > 0) {
    if (process.env.SEED_RESET?.trim() === "1") {
      await resetDemo(db, existing);
    } else {
      console.error(
        [
          "Demo data already exists (found demo users):",
          ...existing.map((r) => `  • ${r.email}`),
          "",
          "Refusing to seed again to avoid duplicates. To re-seed cleanly, run:",
          "  SEED_RESET=1 node --env-file=.env.local --import tsx scripts/seed-demo.ts",
        ].join("\n"),
      );
      process.exitCode = 1;
      return;
    }
  }

  // 1. Company + onboarding (with the cached business context).
  const company = await insertCompany(db, {
    name: DEMO_COMPANY.name,
    industry: DEMO_COMPANY.industry,
    plan_tier: DEMO_COMPANY.plan_tier,
  });
  const businessCache = demoBusinessContextCache();
  await completeCompanyOnboarding(db, company.id, {
    name: DEMO_COMPANY.name,
    industry: DEMO_COMPANY.industry,
    plan_tier: DEMO_COMPANY.plan_tier,
    website_url: normalizeWebsiteUrl(DEMO_COMPANY.website_url),
    business_summary: businessCache.summary,
    business_context_ref: businessCache.contextRef,
  });
  console.log(`✓ company seeded:   ${company.id} (${DEMO_COMPANY.name})`);

  // 2. Users (admin + member), each with a fresh random password.
  const credentials: { email: string; role: string; password: string }[] = [];
  const usersByKey = new Map<DemoUser["key"], { id: string }>();
  for (const user of DEMO_USERS) {
    const seeded = await seedUser(db, company.id, user);
    usersByKey.set(user.key, { id: seeded.id });
    credentials.push({ email: seeded.email, role: seeded.role, password: seeded.password });
    console.log(`✓ user seeded:      ${seeded.email} (${seeded.role})`);
  }

  // 3. Brand profile (with its cache).
  const brandCache = demoBrandCache();
  await insertBrandProfile(db, {
    company_id: company.id,
    tone_guide_text: DEMO_BRAND_GUIDE,
    embedding_ref: brandCache.embeddingRef,
    brand_summary: brandCache.summary,
  });
  console.log("✓ brand profile seeded (with cache)");

  // 4. Reviews — alternate the submitter so both users have authored history.
  const submitters = [usersByKey.get("admin")!, usersByKey.get("member")!];
  let i = 0;
  for (const scenario of DEMO_REVIEW_SCENARIOS) {
    const input = demoReviewInput(scenario);
    const review = await runReview(input); // offline mock unless AI_API_KEY set.
    const submittedBy = submitters[i % submitters.length].id;
    const persisted = await insertReviewWithScores(db, {
      companyId: company.id,
      submittedBy,
      content_text: input.content_text,
      review,
    });
    console.log(
      `✓ review seeded:    ${scenario.key} → verdict=${persisted.review.verdict} ` +
        `(aggregate=${persisted.review.aggregate_score})`,
    );
    i++;
  }

  // 5. Credentials + next steps.
  console.log("\n── Demo seed complete ───────────────────────────────────────────────");
  console.log("Log in at /login with either account (passwords shown once, not stored):\n");
  for (const c of credentials) {
    console.log(`  ${c.role.padEnd(6)}  ${c.email}`);
    console.log(`          password: ${c.password}`);
  }
  console.log("\nNext: `npm run dev`, open http://localhost:3000/login, and follow");
  console.log("docs/USER_TEST_SCRIPT.md to run the core flow end-to-end.");
  console.log("─────────────────────────────────────────────────────────────────────");
}

main().catch((err) => {
  console.error("Demo seed FAILED:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
