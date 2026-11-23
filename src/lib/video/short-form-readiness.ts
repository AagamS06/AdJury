/**
 * Short-form video — readiness + reconcile (DailyPlan Day 85).
 *
 * The executable "a short-form video runs through the jury" check and its offline
 * drift guard, sibling to the pipeline in `short-form.ts` (the same split the repo
 * uses for `motion.ts` / `motion-audit.ts`, and the readiness/reconcile shape the
 * Week-12 days use — cf. `demo-script.ts`). Everything here is pure and sync so it
 * runs with no ffmpeg, network, or credential; the async end-to-end review through
 * the six jurors is demonstrated by `npm run video:check` and pinned by the tests.
 */
import { MAX_CONTENT_CHARS } from "@/lib/ai/cost";
import {
  MEDIA_TYPES,
  SUBMITTABLE_MEDIA_TYPES,
  ReviewInputSchema,
} from "@/lib/schema/juror";
import {
  MAX_KEYFRAMES,
  MAX_ONSCREEN_TEXT_CHARS,
  MAX_TRANSCRIPT_CHARS,
  MIN_KEYFRAMES,
  SHORT_FORM_MAX_SECONDS,
  SHORT_FORM_MIN_SECONDS,
  buildVideoReviewInput,
  checkVideoCreative,
  offlineShortFormVideoProcessor,
  type ShortFormVideoCreative,
} from "./short-form";

/** A tiny valid 1×1 PNG used as a sample keyframe (no real creative in the build). */
const SAMPLE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/**
 * A representative, well-formed short-form creative — a ≤60s clip with two sampled
 * keyframes, an audio track, and the advertiser's copy — used by the reconcile, the
 * readiness report, and `npm run video:check`. Non-vacuous on purpose (more than one
 * keyframe, a real caption, a duration inside the window), so the checks prove
 * something.
 */
export function sampleShortFormCreative(): ShortFormVideoCreative {
  return {
    durationSeconds: 24,
    hasAudio: true,
    keyframes: [
      { data_url: SAMPLE_PNG, mime_type: "image/png", atSeconds: 0 },
      { data_url: SAMPLE_PNG, mime_type: "image/png", atSeconds: 12 },
    ],
    caption: "Sleep better tonight — our weighted blanket, now 20% off.",
    content_type: "ad_copy",
    platform: "instagram",
  };
}

export interface ShortFormReconcile {
  clean: boolean;
  failures: string[];
}

/**
 * Prove the short-form pipeline is internally coherent and drift-free (the
 * executable DoD, minus the async jury run the script/tests cover):
 *  - the duration + keyframe bounds are sane;
 *  - `video_short` is an engine format but NOT a client-submittable one, and
 *    `video_long` is still absent (the gating invariant that keeps the public
 *    endpoint honest until live ingestion ships);
 *  - the offline processor is deterministic, bounded, and invents nothing;
 *  - the reduction yields a schema-valid `video_short` review input with a keyframe
 *    and non-empty, budget-bounded copy.
 */
export function reconcileShortFormVideo(
  creative: ShortFormVideoCreative = sampleShortFormCreative(),
): ShortFormReconcile {
  const failures: string[] = [];

  if (!(SHORT_FORM_MIN_SECONDS >= 1)) failures.push("SHORT_FORM_MIN_SECONDS must be ≥ 1");
  if (!(SHORT_FORM_MAX_SECONDS >= SHORT_FORM_MIN_SECONDS)) {
    failures.push("SHORT_FORM_MAX_SECONDS must be ≥ SHORT_FORM_MIN_SECONDS");
  }
  if (!(MIN_KEYFRAMES >= 1)) failures.push("MIN_KEYFRAMES must be ≥ 1");
  if (!(MAX_KEYFRAMES >= MIN_KEYFRAMES)) failures.push("MAX_KEYFRAMES must be ≥ MIN_KEYFRAMES");

  // Vocabulary gating: the engine knows video_short, the public endpoint does not,
  // and long-form is not shipped yet.
  if (!(MEDIA_TYPES as readonly string[]).includes("video_short")) {
    failures.push("video_short must be an engine media type");
  }
  if ((SUBMITTABLE_MEDIA_TYPES as readonly string[]).includes("video_short")) {
    failures.push("video_short must NOT be client-submittable until live ingestion ships");
  }
  if ((MEDIA_TYPES as readonly string[]).includes("video_long")) {
    failures.push("video_long is a later phase and must not be shipped yet");
  }

  // The sample must pass the guard (non-vacuous), else the checks below are moot.
  if (!checkVideoCreative(creative).ok) {
    failures.push("the sample creative must pass checkVideoCreative");
    return { clean: failures.length === 0, failures };
  }

  // Offline processor: deterministic, bounded, invents nothing.
  const a1 = offlineShortFormVideoProcessor.analyze(creative);
  const a2 = offlineShortFormVideoProcessor.analyze(creative);
  if (JSON.stringify(a1) !== JSON.stringify(a2)) {
    failures.push("offline processor must be deterministic");
  }
  if (a1.keyframeCount !== creative.keyframes.length) {
    failures.push("analysis keyframeCount must match the sampled frames");
  }
  if (a1.representativeKeyframe.data_url !== creative.keyframes[0].data_url) {
    failures.push("representative keyframe must be the first sampled frame");
  }
  if (a1.transcript.length !== 0 || a1.onScreenText.length !== 0) {
    failures.push("offline processor must invent no transcript / on-screen text");
  }
  if (a1.transcript.length > MAX_TRANSCRIPT_CHARS) failures.push("transcript exceeds its cap");
  if (a1.onScreenText.length > MAX_ONSCREEN_TEXT_CHARS) failures.push("on-screen text exceeds its cap");

  // Reduction: a schema-valid video_short input with a keyframe and bounded copy.
  try {
    const input = buildVideoReviewInput(a1, creative);
    const parsed = ReviewInputSchema.parse(input);
    if (parsed.media_type !== "video_short") failures.push("reduced input must be media_type video_short");
    if (!parsed.image) failures.push("reduced input must attach a keyframe image");
    if (parsed.content_text.trim().length === 0) failures.push("reduced input must have non-empty copy");
    if (parsed.content_text.length > MAX_CONTENT_CHARS) failures.push("reduced copy exceeds the content budget");
  } catch (err) {
    failures.push(`reduction failed to produce a valid review input: ${(err as Error).message}`);
  }

  return { clean: failures.length === 0, failures };
}

export type ReadinessStatus = "ready" | "manual";
export interface ReadinessItem {
  status: ReadinessStatus;
  title: string;
  detail: string;
}
export interface ShortFormVideoReadiness {
  /** True when every offline (`ready`) item holds — i.e. the reconcile is clean. */
  ready: boolean;
  items: ReadinessItem[];
  /** How many `manual` items (live-infra steps) remain. */
  manualSteps: number;
}

/**
 * The readiness report: what the short-form pipeline proves offline today, and what
 * still needs live infrastructure/credentials (object storage + ffmpeg + transcription
 * + OCR + the public upload front door). Manual items are never auto-marked done.
 */
export function buildShortFormVideoReadiness(
  creative: ShortFormVideoCreative = sampleShortFormCreative(),
): ShortFormVideoReadiness {
  const reconcile = reconcileShortFormVideo(creative);
  const offlineDetail = reconcile.clean
    ? "Pipeline coherent: guards, deterministic offline processor, and a valid video_short reduction."
    : `Reconcile FAILED: ${reconcile.failures.join("; ")}`;

  const items: ReadinessItem[] = [
    {
      status: "ready",
      title: "Pipeline well-formed and drift-free (offline)",
      detail: offlineDetail,
    },
    {
      status: "ready",
      title: "Reviews through the same six jurors (offline mock)",
      detail:
        "reviewShortFormVideo reduces the clip to a keyframe + copy and runs the real orchestrator; proven by npm run video:check and tests/short-form-video.test.ts.",
    },
    {
      status: "manual",
      title: "Object storage for uploaded clips",
      detail: "Store the raw video securely (Supabase storage / S3) — PRD §6.3 production data & hosting.",
    },
    {
      status: "manual",
      title: "Keyframe sampling (ffmpeg)",
      detail: "Sample up to MAX_KEYFRAMES frames server-side; needs ffmpeg + compute this build lacks.",
    },
    {
      status: "manual",
      title: "Audio transcription",
      detail: "Transcribe the clip's audio into the analysis transcript; needs a transcription credential.",
    },
    {
      status: "manual",
      title: "On-screen text (OCR)",
      detail: "Read text burned into the frames into the analysis on-screen text; needs an OCR step.",
    },
    {
      status: "manual",
      title: "Public upload front door",
      detail:
        "Add video_short to SUBMITTABLE_MEDIA_TYPES + the submission form once ingestion exists; POST /api/reviews rejects it until then.",
    },
  ];

  return {
    ready: reconcile.clean,
    items,
    manualSteps: items.filter((i) => i.status === "manual").length,
  };
}
