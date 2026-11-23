import { describe, it, expect } from "vitest";
import {
  MEDIA_TYPES,
  SUBMITTABLE_MEDIA_TYPES,
  ReviewInputSchema,
  ReviewRequestSchema,
} from "@/lib/schema/juror";
import { buildUserPrompt } from "@/lib/ai/orchestrator";
import { PERSONAS } from "@/lib/ai/personas";
import {
  MAX_CONTENT_CHARS,
  MAX_IMAGE_DATA_URL_CHARS,
  estimateReviewUsage,
} from "@/lib/ai/cost";
import type { CompleteArgs, ModelClient } from "@/lib/ai/client";
import type { PersonaName } from "@/lib/schema/juror";
import {
  LONG_FORM_MAX_CANDIDATES,
  LONG_FORM_MAX_KEYFRAMES,
  LONG_FORM_MAX_SECONDS,
  LONG_FORM_MIN_SECONDS,
  buildLongFormReviewInput,
  checkLongFormCreative,
  offlineLongFormVideoProcessor,
  planLongFormSampling,
  reviewLongFormVideo,
  selectKeyframes,
  type LongFormVideoCreative,
} from "@/lib/video/long-form";
import {
  buildLongFormVideoReadiness,
  reconcileLongFormVideo,
  sampleCandidateFrames,
  sampleLongFormCreative,
  sampleMaxLengthCreative,
} from "@/lib/video/long-form-readiness";

/**
 * Long-form video ads (DailyPlan Day 86) — the second video format. AdJury stays a QA
 * layer: a clip is reduced to a keyframe + copy and run through the SAME six jurors,
 * but with a sampling/chunking cost strategy so the fan-out stays bounded regardless
 * of clip length. These tests pin the vocabulary split, the sampling/chunking bounds,
 * the guards, the deterministic offline processor, the reduction, the video prompt
 * labelling, the end-to-end review through the real jury under the offline mock, the
 * cost-bound-independent-of-length property, and the reconcile.
 */

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function creative(overrides: Partial<LongFormVideoCreative> = {}): LongFormVideoCreative {
  return { ...sampleLongFormCreative(), ...overrides };
}

describe("media type vocabulary — engine vs submittable", () => {
  it("adds video_long to the engine formats alongside video_short", () => {
    expect([...MEDIA_TYPES]).toEqual(["text", "image", "video_short", "video_long"]);
  });

  it("does NOT make video_long client-submittable yet (live ingestion gated)", () => {
    expect([...SUBMITTABLE_MEDIA_TYPES]).toEqual(["text", "image"]);
    expect((SUBMITTABLE_MEDIA_TYPES as readonly string[]).includes("video_long")).toBe(false);
  });

  it("rejects a video_long request at the public boundary but accepts it at the engine", () => {
    const requestResult = ReviewRequestSchema.safeParse({
      content_text: "copy",
      content_type: "ad_copy",
      platform: "youtube",
      media_type: "video_long",
      image: { data_url: PNG_DATA_URL, mime_type: "image/png" },
    });
    expect(requestResult.success).toBe(false);

    const engineResult = ReviewInputSchema.safeParse({
      content_text: "copy",
      content_type: "ad_copy",
      platform: "youtube",
      media_type: "video_long",
      image: { data_url: PNG_DATA_URL, mime_type: "image/png" },
    });
    expect(engineResult.success).toBe(true);
  });

  it("requires a keyframe for a video_long engine input", () => {
    const result = ReviewInputSchema.safeParse({
      content_text: "copy",
      content_type: "ad_copy",
      platform: "youtube",
      media_type: "video_long",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "image")).toBe(true);
      expect(result.error.issues.some((i) => /long-form video/i.test(i.message))).toBe(true);
    }
  });
});

describe("sampling + chunking — the cost strategy", () => {
  it("plans at most LONG_FORM_MAX_KEYFRAMES frames, for a short long-form clip and a max-length one", () => {
    for (const duration of [LONG_FORM_MIN_SECONDS, 240, 600, LONG_FORM_MAX_SECONDS]) {
      const plan = planLongFormSampling(duration);
      expect(plan.length).toBeGreaterThanOrEqual(1);
      expect(plan.length).toBeLessThanOrEqual(LONG_FORM_MAX_KEYFRAMES);
    }
  });

  it("spreads planned timestamps across the whole clip in order", () => {
    const plan = planLongFormSampling(240);
    expect(plan.length).toBe(8); // ceil(240/30)
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i]).toBeGreaterThan(plan[i - 1]);
    }
    expect(plan[0]).toBeGreaterThanOrEqual(0);
    expect(plan[plan.length - 1]).toBeLessThanOrEqual(240);
  });

  it("caps keyframes for a very long clip regardless of candidate count", () => {
    const duration = LONG_FORM_MAX_SECONDS;
    const candidates = sampleCandidateFrames(600, duration);
    const selected = selectKeyframes(candidates, duration);
    expect(selected.length).toBe(LONG_FORM_MAX_KEYFRAMES);
  });

  it("returns frames in time order and never more than the candidates available", () => {
    const duration = 240;
    const selected = selectKeyframes(sampleCandidateFrames(3, duration), duration);
    expect(selected.length).toBe(3); // fewer candidates than the budget
    for (let i = 1; i < selected.length; i++) {
      expect(selected[i].atSeconds).toBeGreaterThanOrEqual(selected[i - 1].atSeconds);
    }
  });

  it("returns nothing for no candidates", () => {
    expect(selectKeyframes([], 240)).toEqual([]);
  });
});

describe("checkLongFormCreative guards", () => {
  it("accepts a well-formed long-form creative", () => {
    expect(checkLongFormCreative(creative()).ok).toBe(true);
  });

  it("rejects an empty caption", () => {
    const d = checkLongFormCreative(creative({ caption: "   " }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("empty_caption");
  });

  it("rejects a clip shorter than the long-form floor (that's short-form)", () => {
    const d = checkLongFormCreative(creative({ durationSeconds: LONG_FORM_MIN_SECONDS - 1 }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("duration_out_of_range");
  });

  it("rejects a clip longer than the long-form ceiling", () => {
    const d = checkLongFormCreative(creative({ durationSeconds: LONG_FORM_MAX_SECONDS + 1 }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("duration_out_of_range");
  });

  it("rejects a clip with no candidate keyframes", () => {
    const d = checkLongFormCreative(creative({ candidateKeyframes: [] }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("no_keyframes");
  });

  it("rejects more than LONG_FORM_MAX_CANDIDATES candidate frames", () => {
    const d = checkLongFormCreative(
      creative({ candidateKeyframes: sampleCandidateFrames(LONG_FORM_MAX_CANDIDATES + 1, 240) }),
    );
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("too_many_candidates");
  });

  it("rejects an oversized candidate keyframe payload", () => {
    const tooBig = `data:image/png;base64,${"A".repeat(MAX_IMAGE_DATA_URL_CHARS)}`;
    const d = checkLongFormCreative(
      creative({ candidateKeyframes: [{ data_url: tooBig, mime_type: "image/png", atSeconds: 0 }] }),
    );
    expect(d.ok).toBe(false);
    if (!d.ok && d.code === "keyframe_too_large") {
      expect(d.index).toBe(0);
    } else {
      expect.fail("expected a keyframe_too_large rejection");
    }
  });
});

describe("offline processor — deterministic, bounded, invents nothing", () => {
  it("is deterministic for the same creative", () => {
    const c = creative();
    expect(offlineLongFormVideoProcessor.analyze(c)).toEqual(
      offlineLongFormVideoProcessor.analyze(c),
    );
  });

  it("thins candidates to the keyframe budget and uses the first selected as representative", () => {
    const a = offlineLongFormVideoProcessor.analyze(creative());
    expect(a.keyframeCount).toBeLessThanOrEqual(LONG_FORM_MAX_KEYFRAMES);
    expect(a.keyframeCount).toBeGreaterThan(0);
    expect(a.representativeKeyframe.data_url).toBe(PNG_DATA_URL);
    expect(a.audioPresent).toBe(true);
  });

  it("invents no transcript or on-screen text offline", () => {
    const a = offlineLongFormVideoProcessor.analyze(creative());
    expect(a.transcript).toBe("");
    expect(a.onScreenText).toBe("");
  });
});

describe("reduction to a review input", () => {
  it("produces a schema-valid video_long input with a keyframe and the caption as copy", () => {
    const c = creative();
    const input = buildLongFormReviewInput(offlineLongFormVideoProcessor.analyze(c), c);
    expect(input.media_type).toBe("video_long");
    expect(input.image?.data_url).toBe(PNG_DATA_URL);
    expect(input.content_text).toContain(c.caption);
    expect(input.content_text.length).toBeLessThanOrEqual(MAX_CONTENT_CHARS);
  });
});

describe("buildUserPrompt labels a long-form video ad", () => {
  function videoInput() {
    const c = creative();
    return buildLongFormReviewInput(offlineLongFormVideoProcessor.analyze(c), c);
  }

  it("tells every juror the ad is a long-form video with an attached keyframe", () => {
    for (const persona of PERSONAS) {
      const prompt = buildUserPrompt(videoInput(), persona);
      expect(prompt).toContain("Ad format: LONG-FORM VIDEO.");
      expect(prompt).toContain("keyframe");
    }
  });

  it("does not mislabel a text ad as a video", () => {
    const textInput = ReviewInputSchema.parse({
      content_text: "Buy our thing today.",
      content_type: "ad_copy",
      platform: "youtube",
    });
    expect(buildUserPrompt(textInput, PERSONAS[0])).not.toContain("LONG-FORM VIDEO");
  });

  it("does not mislabel an image ad or a short-form video as long-form", () => {
    const imageInput = ReviewInputSchema.parse({
      content_text: "Sleep better tonight.",
      content_type: "ad_copy",
      platform: "instagram",
      media_type: "image",
      image: { data_url: PNG_DATA_URL, mime_type: "image/png" },
    });
    const prompt = buildUserPrompt(imageInput, PERSONAS[0]);
    expect(prompt).toContain("Ad format: IMAGE.");
    expect(prompt).not.toContain("LONG-FORM VIDEO");
  });
});

/** A capture client that records what each juror was sent and returns valid JSON. */
function captureClient() {
  const calls: CompleteArgs[] = [];
  const client: ModelClient = {
    model: "capture",
    isMock: true,
    async complete(args) {
      calls.push(args);
      return JSON.stringify({
        persona: args.persona as PersonaName,
        score: 8,
        confidence: "high",
        summary: "ok",
        issues: [],
        suggested_rewrite: "rewrite",
      });
    },
  };
  return { calls, client };
}

describe("reviewLongFormVideo — end to end through the real jury", () => {
  it("runs a long-form video through all six jurors and tags it video_long", async () => {
    const { calls, client } = captureClient();
    const result = await reviewLongFormVideo(creative(), { client });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.review.media_type).toBe("video_long");
    expect(result.review.jurors).toHaveLength(PERSONAS.length);
    expect(calls).toHaveLength(PERSONAS.length);
    // Every juror received the representative keyframe as its vision block.
    for (const call of calls) {
      expect(call.image).toEqual({ dataUrl: PNG_DATA_URL, mimeType: "image/png" });
    }
  });

  it("returns a real scorecard under the offline mock (non-vacuous)", async () => {
    const result = await reviewLongFormVideo(creative());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.review.jurors.every((j) => j.status === "ok")).toBe(true);
    expect(["pass", "revise", "fail"]).toContain(result.review.verdict);
    expect(result.review.aggregate_score).toBeGreaterThan(0);
  });

  it("short-circuits on a guard rejection without running the jury", async () => {
    const { calls, client } = captureClient();
    const result = await reviewLongFormVideo(
      creative({ durationSeconds: LONG_FORM_MAX_SECONDS + 60 }),
      { client },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("duration_out_of_range");
    expect(calls).toHaveLength(0);
  });
});

describe("cost is independent of clip length", () => {
  it("a 30-minute clip reduces to the same six-juror fan-out as a 4-minute one", () => {
    const shortClip = sampleLongFormCreative();
    const longClip = sampleMaxLengthCreative();

    const shortInput = buildLongFormReviewInput(
      offlineLongFormVideoProcessor.analyze(shortClip),
      shortClip,
    );
    const longInput = buildLongFormReviewInput(
      offlineLongFormVideoProcessor.analyze(longClip),
      longClip,
    );

    const shortUsage = estimateReviewUsage(shortInput.content_text, PERSONAS.length);
    const longUsage = estimateReviewUsage(longInput.content_text, PERSONAS.length);

    expect(longClip.durationSeconds).toBeGreaterThan(shortClip.durationSeconds * 5);
    expect(longUsage.jurorCount).toBe(shortUsage.jurorCount);
    expect(longUsage.maxOutputTokens).toBe(shortUsage.maxOutputTokens);
    // The offline reduction folds only the (identical) caption, so the input estimate
    // doesn't grow with duration; both stay well under the content budget.
    expect(longUsage.estimatedInputTokens).toBeLessThanOrEqual(
      shortUsage.estimatedInputTokens + 1,
    );
    expect(longInput.content_text.length).toBeLessThanOrEqual(MAX_CONTENT_CHARS);
  });

  it("the selected keyframe count stays within budget even at max length", () => {
    const a = offlineLongFormVideoProcessor.analyze(sampleMaxLengthCreative());
    expect(a.keyframeCount).toBeLessThanOrEqual(LONG_FORM_MAX_KEYFRAMES);
  });
});

describe("reconcile + readiness", () => {
  it("the real pipeline reconciles clean against the sample creative", () => {
    const reconcile = reconcileLongFormVideo();
    expect(reconcile.failures).toEqual([]);
    expect(reconcile.clean).toBe(true);
  });

  it("reports a failure when the sample creative can't pass the guard", () => {
    const reconcile = reconcileLongFormVideo(creative({ caption: "" }));
    expect(reconcile.clean).toBe(false);
    expect(reconcile.failures.length).toBeGreaterThan(0);
  });

  it("readiness is offline-ready with the live-infra steps left manual", () => {
    const readiness = buildLongFormVideoReadiness();
    expect(readiness.ready).toBe(true);
    expect(readiness.items.filter((i) => i.status === "ready")).toHaveLength(3);
    expect(readiness.manualSteps).toBe(5);
  });
});
