/**
 * Long-form video ads — review pipeline (DailyPlan Day 86).
 *
 * The second video format, after short-form (Day 85). AdJury still stays a pure QA
 * layer — no content generation, no new juror, no second AI provider (Rules.md §1):
 * a long-form clip is *reduced* to the same thing the existing six jurors already
 * review (a representative keyframe + folded copy), exactly like short-form. What is
 * genuinely new is the **cost/latency strategy** the backlog called out: reviewing a
 * long clip the naive way — transcribe the whole thing, send many frames — breaks the
 * PRD §8 targets (<$0.01/review, <15s latency). So the pipeline bounds the reduction
 * before the fan-out ever runs:
 *
 *   raw clip ─► [sample plan] ─► [select ≤N keyframes] ─► VideoAnalysis ─► [reduce]
 *               chunk the        one per chunk, capped      bounded          keyframe +
 *               timeline         at a fixed budget          transcript       folded copy
 *                                                                               │
 *                                                                               ▼
 *                                                        the SAME six jurors (runReview)
 *
 * The invariant that keeps cost in budget: **the model fan-out is bounded
 * independent of clip length.** However long the clip, the review is exactly the six
 * jurors, each sent one representative keyframe and copy capped at the shared
 * `MAX_CONTENT_CHARS`. A 30-minute clip costs the same six-juror fan-out as a
 * one-minute one — the length is absorbed by the sampling/chunking *before* the model
 * is ever called, not by spending more per review. {@link planLongFormSampling} and
 * {@link selectKeyframes} make that strategy explicit and testable offline.
 *
 * This reuses the short-form building blocks directly (`assembleVideoCopy`,
 * `boundText`, the `VideoAnalysis` / `VideoKeyframe` shapes, the image size guard),
 * so the two pipelines can't drift in how they fold copy or bound payloads; only the
 * long-form-specific sampling/chunking + duration window live here.
 *
 * ── Live ingestion (needs credentials / infrastructure — owner action) ───────────
 * Exactly like short-form, the offline processor **invents nothing** (Rules.md §3
 * "grounded, not invented"): it reports only what the creative already carries and
 * reviews the advertiser's copy + a representative keyframe. A production processor
 * must pull candidate frames with ffmpeg at the planned timestamps, transcribe the
 * (chunked) audio, and OCR on-screen text; the public upload front door then needs
 * object storage + that server-side processing. None of that exists here, so
 * `video_long` is an engine format but stays out of `SUBMITTABLE_MEDIA_TYPES` — the
 * request boundary rejects a `video_long` POST until live ingestion ships
 * (`docs/LONG_FORM_VIDEO.md`), while the pipeline + its bounded composition with the
 * real jury are proven offline today.
 */
import { checkImageSize } from "@/lib/ai/cost";
import { runReview } from "@/lib/ai/orchestrator";
import type { ModelClient } from "@/lib/ai/client";
import type { PersonaWeights } from "@/lib/schema/weights";
import {
  ReviewInputSchema,
  type ReviewImage,
  type ReviewInput,
  type ReviewResult,
} from "@/lib/schema/juror";
import {
  SHORT_FORM_MAX_SECONDS,
  assembleVideoCopy,
  type VideoAnalysis,
  type VideoKeyframe,
} from "./short-form";

/**
 * Long-form begins exactly where short-form ends: anything longer than the
 * short-form ceiling (Day 85, {@link SHORT_FORM_MAX_SECONDS}). A clip at or below
 * that belongs to the short-form pipeline, so the two windows tile the timeline with
 * no gap and no overlap.
 */
export const LONG_FORM_MIN_SECONDS = SHORT_FORM_MAX_SECONDS + 1;

/**
 * The long-form ceiling. Thirty minutes is well beyond any real ad while still a
 * hard upper bound, so the guard loop and a live transcription pass are both bounded
 * (Rules.md §1/§6). Clips longer than this are rejected rather than silently
 * truncated.
 */
export const LONG_FORM_MAX_SECONDS = 30 * 60;

/**
 * The keyframe budget — the single most important cost lever. However long the clip,
 * the reduction samples **at most this many** keyframes (the live ffmpeg pass only
 * decodes these, and the first is the representative frame sent to every juror). Ten
 * frames characterise a long ad's arc (open → body → CTA) without the sampling cost
 * scaling with duration.
 */
export const LONG_FORM_MAX_KEYFRAMES = 10;

/**
 * Target seconds of clip per sampled keyframe. The sampling plan places one frame per
 * chunk of roughly this length, then caps the total at {@link LONG_FORM_MAX_KEYFRAMES}
 * — so a short long-form clip gets a frame every ~30s, and a very long one simply
 * spreads its budgeted frames wider. This is the "chunking" half of the strategy.
 */
export const LONG_FORM_CHUNK_SECONDS = 30;

/**
 * Upper bound on how many candidate frames a creative may carry into the guard. A
 * live ffmpeg pass at a fine interval over a 30-minute clip could hand over a lot of
 * frames; bounding the input keeps the guard O(1) and the request size sane
 * (Rules.md §6 input hardening). The selection then reduces candidates to
 * {@link LONG_FORM_MAX_KEYFRAMES} regardless.
 */
export const LONG_FORM_MAX_CANDIDATES = 2_000;

/**
 * A long-form video creative, as the live ingestion pipeline would hand it to the
 * engine. Unlike a short-form creative (which carries its already-small keyframe
 * set), a long-form creative carries the *candidate* frames a fine-grained ffmpeg
 * pass produced; the pipeline's sampling/chunking selects the bounded subset actually
 * reviewed. The raw video bytes never reach the engine — only this bounded,
 * already-sampled form does.
 */
export interface LongFormVideoCreative {
  /** Clip length in seconds (must be in the long-form window). */
  durationSeconds: number;
  /** Whether the clip carries an audio track a live pipeline would transcribe. */
  hasAudio: boolean;
  /**
   * Candidate frames a live ffmpeg pass sampled (ordered by time). May be many; the
   * pipeline selects a bounded, evenly distributed subset. At least one is required.
   */
  candidateKeyframes: VideoKeyframe[];
  /** The advertiser's accompanying copy — required, like every visual ad's copy. */
  caption: string;
  /** Content type (ad_copy | social_post | email | landing_page). */
  content_type: ReviewInput["content_type"];
  /** Target platform, or null. */
  platform: string | null;
}

/**
 * The timestamps (seconds into the clip) the sampling plan targets for keyframes —
 * one per chunk, capped at the keyframe budget. Pure and deterministic: a live ffmpeg
 * pass would decode a frame at each of these, and the offline selector picks the
 * nearest candidate to each.
 *
 * The count is `min(ceil(duration / LONG_FORM_CHUNK_SECONDS), LONG_FORM_MAX_KEYFRAMES)`,
 * so it is **bounded independent of duration**; the targets are the chunk centres, so
 * they are spread evenly across the whole clip.
 */
export function planLongFormSampling(durationSeconds: number): number[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];
  const byChunk = Math.ceil(durationSeconds / LONG_FORM_CHUNK_SECONDS);
  const count = Math.min(Math.max(1, byChunk), LONG_FORM_MAX_KEYFRAMES);
  const span = durationSeconds / count;
  const targets: number[] = [];
  for (let i = 0; i < count; i++) {
    // Chunk centre: evenly spaced, inside [0, duration).
    targets.push(Math.min(durationSeconds, (i + 0.5) * span));
  }
  return targets;
}

/**
 * Select the bounded set of keyframes actually reviewed from a creative's candidate
 * frames, applying the sampling plan: for each planned timestamp pick the nearest
 * unused candidate, preserving time order, never exceeding {@link LONG_FORM_MAX_KEYFRAMES}.
 * With few candidates it returns what exists (≤ candidates); with many it thins them
 * to the budget. This is where "cost independent of clip length" is realised.
 */
export function selectKeyframes(
  candidates: VideoKeyframe[],
  durationSeconds: number,
): VideoKeyframe[] {
  if (candidates.length === 0) return [];
  const ordered = [...candidates].sort((a, b) => a.atSeconds - b.atSeconds);
  const targets = planLongFormSampling(durationSeconds);
  if (targets.length === 0) return [ordered[0]];

  const usedIndices = new Set<number>();
  for (const target of targets) {
    if (usedIndices.size >= LONG_FORM_MAX_KEYFRAMES) break;
    let bestIndex = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < ordered.length; i++) {
      if (usedIndices.has(i)) continue;
      const distance = Math.abs(ordered[i].atSeconds - target);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    if (bestIndex >= 0) usedIndices.add(bestIndex);
  }

  return [...usedIndices]
    .sort((a, b) => a - b)
    .map((i) => ordered[i]);
}

/**
 * Turns a long-form clip into a {@link VideoAnalysis}. Injectable so the offline
 * default below can be swapped for an ffmpeg + transcription + OCR implementation
 * without touching the review path (mirroring the short-form seam).
 */
export interface LongFormVideoProcessor {
  analyze(creative: LongFormVideoCreative): VideoAnalysis;
}

/**
 * Deterministic, offline processor. Like its short-form sibling it does NOT reach the
 * network and does NOT invent speech or on-screen text (Rules.md §3): it applies the
 * sampling/chunking to the candidate frames, reports what the creative carries
 * (duration, selected keyframe count, whether audio is present), and leaves the
 * transcript / on-screen text empty for a live processor to fill. Reproducible: the
 * same creative always yields the same analysis.
 */
export const offlineLongFormVideoProcessor: LongFormVideoProcessor = {
  analyze(creative) {
    const selected = selectKeyframes(creative.candidateKeyframes, creative.durationSeconds);
    const representative: ReviewImage = {
      data_url: selected[0]?.data_url ?? "",
      mime_type: selected[0]?.mime_type ?? "",
    };
    return {
      durationSeconds: creative.durationSeconds,
      transcript: "",
      onScreenText: "",
      audioPresent: creative.hasAudio,
      keyframeCount: selected.length,
      representativeKeyframe: representative,
    };
  },
};

/** Why a long-form video creative was rejected before any model spend (Rules.md §6). */
export type LongFormCreativeRejection =
  | { code: "empty_caption"; message: string }
  | { code: "duration_out_of_range"; message: string; min: number; max: number; actual: number }
  | { code: "no_keyframes"; message: string }
  | { code: "too_many_candidates"; message: string; limit: number; actual: number }
  | { code: "keyframe_too_large"; message: string; index: number };

export type LongFormCreativeDecision =
  | { ok: true }
  | ({ ok: false } & LongFormCreativeRejection);

/**
 * Validate a long-form video creative at the boundary, before any processing or model
 * spend (Rules.md §6 — reject bad input with a specific, plain-language message; §1
 * cost discipline). Checks the long-form duration window (and sends a clip that is
 * really short-form to the right pipeline), that candidate frames exist and are
 * bounded in count, and each candidate's payload size (reusing the Day-15a image
 * guard, since the representative frame is sent to every juror as a vision block),
 * and that the advertiser copy is present.
 */
export function checkLongFormCreative(
  creative: LongFormVideoCreative,
): LongFormCreativeDecision {
  if (creative.caption.replace(/\s+/g, " ").trim().length === 0) {
    return {
      ok: false,
      code: "empty_caption",
      message: "Add the ad's copy (caption / headline / CTA) to review a long-form video.",
    };
  }
  const { durationSeconds } = creative;
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds < LONG_FORM_MIN_SECONDS ||
    durationSeconds > LONG_FORM_MAX_SECONDS
  ) {
    return {
      ok: false,
      code: "duration_out_of_range",
      message: `A long-form video must be between ${LONG_FORM_MIN_SECONDS} and ${LONG_FORM_MAX_SECONDS} seconds. Clips of ${SHORT_FORM_MAX_SECONDS}s or less are short-form video; longer clips aren't supported.`,
      min: LONG_FORM_MIN_SECONDS,
      max: LONG_FORM_MAX_SECONDS,
      actual: durationSeconds,
    };
  }
  if (creative.candidateKeyframes.length < 1) {
    return {
      ok: false,
      code: "no_keyframes",
      message: "At least one sampled keyframe is required to review a long-form video.",
    };
  }
  if (creative.candidateKeyframes.length > LONG_FORM_MAX_CANDIDATES) {
    return {
      ok: false,
      code: "too_many_candidates",
      message: `Too many candidate frames were sampled (max ${LONG_FORM_MAX_CANDIDATES}). Sample fewer frames and try again.`,
      limit: LONG_FORM_MAX_CANDIDATES,
      actual: creative.candidateKeyframes.length,
    };
  }
  for (let i = 0; i < creative.candidateKeyframes.length; i++) {
    if (!checkImageSize(creative.candidateKeyframes[i].data_url).ok) {
      return {
        ok: false,
        code: "keyframe_too_large",
        message: "A keyframe is too large. Please sample smaller frames and try again.",
        index: i,
      };
    }
  }
  return { ok: true };
}

/**
 * Reduce a processed long-form clip to a {@link ReviewInput} the existing orchestrator
 * accepts: a `video_long` ad whose image is the representative keyframe and whose copy
 * is the assembled caption/transcript/on-screen text (reusing the short-form
 * {@link assembleVideoCopy}, so the folding + content-budget cap are identical across
 * both video formats). Parsed through `ReviewInputSchema` so the media refinement (a
 * visual format requires an image) is enforced here too.
 */
export function buildLongFormReviewInput(
  analysis: VideoAnalysis,
  creative: LongFormVideoCreative,
  context: { brand_context?: string | null; business_context?: string | null } = {},
): ReviewInput {
  return ReviewInputSchema.parse({
    content_text: assembleVideoCopy(analysis, creative.caption),
    content_type: creative.content_type,
    platform: creative.platform,
    brand_context: context.brand_context ?? null,
    business_context: context.business_context ?? null,
    media_type: "video_long",
    image: analysis.representativeKeyframe,
  });
}

export type ReviewLongFormVideoResult =
  | { ok: true; review: ReviewResult; input: ReviewInput; analysis: VideoAnalysis }
  | ({ ok: false } & LongFormCreativeRejection);

/**
 * Review a long-form video end-to-end: guard → process (sample/chunk) → reduce → run
 * the SAME six jurors (`runReview`). Dependencies are injected (processor + model
 * client + weights) so this is fully exercisable offline — the default processor and
 * the offline mock model need no ffmpeg, network, or credential. The route-level
 * concerns (auth, tenancy, rate limit, persistence, brand/business-context
 * resolution) live in `createReview` and are not duplicated here; this is the engine
 * seam the live video front door will call once ingestion exists.
 */
export async function reviewLongFormVideo(
  creative: LongFormVideoCreative,
  deps: {
    processor?: LongFormVideoProcessor;
    client?: ModelClient;
    weights?: PersonaWeights;
    context?: { brand_context?: string | null; business_context?: string | null };
  } = {},
): Promise<ReviewLongFormVideoResult> {
  const decision = checkLongFormCreative(creative);
  if (!decision.ok) return decision;

  const processor = deps.processor ?? offlineLongFormVideoProcessor;
  const analysis = processor.analyze(creative);
  const input = buildLongFormReviewInput(analysis, creative, deps.context ?? {});
  const review = await runReview(input, { client: deps.client, weights: deps.weights });
  return { ok: true, review, input, analysis };
}
