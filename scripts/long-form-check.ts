/**
 * Long-form video review check (DailyPlan Day 86).
 *
 * "Long-form video ads — the same pipeline at scale; needs a cost/latency strategy
 *  (sampling, chunking)."
 *
 * Offline-first, exactly like `video-check.ts` (short-form): it builds a
 * representative long-form creative, reduces it through the pipeline (sampling +
 * chunking), runs it through the REAL six jurors under the offline mock, and prints
 * the sampling plan, the analysis, the reduced review input, the scorecard, the
 * cost-bound evidence (a 30-minute clip reduces to the same fan-out), and the
 * readiness report — then exits 0. It fabricates nothing (no ffmpeg, transcription,
 * or network). It exits non-zero only on real drift (the reconcile fails) or if the
 * offline review somehow returns no juror.
 *
 *   npm run video:check:long
 */
import { getModelClient } from "@/lib/ai/client";
import { estimateReviewUsage } from "@/lib/ai/cost";
import { PERSONAS } from "@/lib/ai/personas";
import {
  buildLongFormReviewInput,
  offlineLongFormVideoProcessor,
  planLongFormSampling,
  reviewLongFormVideo,
} from "@/lib/video/long-form";
import {
  buildLongFormVideoReadiness,
  reconcileLongFormVideo,
  sampleLongFormCreative,
  sampleMaxLengthCreative,
} from "@/lib/video/long-form-readiness";

async function main(): Promise<void> {
  const creative = sampleLongFormCreative();
  const plan = planLongFormSampling(creative.durationSeconds);

  console.log("── AdJury long-form video review ────────────────────────────────────");
  console.log(
    `Clip: ${creative.durationSeconds}s · ${creative.candidateKeyframes.length} candidate frame(s) · audio: ${creative.hasAudio ? "yes" : "no"} · ${creative.content_type} · ${creative.platform ?? "unspecified"}`,
  );
  console.log(`Caption: ${creative.caption}`);
  console.log(
    `Sampling plan: ${plan.length} keyframe(s) at ~${plan.map((t) => `${Math.round(t)}s`).join(", ")}\n`,
  );

  const result = await reviewLongFormVideo(creative, { client: getModelClient() });
  if (!result.ok) {
    console.error("long-form review rejected:", result.code, "—", result.message);
    process.exitCode = 1;
    return;
  }

  const { analysis, input, review } = result;
  console.log("Analysis (offline processor):");
  console.log(`  transcript:     ${analysis.transcript || "(none — live transcription pending)"}`);
  console.log(`  on-screen text: ${analysis.onScreenText || "(none — live OCR pending)"}`);
  console.log(`  keyframes kept: ${analysis.keyframeCount} · audio present: ${analysis.audioPresent}\n`);

  console.log("Reduced review input (what the jurors see):");
  console.log(`  media_type: ${input.media_type} · keyframe attached: ${input.image ? "yes" : "no"}`);
  console.log(`  copy: ${input.content_text}\n`);

  console.log(`Scorecard: ${review.verdict.toUpperCase()} · aggregate ${review.aggregate_score}/10 · model ${review.model}`);
  for (const juror of review.jurors) {
    const score = juror.status === "ok" ? `${juror.score}/10` : "error";
    console.log(`  • ${juror.persona.padEnd(26)} ${score}`);
  }
  console.log("");

  const okCount = review.jurors.filter((j) => j.status === "ok").length;
  if (okCount === 0) {
    console.error("No juror returned a result — the offline review should never be empty.");
    process.exitCode = 1;
    return;
  }

  // Cost-bound evidence: a 30-minute clip reduces to the SAME six-juror fan-out.
  const maxCreative = sampleMaxLengthCreative();
  const thisUsage = estimateReviewUsage(input.content_text, PERSONAS.length);
  const maxUsage = estimateReviewUsage(
    buildLongFormReviewInput(
      offlineLongFormVideoProcessor.analyze(maxCreative),
      maxCreative,
    ).content_text,
    PERSONAS.length,
  );
  console.log("Cost bound (reduction is independent of clip length):");
  console.log(
    `  this clip (${creative.durationSeconds}s):  jurors ${thisUsage.jurorCount} · ~input ${thisUsage.estimatedInputTokens} tok · max output ${thisUsage.maxOutputTokens} tok`,
  );
  console.log(
    `  max clip (${maxCreative.durationSeconds}s): jurors ${maxUsage.jurorCount} · ~input ${maxUsage.estimatedInputTokens} tok · max output ${maxUsage.maxOutputTokens} tok`,
  );
  console.log(
    `  → fan-out identical: ${thisUsage.jurorCount === maxUsage.jurorCount && thisUsage.maxOutputTokens === maxUsage.maxOutputTokens ? "yes" : "NO"}\n`,
  );

  const readiness = buildLongFormVideoReadiness(creative);
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
  console.log("Full pipeline + blockers: docs/LONG_FORM_VIDEO.md");
  console.log("─────────────────────────────────────────────────────────────────────");

  const reconcile = reconcileLongFormVideo(creative);
  if (!reconcile.clean) {
    console.error("\nlong-form video reconcile FAILED:", JSON.stringify(reconcile, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log("\nLong-form video runs through all six jurors offline at a clip-length-independent cost.");
}

void main();
