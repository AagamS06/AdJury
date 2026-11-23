/**
 * Short-form video ads — review pipeline (DailyPlan Day 85).
 *
 * AdJury reviews ads in more than one format so it reaches the widest set of
 * advertisers (PRD §4/§6). Day 15a added image ads; this adds **short-form video**
 * (PRD §6.3: "short-form then long-form (audio transcription + keyframe sampling +
 * on-image text)"). The engine stays a pure QA layer — no content generation, no
 * new juror, no second AI provider (Rules.md §1): a short-form clip is *reduced* to
 * something the existing six jurors already review, then run through them unchanged.
 *
 *   raw clip ─► [processor] ─► VideoAnalysis ─► [reduce] ─► ReviewInput ─► runReview
 *               transcribe     transcript +      keyframe +    the SAME six jurors
 *               sample frames  on-screen text +  folded copy   (Day 85 just reaches
 *               read on-image  keyframes                        them with a video)
 *
 * This mirrors two established patterns exactly:
 *  - Day 15a multi-format input — a visual ad is a keyframe + copy sent to every
 *    juror as a vision block; a `video_short` ad reuses that path with a
 *    representative keyframe (`src/lib/schema/juror.ts`, `src/lib/ai/orchestrator.ts`).
 *  - Day 23a's injectable researcher seam — a {@link ShortFormVideoProcessor} with a
 *    pure, deterministic, **offline** default that needs no ffmpeg/transcription/
 *    network/credential, so the whole pipeline is free, reproducible, and fully
 *    unit-testable in this cloud build. A production processor swaps in behind the
 *    same interface without touching the review path.
 *
 * ── Live ingestion (needs credentials / infrastructure — owner action) ───────────
 * The offline processor does NOT invent spoken words or on-screen text — it only
 * states what the creative already carries (duration, sampled keyframes, whether an
 * audio track is present) and reviews the advertiser's accompanying copy + a
 * keyframe, exactly as the offline business researcher states knowns without
 * fabricating (Rules.md §3 "grounded, not invented"). To ground a review in what the
 * clip actually says, a production processor must: pull keyframes with ffmpeg,
 * transcribe the audio, and OCR on-screen text — then the *public upload front door*
 * needs object storage for the clip plus that server-side processing. None of that
 * exists here, so it is left as a documented seam: `SUBMITTABLE_MEDIA_TYPES` keeps
 * `video_short` out of `POST /api/reviews` until it ships (`docs/VIDEO_REVIEW.md`),
 * while the pipeline + its composition with the real jury are proven offline today.
 */
import { MAX_CONTENT_CHARS, checkImageSize } from "@/lib/ai/cost";
import { runReview } from "@/lib/ai/orchestrator";
import type { ModelClient } from "@/lib/ai/client";
import type { PersonaWeights } from "@/lib/schema/weights";
import {
  ReviewInputSchema,
  type ReviewImage,
  type ReviewInput,
  type ReviewResult,
} from "@/lib/schema/juror";

/**
 * The short-form ceiling. "Short-form" is the up-to-a-minute clip (Reels / TikTok
 * / Shorts); anything longer is long-form (`video_long`, a later phase that needs a
 * sampling/chunking cost strategy — PRD §6.3). Capping duration here bounds how much
 * a live pipeline would transcribe/sample, keeping cost per review in budget
 * (Rules.md §1; PRD §8 <$0.01/review, <15s latency).
 */
export const SHORT_FORM_MAX_SECONDS = 60;

/** A clip must have some positive duration to be a video at all. */
export const SHORT_FORM_MIN_SECONDS = 1;

/**
 * Keyframe sampling bounds. At least one frame (the representative keyframe sent to
 * the jurors as the vision block); at most a handful, because every extra frame a
 * live pipeline samples costs decode time and the image is sent to every juror
 * (Rules.md §1 cost discipline). Six keyframes over a ≤60s clip is roughly one every
 * ten seconds — enough to characterise a short ad without ballooning cost.
 */
export const MIN_KEYFRAMES = 1;
export const MAX_KEYFRAMES = 6;

/** Caps on the reduced analysis text, so the folded copy stays within the content budget. */
export const MAX_TRANSCRIPT_CHARS = 4_000;
export const MAX_ONSCREEN_TEXT_CHARS = 1_000;

/** A sampled frame from the clip: an image (the Day-15a vision contract) plus when it was taken. */
export interface VideoKeyframe extends ReviewImage {
  /** Seconds into the clip this frame was sampled at (≥ 0). */
  atSeconds: number;
}

/**
 * A short-form video creative, as the live ingestion pipeline would hand it to the
 * engine: the clip's duration, the frames sampled from it, whether it has an audio
 * track, and the advertiser's accompanying copy (caption / headline / CTA) — the
 * same required copy an image ad carries (Day 15a). The raw video bytes never reach
 * the engine; only this bounded, already-sampled form does.
 */
export interface ShortFormVideoCreative {
  /** Clip length in seconds. */
  durationSeconds: number;
  /** Whether the clip carries an audio track a live pipeline would transcribe. */
  hasAudio: boolean;
  /** Frames sampled from the clip (ordered by time); the first is the representative keyframe. */
  keyframes: VideoKeyframe[];
  /** The advertiser's accompanying copy — required, like an image ad's copy. */
  caption: string;
  /** Content type (ad_copy | social_post | email | landing_page). */
  content_type: ReviewInput["content_type"];
  /** Target platform, or null. */
  platform: string | null;
}

/**
 * What a processor extracts from a clip for the jurors to review. The transcript and
 * on-screen text are the clip's own words; the representative keyframe is the frame
 * attached as the vision block.
 */
export interface VideoAnalysis {
  durationSeconds: number;
  /** Spoken-word transcript (bounded). Empty when there is no audio / none was transcribed. */
  transcript: string;
  /** Text read off the frames (bounded). Empty when none was detected. */
  onScreenText: string;
  /** Whether the clip has an audio track (observable without transcribing it). */
  audioPresent: boolean;
  /** How many frames were sampled. */
  keyframeCount: number;
  /** The frame sent to every juror as the vision block. */
  representativeKeyframe: ReviewImage;
}

/**
 * Turns a clip into a {@link VideoAnalysis}. Injectable so the offline default below
 * can be swapped for an ffmpeg + transcription + OCR implementation without touching
 * the review path (exactly how the live model client swaps in behind the offline
 * mock in `lib/ai/client.ts`).
 */
export interface ShortFormVideoProcessor {
  analyze(creative: ShortFormVideoCreative): VideoAnalysis;
}

/** Collapse whitespace runs to single spaces and trim. */
function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Trim `text` to at most `max` characters at a word boundary, with an ellipsis. */
export function boundText(text: string, max: number): string {
  const normalized = normalize(text);
  if (normalized.length <= max) return normalized;
  const ellipsis = "…";
  const budget = Math.max(0, max - ellipsis.length);
  const slice = normalized.slice(0, budget);
  const lastSpace = slice.lastIndexOf(" ");
  const head = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return `${head.trimEnd()}${ellipsis}`;
}

/**
 * Deterministic, offline processor. It does NOT reach the network and does NOT
 * invent speech or on-screen text (Rules.md §3 "grounded, not invented"): it reports
 * only what the creative already carries. Transcript and on-screen text are left
 * empty — the honest offline floor reviews the advertiser's copy + the representative
 * keyframe, and a live processor (ffmpeg + transcription + OCR) fills them in behind
 * this same interface. Reproducible: the same creative always yields the same
 * analysis, so demos and tests are meaningful without a paid key.
 */
export const offlineShortFormVideoProcessor: ShortFormVideoProcessor = {
  analyze(creative) {
    const keyframes = creative.keyframes;
    const representative: ReviewImage = {
      data_url: keyframes[0]?.data_url ?? "",
      mime_type: keyframes[0]?.mime_type ?? "",
    };
    return {
      durationSeconds: creative.durationSeconds,
      transcript: "",
      onScreenText: "",
      audioPresent: creative.hasAudio,
      keyframeCount: keyframes.length,
      representativeKeyframe: representative,
    };
  },
};

/** Why a short-form video creative was rejected before any model spend (Rules.md §6). */
export type VideoCreativeRejection =
  | { code: "empty_caption"; message: string }
  | { code: "duration_out_of_range"; message: string; limit: number; actual: number }
  | { code: "no_keyframes"; message: string }
  | { code: "too_many_keyframes"; message: string; limit: number; actual: number }
  | { code: "keyframe_too_large"; message: string; index: number };

export type VideoCreativeDecision =
  | { ok: true }
  | ({ ok: false } & VideoCreativeRejection);

/**
 * Validate a short-form video creative at the boundary, before any processing or
 * model spend (Rules.md §6 — reject bad input with a specific, plain-language
 * message; §1 cost discipline). Checks the short-form duration window, the keyframe
 * count, each keyframe's payload size (reusing the Day-15a image guard, since a
 * keyframe is sent to every juror as a vision block), and that the advertiser copy
 * is present (a video ad carries required copy, like an image ad).
 */
export function checkVideoCreative(
  creative: ShortFormVideoCreative,
): VideoCreativeDecision {
  if (normalize(creative.caption).length === 0) {
    return {
      ok: false,
      code: "empty_caption",
      message: "Add the ad's copy (caption / headline / CTA) to review a short-form video.",
    };
  }
  const { durationSeconds } = creative;
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds < SHORT_FORM_MIN_SECONDS ||
    durationSeconds > SHORT_FORM_MAX_SECONDS
  ) {
    return {
      ok: false,
      code: "duration_out_of_range",
      message: `A short-form video must be between ${SHORT_FORM_MIN_SECONDS} and ${SHORT_FORM_MAX_SECONDS} seconds. Longer clips are long-form video, which isn't supported yet.`,
      limit: SHORT_FORM_MAX_SECONDS,
      actual: durationSeconds,
    };
  }
  if (creative.keyframes.length < MIN_KEYFRAMES) {
    return {
      ok: false,
      code: "no_keyframes",
      message: "At least one keyframe is required to review a short-form video.",
    };
  }
  if (creative.keyframes.length > MAX_KEYFRAMES) {
    return {
      ok: false,
      code: "too_many_keyframes",
      message: `A short-form video review samples at most ${MAX_KEYFRAMES} keyframes.`,
      limit: MAX_KEYFRAMES,
      actual: creative.keyframes.length,
    };
  }
  for (let i = 0; i < creative.keyframes.length; i++) {
    const frame = creative.keyframes[i];
    if (!checkImageSize(frame.data_url).ok) {
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
 * Assemble the copy the jurors review from a video analysis: the advertiser's
 * caption plus the clip's transcript and on-screen text, each labelled so a juror
 * can tell spoken words from on-screen text from the written caption. Bounded to the
 * shared content cap so a long clip never blows the review token budget — the same
 * ceiling a text/image ad's copy obeys (`lib/ai/cost.ts`).
 */
export function assembleVideoCopy(
  analysis: VideoAnalysis,
  caption: string,
): string {
  const parts: string[] = [];
  const cap = normalize(caption);
  if (cap.length > 0) parts.push(`Caption / copy: ${cap}`);
  const transcript = boundText(analysis.transcript, MAX_TRANSCRIPT_CHARS);
  if (transcript.length > 0) parts.push(`Transcript (spoken): ${transcript}`);
  const onScreen = boundText(analysis.onScreenText, MAX_ONSCREEN_TEXT_CHARS);
  if (onScreen.length > 0) parts.push(`On-screen text: ${onScreen}`);
  return boundText(parts.join("\n"), MAX_CONTENT_CHARS);
}

/**
 * Reduce a processed clip to a {@link ReviewInput} the existing orchestrator accepts:
 * a `video_short` ad whose image is the representative keyframe and whose copy is the
 * assembled caption/transcript/on-screen text. The result is parsed through
 * `ReviewInputSchema` so the media refinement (a visual format requires an image) is
 * enforced here too — the reduction can never hand the jury an inconsistent input.
 */
export function buildVideoReviewInput(
  analysis: VideoAnalysis,
  creative: ShortFormVideoCreative,
  context: { brand_context?: string | null; business_context?: string | null } = {},
): ReviewInput {
  return ReviewInputSchema.parse({
    content_text: assembleVideoCopy(analysis, creative.caption),
    content_type: creative.content_type,
    platform: creative.platform,
    brand_context: context.brand_context ?? null,
    business_context: context.business_context ?? null,
    media_type: "video_short",
    image: analysis.representativeKeyframe,
  });
}

export type ReviewShortFormVideoResult =
  | { ok: true; review: ReviewResult; input: ReviewInput; analysis: VideoAnalysis }
  | ({ ok: false } & VideoCreativeRejection);

/**
 * Review a short-form video end-to-end: guard → process → reduce → run the SAME six
 * jurors (`runReview`). Dependencies are injected (processor + model client + weights)
 * so this is fully exercisable offline — the default processor and the offline mock
 * model need no ffmpeg, network, or credential. The route-level concerns (auth,
 * tenancy, rate limit, persistence, brand/business-context resolution) live in
 * `createReview` and are not duplicated here; this is the engine seam the live video
 * front door will call once ingestion exists.
 */
export async function reviewShortFormVideo(
  creative: ShortFormVideoCreative,
  deps: {
    processor?: ShortFormVideoProcessor;
    client?: ModelClient;
    weights?: PersonaWeights;
    context?: { brand_context?: string | null; business_context?: string | null };
  } = {},
): Promise<ReviewShortFormVideoResult> {
  const decision = checkVideoCreative(creative);
  if (!decision.ok) return decision;

  const processor = deps.processor ?? offlineShortFormVideoProcessor;
  const analysis = processor.analyze(creative);
  const input = buildVideoReviewInput(analysis, creative, deps.context ?? {});
  const review = await runReview(input, { client: deps.client, weights: deps.weights });
  return { ok: true, review, input, analysis };
}
