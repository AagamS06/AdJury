/**
 * Live business research check (DailyPlan Day 88).
 *
 * "Swap the offline business-context researcher for a web-search-backed one
 *  (Claude web_search over the company's site), behind the existing
 *  BusinessResearcher seam."
 *
 * Offline-first, exactly like `video-check.ts` / `draft-check.ts`: it researches a
 * representative business through the real seam, prints the summary + how it was
 * sourced, and reports readiness. With no `AI_API_KEY` the model client is the
 * offline mock, so `researchBusinessContext` falls back to the deterministic
 * offline summary (source: "offline") and nothing is fabricated; with a live key
 * it runs one real web-search pass (source: "live"). It exits non-zero only on
 * real drift (the reconcile fails).
 *
 *   npm run research:check
 */
import { getModelClient } from "@/lib/ai/client";
import {
  researchBusinessContext,
  resolveLiveBusinessResearcher,
} from "@/lib/company/business-context";
import {
  buildBusinessResearchReadiness,
  reconcileBusinessResearch,
  sampleBusinessIdentity,
} from "@/lib/company/business-research-readiness";

async function main(): Promise<void> {
  const identity = sampleBusinessIdentity();
  const client = getModelClient();
  const live = resolveLiveBusinessResearcher(client);

  console.log("── AdJury live business research (offline-first) ────────────────────");
  console.log(
    `Business: ${identity.name} · ${identity.industry ?? "(no industry)"} · ${identity.websiteUrl ?? "(no site)"}`,
  );
  console.log(`Model client: ${client.isMock ? "offline mock (no AI_API_KEY)" : `live (${client.model})`}\n`);

  const result = await researchBusinessContext(identity, live);
  console.log(`Source: ${result.source}`);
  console.log(`Summary: ${result.summary ?? "(none)"}`);
  console.log(`Cache ref: ${result.contextRef ?? "(none)"}\n`);

  const readiness = buildBusinessResearchReadiness(client, identity);
  console.log("Readiness:");
  for (const item of readiness.items) {
    const mark = item.status === "ready" ? "✓ READY " : "• MANUAL";
    console.log(`  ${mark}  ${item.title}`);
    console.log(`            ${item.detail}`);
  }
  console.log("");
  console.log(
    `Offline checks: ${readiness.ready ? "PASS" : "FAIL"} · live configured: ${readiness.liveConfigured} · manual steps remaining: ${readiness.manualSteps}`,
  );
  console.log("Full guide + blockers: docs/BUSINESS_RESEARCH.md");
  console.log("─────────────────────────────────────────────────────────────────────");

  const reconcile = reconcileBusinessResearch(identity);
  if (!reconcile.clean) {
    console.error("\nBusiness research reconcile FAILED:");
    console.error("  " + JSON.stringify(reconcile.failures, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log("\nBusiness research is grounded offline and the live web-search seam is wired honestly.");
}

void main();
