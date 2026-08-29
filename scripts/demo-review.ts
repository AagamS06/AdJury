/**
 * Phase 1 end-to-end demo (Phases.md, Phase 1 acceptance):
 *   sample ad copy  ->  all 5 jurors  ->  structured JSON in the console.
 *
 * Runs in offline MOCK mode unless AI_API_KEY is set. To use a real model:
 *   AI_API_KEY=sk-... AI_MODEL=claude-haiku-4-5 npm run demo
 * (Node can also load a file: `node --env-file=.env.local ...`.)
 */
import { runReview } from "@/lib/ai/orchestrator";
import { ReviewInputSchema } from "@/lib/schema/juror";

async function main() {
  const input = ReviewInputSchema.parse({
    content_type: "ad_copy",
    platform: "instagram",
    brand_context:
      "Tone: measured, expert, trustworthy. Avoid hype and absolute claims.",
    content_text:
      "Introducing our new sleep supplement — guaranteed to cure insomnia in 3 days, 100% risk-free!",
  });

  const review = await runReview(input);

  console.log("\n=== AdJury review ===");
  console.log(`model:      ${review.model}`);
  console.log(`aggregate:  ${review.aggregate_score}/10`);
  console.log(`verdict:    ${review.verdict.toUpperCase()}\n`);
  console.log(JSON.stringify(review, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
