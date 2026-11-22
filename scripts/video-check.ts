/**
 * Short-form video review check (DailyPlan Day 85).
 *
 * "Short-form video ads — a media pipeline: transcribe audio + sample keyframes
 *  (as images) + read on-image text, then run the existing jurors."
 *
 * Offline-first, exactly like `deploy-smoke.ts` / `demo-script-check.ts`: it builds
 * a representative short-form creative, reduces it through the pipeline, runs it
 * through the REAL six jurors under the offline mock, and prints the analysis, the
 * reduced review input, the resulting scorecard summary, and the readiness report —
 * then exits 0. It fabricates nothing (no ffmpeg, transcription, or network). It
 * exits non-zero only on real drift (the reconcile fails) or if the offline review
 * somehow returns no juror.
 *
 *   npm run video:check
 */
import { getModelClient } from "@/lib/ai/client";
import { reviewShortFormVideo } from "@/lib/video/short-form";
import {
  buildShortFormVideoReadiness,
  reconcileShortFormVideo,
  sampleShortFormCreative,
} from "@/lib/video/short-form-readiness";

async function main(): Promise<void> {
  const creative = sampleShortFormCreative();

  console.log("── AdJury short-form video review ───────────────────────────────────");
  console.log(
    `Clip: ${creative.durationSeconds}s · ${creative.keyframes.length} keyframe(s) · audio: ${creative.hasAudio ? "yes" : "no"} · ${creative.content_type} · ${creative.platform ?? "unspecified"}`,
  );
  console.log(`Caption: ${creative.caption}\n`);

  const result = await reviewShortFormVideo(creative, { client: getModelClient() });
  if (!result.ok) {
    console.error("short-form review rejected:", result.code, "—", result.message);
    process.exitCode = 1;
    return;
  }

  const { analysis, input, review } = result;
  console.log("Analysis (offline processor):");
  console.log(`  transcript:     ${analysis.transcript || "(none — live transcription pending)"}`);
  console.log(`  on-screen text: ${analysis.onScreenText || "(none — live OCR pending)"}`);
  console.log(`  keyframes:      ${analysis.keyframeCount} · audio present: ${analysis.audioPresent}\n`);

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

  const readiness = buildShortFormVideoReadiness(creative);
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
  console.log("Full pipeline + blockers: docs/VIDEO_REVIEW.md");
  console.log("─────────────────────────────────────────────────────────────────────");

  const reconcile = reconcileShortFormVideo(creative);
  if (!reconcile.clean) {
    console.error("\nshort-form video reconcile FAILED:", JSON.stringify(reconcile, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log("\nShort-form video runs through all six jurors offline and agrees with the engine contract.");
}

void main();
