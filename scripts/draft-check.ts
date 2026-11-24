/**
 * Draft Assistant check (DailyPlan Day 87).
 *
 * "Draft Assistant (ad generation) — an optional, clearly-separate mode that
 *  drafts ad copy on request, distinct from the jury so AdJury never grades its
 *  own output."
 *
 * Offline-first, exactly like `video-check.ts` / `demo-script-check.ts`: it runs a
 * representative brief through the REAL offline generator, prints the drafts, and
 * reports readiness — including the executable proof that the generator core is
 * separate from the jury (it imports neither the orchestrator nor any persona).
 * It fabricates nothing and needs no key. It exits non-zero only on real drift
 * (the reconcile fails, or the core has become coupled to the jury).
 *
 *   npm run draft:check
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateDrafts } from "@/lib/draft/draft-assistant";
import {
  buildDraftAssistantReadiness,
  findJuryImports,
  reconcileDraftAssistant,
  sampleDraftBrief,
} from "@/lib/draft/draft-assistant-readiness";

const CORE_PATH = fileURLToPath(new URL("../src/lib/draft/draft-assistant.ts", import.meta.url));

async function main(): Promise<void> {
  const brief = sampleDraftBrief();
  const coreSource = readFileSync(CORE_PATH, "utf8");

  console.log("── AdJury Draft Assistant (offline) ─────────────────────────────────");
  console.log(
    `Brief: ${brief.product} · for ${brief.audience} · ${brief.tone} · ${brief.content_type} · ${brief.platform ?? "unspecified"}`,
  );
  console.log(`Key message: ${brief.keyMessage}`);
  console.log(
    `Must include: ${brief.mustInclude.join("; ") || "(none)"} · Must avoid: ${brief.mustAvoid.join("; ") || "(none)"}\n`,
  );

  const generated = await generateDrafts(brief);
  if (!generated.ok) {
    console.error("draft brief rejected:", generated.code, "—", generated.message);
    process.exitCode = 1;
    return;
  }

  const { result } = generated;
  console.log(`Generator: ${result.generator}`);
  for (const draft of result.drafts) {
    console.log(`\n  ${draft.variantLabel} (${draft.angle})`);
    console.log(`    Headline: ${draft.headline}`);
    console.log(`    Body:     ${draft.body}`);
    console.log(`    CTA:      ${draft.cta}`);
  }
  console.log(`\n${result.disclaimer}\n`);

  const readiness = buildDraftAssistantReadiness(coreSource, brief);
  console.log("Readiness:");
  for (const item of readiness.items) {
    const mark = item.status === "ready" ? "✓ READY " : "• MANUAL";
    console.log(`  ${mark}  ${item.title}`);
    console.log(`            ${item.detail}`);
  }
  console.log("");
  console.log(
    `Offline checks: ${readiness.ready ? "PASS" : "FAIL"} · manual steps remaining: ${readiness.manualSteps}`,
  );
  console.log("Full guide + blockers: docs/DRAFT_ASSISTANT.md");
  console.log("─────────────────────────────────────────────────────────────────────");

  const reconcile = reconcileDraftAssistant(brief);
  const juryImports = findJuryImports(coreSource);
  if (!reconcile.clean || juryImports.length > 0) {
    console.error("\nDraft Assistant reconcile FAILED:");
    if (!reconcile.clean) console.error("  reconcile:", JSON.stringify(reconcile.failures, null, 2));
    if (juryImports.length > 0) console.error("  jury coupling:", juryImports.join(", "));
    process.exitCode = 1;
    return;
  }
  console.log("\nDraft Assistant drafts honest copy offline and stays fully separate from the jury.");
}

void main();
