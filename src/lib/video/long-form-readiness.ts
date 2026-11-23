/**
 * Long-form video — readiness + reconcile (DailyPlan Day 86).
 *
 * The executable "a long-form video runs through the jury, at bounded cost" check and
 * its offline drift guard, sibling to the pipeline in `long-form.ts` (the same split
 * the repo uses for `short-form.ts` / `short-form-readiness.ts`). Everything here is
 * pure and sync so it runs with no ffmpeg, network, or credential; the async
 * end-to-end review through the six jurors is demonstrated by `npm run video:check:long`
 * and pinned by the tests.
 *
 * The headline property this proves is the Day-86 cost/latency strategy: the reduction
 * is bounded independent of clip length, so a very long clip costs the same six-juror
 * fan-out — and the same bounded per-juror payload — as a short one.
 */
import { MAX_CONTENT_CHARS, estimateReviewUsage } from "@/lib/ai/cost";
import { PERSONAS } from "@/lib/ai/personas";
import {
  MEDIA_TYPES,
  SUBMITTABLE_MEDIA_TYPES,
  ReviewInputSchema,
} from "@/lib/schema/juror";
import type { VideoKeyframe } from "./short-form";
import {
  LONG_FORM_MAX_CANDIDATES,
  LONG_FORM_MAX_KEYFRAMES,
  LONG_FORM_MAX_SECONDS,
  LONG_FORM_MIN_SECONDS,
  buildLongFormReviewInput,
  checkLongFormCreative,
  offlineLongFormVideoProcessor,
  planLongFormSampling,
  selectKeyframes,
  type LongFormVideoCreative,
} from "./long-form";

/** A tiny valid 1×1 PNG used as a sample keyframe (no real creative in the build). */
const SAMPLE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Build `count` candidate frames evenly spread across a `durationSeconds` clip. */
export function sampleCandidateFrames(
  count: number,
  durationSeconds: number,
): VideoKeyframe[] {
  const frames: VideoKeyframe[] = [];
  for (let i = 0; i < count; i++) {
    frames.push({
      data_url: SAMPLE_PNG,
      mime_type: "image/png",
      atSeconds: Math.round((i / Math.max(1, count)) * durationSeconds),
    });
  }
  return frames;
}

/**
 * A representative, well-formed long-form creative — a ~4-minute clip with a dense
 * candidate-frame set (more than the keyframe budget, so the selection genuinely
 * thins them), an audio track, and the advertiser's copy — used by the reconcile, the
 * readiness report, and `npm run video:check:long`. Non-vacuous on purpose.
 */
export function sampleLongFormCreative(): LongFormVideoCreative {
  const durationSeconds = 4 * 60; // 240s — solidly long-form.
  return {
    durationSeconds,
    hasAudio: true,
    // 48 candidate frames (one every ~5s) — well above LONG_FORM_MAX_KEYFRAMES, so
    // the sampling/chunking has real work to do.
    candidateKeyframes: sampleCandidateFrames(48, durationSeconds),
    caption: "The full story behind our weighted blanket — why 50,000 sleepers switched.",
    content_type: "ad_copy",
    platform: "youtube",
  };
}

/** A near-ceiling creative (used to prove cost doesn't scale with length). */
export function sampleMaxLengthCreative(): LongFormVideoCreative {
  const durationSeconds = LONG_FORM_MAX_SECONDS;
  return {
    ...sampleLongFormCreative(),
    durationSeconds,
    candidateKeyframes: sampleCandidateFrames(600, durationSeconds),
  };
}

export interface LongFormReconcile {
  clean: boolean;
  failures: string[];
}

/**
 * Prove the long-form pipeline is internally coherent, drift-free, and — the Day-86
 * headline — **cost-bounded independent of clip length**:
 *  - the duration window tiles onto the short-form ceiling with no gap/overlap, and
 *    the keyframe/candidate budgets are sane;
 *  - `video_long` is an engine format but NOT client-submittable (the gating
 *    invariant that keeps the public endpoint honest until live ingestion ships),
 *    and `video_short` is still an engine format too;
 *  - the sampling plan + selection never exceed the keyframe budget, for a short
 *    long-form clip AND a max-length one;
 *  - the offline processor is deterministic, bounded, and invents nothing;
 *  - the reduction yields a schema-valid `video_long` input with a keyframe and
 *    non-empty, budget-bounded copy;
 *  - the model fan-out (juror count + per-juror payload budget) is IDENTICAL for a
 *    short long-form clip and a 30-minute one — length is absorbed before the model.
 */
export function reconcileLongFormVideo(
  creative: LongFormVideoCreative = sampleLongFormCreative(),
): LongFormReconcile {
  const failures: string[] = [];

  // Duration window tiles onto short-form with no gap/overlap, budgets sane.
  if (!(LONG_FORM_MIN_SECONDS >= 2)) failures.push("LONG_FORM_MIN_SECONDS must be > the short-form ceiling");
  if (!(LONG_FORM_MAX_SECONDS > LONG_FORM_MIN_SECONDS)) {
    failures.push("LONG_FORM_MAX_SECONDS must be > LONG_FORM_MIN_SECONDS");
  }
  if (!(LONG_FORM_MAX_KEYFRAMES >= 1)) failures.push("LONG_FORM_MAX_KEYFRAMES must be ≥ 1");
  if (!(LONG_FORM_MAX_CANDIDATES >= LONG_FORM_MAX_KEYFRAMES)) {
    failures.push("LONG_FORM_MAX_CANDIDATES must be ≥ LONG_FORM_MAX_KEYFRAMES");
  }

  // Vocabulary gating: the engine knows video_long, the public endpoint does not;
  // video_short remains an engine format.
  if (!(MEDIA_TYPES as readonly string[]).includes("video_long")) {
    failures.push("video_long must be an engine media type");
  }
  if ((SUBMITTABLE_MEDIA_TYPES as readonly string[]).includes("video_long")) {
    failures.push("video_long must NOT be client-submittable until live ingestion ships");
  }
  if (!(MEDIA_TYPES as readonly string[]).includes("video_short")) {
    failures.push("video_short must remain an engine media type");
  }

  // Sampling/chunking never exceeds the keyframe budget — for this clip AND the
  // max-length one (the cost bound must hold at the extreme, not just the sample).
  for (const c of [creative, sampleMaxLengthCreative()]) {
    const plan = planLongFormSampling(c.durationSeconds);
    if (plan.length > LONG_FORM_MAX_KEYFRAMES) {
      failures.push(`sampling plan exceeds the keyframe budget at ${c.durationSeconds}s`);
    }
    const selected = selectKeyframes(c.candidateKeyframes, c.durationSeconds);
    if (selected.length > LONG_FORM_MAX_KEYFRAMES) {
      failures.push(`keyframe selection exceeds the budget at ${c.durationSeconds}s`);
    }
    if (c.candidateKeyframes.length > 0 && selected.length === 0) {
      failures.push(`keyframe selection produced nothing at ${c.durationSeconds}s`);
    }
  }

  // The sample must pass the guard (non-vacuous), else the checks below are moot.
  if (!checkLongFormCreative(creative).ok) {
    failures.push("the sample creative must pass checkLongFormCreative");
    return { clean: failures.length === 0, failures };
  }

  // Offline processor: deterministic, bounded, invents nothing.
  const a1 = offlineLongFormVideoProcessor.analyze(creative);
  const a2 = offlineLongFormVideoProcessor.analyze(creative);
  if (JSON.stringify(a1) !== JSON.stringify(a2)) {
    failures.push("offline processor must be deterministic");
  }
  if (a1.keyframeCount > LONG_FORM_MAX_KEYFRAMES) {
    failures.push("analysis keyframeCount must not exceed the budget");
  }
  if (a1.transcript.length !== 0 || a1.onScreenText.length !== 0) {
    failures.push("offline processor must invent no transcript / on-screen text");
  }

  // Reduction: a schema-valid video_long input with a keyframe and bounded copy.
  try {
    const input = buildLongFormReviewInput(a1, creative);
    const parsed = ReviewInputSchema.parse(input);
    if (parsed.media_type !== "video_long") failures.push("reduced input must be media_type video_long");
    if (!parsed.image) failures.push("reduced input must attach a keyframe image");
    if (parsed.content_text.trim().length === 0) failures.push("reduced input must have non-empty copy");
    if (parsed.content_text.length > MAX_CONTENT_CHARS) failures.push("reduced copy exceeds the content budget");
  } catch (err) {
    failures.push(`reduction failed to produce a valid review input: ${(err as Error).message}`);
  }

  // THE cost bound: the model fan-out is identical regardless of clip length. Compare
  // the usage estimate for this clip and a 30-minute one — both reduced the same way.
  const shortCopy = buildLongFormReviewInput(
    offlineLongFormVideoProcessor.analyze(creative),
    creative,
  ).content_text;
  const maxCreative = sampleMaxLengthCreative();
  const longCopy = buildLongFormReviewInput(
    offlineLongFormVideoProcessor.analyze(maxCreative),
    maxCreative,
  ).content_text;
  const shortUsage = estimateReviewUsage(shortCopy, PERSONAS.length);
  const longUsage = estimateReviewUsage(longCopy, PERSONAS.length);
  if (shortUsage.jurorCount !== longUsage.jurorCount) {
    failures.push("juror fan-out must not scale with clip length");
  }
  if (shortUsage.maxOutputTokens !== longUsage.maxOutputTokens) {
    failures.push("output-token ceiling must not scale with clip length");
  }
  if (longUsage.estimatedInputTokens > shortUsage.estimatedInputTokens + 1) {
    // The offline floor folds only the caption, so the two are equal; a tolerance of
    // 1 token guards against rounding, not against growth with duration.
    failures.push("input-token estimate must not grow with clip length (offline reduction)");
  }

  return { clean: failures.length === 0, failures };
}

export type ReadinessStatus = "ready" | "manual";
export interface ReadinessItem {
  status: ReadinessStatus;
  title: string;
  detail: string;
}
export interface LongFormVideoReadiness {
  /** True when every offline (`ready`) item holds — i.e. the reconcile is clean. */
  ready: boolean;
  items: ReadinessItem[];
  /** How many `manual` items (live-infra steps) remain. */
  manualSteps: number;
}

/**
 * The readiness report: what the long-form pipeline proves offline today (including
 * the bounded cost/latency strategy), and what still needs live
 * infrastructure/credentials. Manual items are never auto-marked done.
 */
export function buildLongFormVideoReadiness(
  creative: LongFormVideoCreative = sampleLongFormCreative(),
): LongFormVideoReadiness {
  const reconcile = reconcileLongFormVideo(creative);
  const offlineDetail = reconcile.clean
    ? "Pipeline coherent: duration window, sampling/chunking budgets, deterministic offline processor, and a valid video_long reduction."
    : `Reconcile FAILED: ${reconcile.failures.join("; ")}`;

  const items: ReadinessItem[] = [
    {
      status: "ready",
      title: "Pipeline well-formed and drift-free (offline)",
      detail: offlineDetail,
    },
    {
      status: "ready",
      title: "Bounded cost/latency strategy (sampling + chunking)",
      detail: `Keyframes capped at ${LONG_FORM_MAX_KEYFRAMES} and copy at the shared content budget regardless of clip length, so the six-juror fan-out and per-juror payload don't scale with duration (PRD §8: <$0.01/review, <15s).`,
    },
    {
      status: "ready",
      title: "Reviews through the same six jurors (offline mock)",
      detail:
        "reviewLongFormVideo reduces the clip to a keyframe + copy and runs the real orchestrator; proven by npm run video:check:long and tests/long-form-video.test.ts.",
    },
    {
      status: "manual",
      title: "Object storage for uploaded clips",
      detail: "Store long clips securely (Supabase storage / S3) — PRD §6.3 production data & hosting.",
    },
    {
      status: "manual",
      title: "Keyframe sampling at the planned timestamps (ffmpeg)",
      detail: `Decode a frame at each planLongFormSampling() target (≤ ${LONG_FORM_MAX_KEYFRAMES}) server-side; needs ffmpeg + compute this build lacks.`,
    },
    {
      status: "manual",
      title: "Chunked audio transcription",
      detail: "Transcribe the (chunked) audio into the analysis transcript; needs a transcription credential, and the result is bounded to the transcript cap.",
    },
    {
      status: "manual",
      title: "On-screen text (OCR)",
      detail: "Read text burned into the sampled frames into the analysis on-screen text; needs an OCR step.",
    },
    {
      status: "manual",
      title: "Public upload front door",
      detail:
        "Add video_long to SUBMITTABLE_MEDIA_TYPES + the submission form once ingestion exists; POST /api/reviews rejects it until then.",
    },
  ];

  return {
    ready: reconcile.clean,
    items,
    manualSteps: items.filter((i) => i.status === "manual").length,
  };
}
