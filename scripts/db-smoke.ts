/**
 * DB smoke test (DailyPlan Day 2): insert a review with its persona_scores and
 * read it back, exercising src/lib/db/queries.ts against a real Supabase.
 *
 * Runs ONLY when Supabase env vars are present (a dev project). With no keys —
 * as in the CI/offline sandbox — it prints the manual steps and exits 0, so it
 * never fabricates or requires secrets (Rules.md §4).
 *
 *   With a dev project (keys in .env.local):
 *     node --env-file=.env.local --import tsx scripts/db-smoke.ts
 *     # or, if your Node is older than v20.6:
 *     npx dotenvx run -f .env.local -- npx tsx scripts/db-smoke.ts
 *
 * It creates a throwaway auth user + company, inserts a mock review, reads it
 * back and lists it, then deletes everything it created (cascades clean up
 * users/reviews/persona_scores).
 */
import { runReview } from "@/lib/ai/orchestrator";
import { ReviewInputSchema } from "@/lib/schema/juror";
import { serverClient } from "@/lib/db/supabase";
import {
  getReviewById,
  insertCompany,
  insertReviewWithScores,
  insertUser,
  listReviewsByCompany,
} from "@/lib/db/queries";

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

function missingEnv(): string[] {
  return REQUIRED.filter((k) => !process.env[k]?.trim());
}

function printManualSteps(missing: string[]): void {
  console.log(
    [
      "── AdJury DB smoke test ─────────────────────────────────────────────",
      "Skipped: no Supabase credentials in this environment.",
      `Missing: ${missing.join(", ")}`,
      "",
      "To run it against a dev Supabase project:",
      "  1. Create a Supabase project (or use a local `supabase start`).",
      "  2. Apply the schema:  supabase/migrations/0001_init.sql",
      "  3. Copy .env.example -> .env.local and fill in:",
      "       NEXT_PUBLIC_SUPABASE_URL",
      "       NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "       SUPABASE_SERVICE_ROLE_KEY   (server-only; never commit)",
      "  4. Run:",
      "       node --env-file=.env.local --import tsx scripts/db-smoke.ts",
      "",
      "The script inserts a throwaway company + user + review, reads it back,",
      "and deletes everything it created. No secrets are ever written to disk.",
      "─────────────────────────────────────────────────────────────────────",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const missing = missingEnv();
  if (missing.length > 0) {
    printManualSteps(missing);
    return; // exit 0 — a missing dev DB is not a failure.
  }

  const db = serverClient();
  const stamp = Date.now();
  const email = `smoke+${stamp}@adjury.test`;
  let authUserId: string | null = null;
  let companyId: string | null = null;

  try {
    // A user row references auth.users, so create an auth user first.
    const { data: authData, error: authErr } = await db.auth.admin.createUser({
      email,
      password: `smoke-${stamp}-pw`,
      email_confirm: true,
    });
    if (authErr) throw new Error(`auth.admin.createUser: ${authErr.message}`);
    authUserId = authData.user.id;

    const company = await insertCompany(db, {
      name: `Smoke Test Co ${stamp}`,
      industry: "software",
      plan_tier: "free",
    });
    companyId = company.id;
    console.log(`✓ company inserted: ${company.id}`);

    const user = await insertUser(db, {
      id: authUserId,
      company_id: company.id,
      email,
      role: "admin",
    });
    console.log(`✓ user inserted:    ${user.id}`);

    const input = ReviewInputSchema.parse({
      content_type: "ad_copy",
      platform: "instagram",
      content_text:
        "Our project-tracking app helps small teams ship on time without the busywork.",
    });
    const review = await runReview(input); // offline mock is fine here.

    const persisted = await insertReviewWithScores(db, {
      companyId: company.id,
      submittedBy: user.id,
      content_text: input.content_text,
      review,
    });
    console.log(
      `✓ review inserted:  ${persisted.review.id} ` +
        `(${persisted.scores.length} persona_scores, verdict=${persisted.review.verdict})`,
    );

    const readBack = await getReviewById(db, review.review_id, company.id);
    if (!readBack) throw new Error("read-back returned null");
    console.log(
      `✓ review read back: ${readBack.review.id} ` +
        `(aggregate=${readBack.review.aggregate_score}, scores=${readBack.scores.length})`,
    );

    const list = await listReviewsByCompany(db, company.id);
    console.log(`✓ list by company:  ${list.length} review(s)`);

    console.log("\nDB smoke test PASSED.");
  } finally {
    // Best-effort cleanup — deleting the company cascades users/reviews/scores.
    if (companyId) {
      const { error } = await db.from("companies").delete().eq("id", companyId);
      if (error) console.warn(`cleanup: company delete failed: ${error.message}`);
    }
    if (authUserId) {
      const { error } = await db.auth.admin.deleteUser(authUserId);
      if (error) console.warn(`cleanup: auth user delete failed: ${error.message}`);
    }
    console.log("✓ cleanup complete");
  }
}

main().catch((err) => {
  console.error("DB smoke test FAILED:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
