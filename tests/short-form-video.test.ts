import { describe, it, expect } from "vitest";
import {
  MEDIA_TYPES,
  SUBMITTABLE_MEDIA_TYPES,
  ReviewInputSchema,
  ReviewRequestSchema,
} from "@/lib/schema/juror";
import { buildUserPrompt, runReview } from "@/lib/ai/orchestrator";
import { PERSONAS } from "@/lib/ai/personas";
import { MAX_CONTENT_CHARS, MAX_IMAGE_DATA_URL_CHARS } from "@/lib/ai/cost";
import type { CompleteArgs, ModelClient } from "@/lib/ai/client";
import type { PersonaName } from "@/lib/schema/juror";
import {
  MAX_KEYFRAMES,
  SHORT_FORM_MAX_SECONDS,
  assembleVideoCopy,
  buildVideoReviewInput,
  checkVideoCreative,
  offlineShortFormVideoProcessor,
  reviewShortFormVideo,
  type ShortFormVideoCreative,
} from "@/lib/video/short-form";
import {
  buildShortFormVideoReadiness,
  reconcileShortFormVideo,
  sampleShortFormCreative,
} from "@/lib/video/short-form-readiness";

/**
 * Short-form video ads (DailyPlan Day 85) — the first post-v1 format. AdJury stays a
 * QA layer: a clip is reduced to a keyframe + copy and run through the SAME six
 * jurors. These tests pin the engine/submittable vocabulary split, the guards, the
 * deterministic offline processor, the reduction, the video prompt labelling, the
 * end-to-end review through the real jury under the offline mock, and the reconcile.
 */

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function creative(overrides: Partial<ShortFormVideoCreative> = {}): ShortFormVideoCreative {
  return { ...sampleShortFormCreative(), ...overrides };
}

describe("media type vocabulary — engine vs submittable", () => {
  it("has video_short as an engine format (video_long added alongside in Day 86)", () => {
    expect([...MEDIA_TYPES]).toEqual(["text", "image", "video_short", "video_long"]);
    expect((MEDIA_TYPES as readonly string[]).includes("video_short")).toBe(true);
  });

  it("does NOT make video_short client-submittable yet (live ingestion gated)", () => {
    expect([...SUBMITTABLE_MEDIA_TYPES]).toEqual(["text", "image"]);
  });

  it("rejects a video_short request at the public boundary but accepts it at the engine", () => {
    const requestResult = ReviewRequestSchema.safeParse({
      content_text: "copy",
      content_type: "ad_copy",
      platform: "instagram",
      media_type: "video_short",
      image: { data_url: PNG_DATA_URL, mime_type: "image/png" },
    });
    expect(requestResult.success).toBe(false);

    const engineResult = ReviewInputSchema.safeParse({
      content_text: "copy",
      content_type: "ad_copy",
      platform: "instagram",
      media_type: "video_short",
      image: { data_url: PNG_DATA_URL, mime_type: "image/png" },
    });
    expect(engineResult.success).toBe(true);
  });

  it("requires a keyframe for a video_short engine input", () => {
    const result = ReviewInputSchema.safeParse({
      content_text: "copy",
      content_type: "ad_copy",
      platform: "instagram",
      media_type: "video_short",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "image")).toBe(true);
    }
  });
});

describe("checkVideoCreative guards", () => {
  it("accepts a well-formed short-form creative", () => {
    expect(checkVideoCreative(creative()).ok).toBe(true);
  });

  it("rejects an empty caption", () => {
    const d = checkVideoCreative(creative({ caption: "   " }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("empty_caption");
  });

  it("rejects a clip longer than the short-form ceiling", () => {
    const d = checkVideoCreative(creative({ durationSeconds: SHORT_FORM_MAX_SECONDS + 1 }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("duration_out_of_range");
  });

  it("rejects a non-positive duration", () => {
    const d = checkVideoCreative(creative({ durationSeconds: 0 }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("duration_out_of_range");
  });

  it("rejects a clip with no keyframes", () => {
    const d = checkVideoCreative(creative({ keyframes: [] }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("no_keyframes");
  });

  it("rejects more than MAX_KEYFRAMES frames", () => {
    const frames = Array.from({ length: MAX_KEYFRAMES + 1 }, (_, i) => ({
      data_url: PNG_DATA_URL,
      mime_type: "image/png",
      atSeconds: i,
    }));
    const d = checkVideoCreative(creative({ keyframes: frames }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("too_many_keyframes");
  });

  it("rejects an oversized keyframe payload", () => {
    const tooBig = `data:image/png;base64,${"A".repeat(MAX_IMAGE_DATA_URL_CHARS)}`;
    const d = checkVideoCreative(
      creative({ keyframes: [{ data_url: tooBig, mime_type: "image/png", atSeconds: 0 }] }),
    );
    expect(d.ok).toBe(false);
    if (!d.ok && d.code === "keyframe_too_large") {
      expect(d.index).toBe(0);
    } else {
      expect.fail("expected a keyframe_too_large rejection");
    }
  });
});

describe("offline processor — deterministic and invents nothing", () => {
  it("is deterministic for the same creative", () => {
    const c = creative();
    expect(offlineShortFormVideoProcessor.analyze(c)).toEqual(
      offlineShortFormVideoProcessor.analyze(c),
    );
  });

  it("uses the first frame as the representative keyframe and counts frames", () => {
    const a = offlineShortFormVideoProcessor.analyze(creative());
    expect(a.keyframeCount).toBe(2);
    expect(a.representativeKeyframe.data_url).toBe(PNG_DATA_URL);
    expect(a.audioPresent).toBe(true);
  });

  it("invents no transcript or on-screen text offline", () => {
    const a = offlineShortFormVideoProcessor.analyze(creative());
    expect(a.transcript).toBe("");
    expect(a.onScreenText).toBe("");
  });
});

describe("reduction to a review input", () => {
  it("produces a schema-valid video_short input with a keyframe and the caption as copy", () => {
    const c = creative();
    const input = buildVideoReviewInput(offlineShortFormVideoProcessor.analyze(c), c);
    expect(input.media_type).toBe("video_short");
    expect(input.image?.data_url).toBe(PNG_DATA_URL);
    expect(input.content_text).toContain(c.caption);
    expect(input.content_text.length).toBeLessThanOrEqual(MAX_CONTENT_CHARS);
  });

  it("folds transcript and on-screen text in when present, labelled and bounded", () => {
    const copy = assembleVideoCopy(
      {
        durationSeconds: 20,
        transcript: "Buy our thing today.",
        onScreenText: "20% OFF",
        audioPresent: true,
        keyframeCount: 1,
        representativeKeyframe: { data_url: PNG_DATA_URL, mime_type: "image/png" },
      },
      "Weekend sale",
    );
    expect(copy).toContain("Caption / copy: Weekend sale");
    expect(copy).toContain("Transcript (spoken): Buy our thing today.");
    expect(copy).toContain("On-screen text: 20% OFF");
    expect(copy.length).toBeLessThanOrEqual(MAX_CONTENT_CHARS);
  });
});

describe("buildUserPrompt labels a short-form video ad", () => {
  function videoInput() {
    const c = creative();
    return buildVideoReviewInput(offlineShortFormVideoProcessor.analyze(c), c);
  }

  it("tells every juror the ad is a short-form video with an attached keyframe", () => {
    for (const persona of PERSONAS) {
      const prompt = buildUserPrompt(videoInput(), persona);
      expect(prompt).toContain("Ad format: SHORT-FORM VIDEO.");
      expect(prompt).toContain("keyframe");
    }
  });

  it("does not mislabel a text ad as a video", () => {
    const textInput = ReviewInputSchema.parse({
      content_text: "Buy our thing today.",
      content_type: "ad_copy",
      platform: "instagram",
    });
    expect(buildUserPrompt(textInput, PERSONAS[0])).not.toContain("SHORT-FORM VIDEO");
  });

  it("still labels an image ad as IMAGE (unchanged)", () => {
    const imageInput = ReviewInputSchema.parse({
      content_text: "Sleep better tonight.",
      content_type: "ad_copy",
      platform: "instagram",
      media_type: "image",
      image: { data_url: PNG_DATA_URL, mime_type: "image/png" },
    });
    const prompt = buildUserPrompt(imageInput, PERSONAS[0]);
    expect(prompt).toContain("Ad format: IMAGE.");
    expect(prompt).not.toContain("SHORT-FORM VIDEO");
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

describe("reviewShortFormVideo — end to end through the real jury", () => {
  it("runs a short-form video through all six jurors and tags it video_short", async () => {
    const { calls, client } = captureClient();
    const result = await reviewShortFormVideo(creative(), { client });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.review.media_type).toBe("video_short");
    expect(result.review.jurors).toHaveLength(PERSONAS.length);
    expect(calls).toHaveLength(PERSONAS.length);
    // Every juror received the representative keyframe as its vision block.
    for (const call of calls) {
      expect(call.image).toEqual({ dataUrl: PNG_DATA_URL, mimeType: "image/png" });
    }
  });

  it("returns a real scorecard under the offline mock (non-vacuous)", async () => {
    const result = await reviewShortFormVideo(creative());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.review.jurors.every((j) => j.status === "ok")).toBe(true);
    expect(["pass", "revise", "fail"]).toContain(result.review.verdict);
    expect(result.review.aggregate_score).toBeGreaterThan(0);
  });

  it("short-circuits on a guard rejection without running the jury", async () => {
    const { calls, client } = captureClient();
    const result = await reviewShortFormVideo(
      creative({ durationSeconds: SHORT_FORM_MAX_SECONDS + 30 }),
      { client },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("duration_out_of_range");
    expect(calls).toHaveLength(0);
  });
});

describe("reconcile + readiness", () => {
  it("the real pipeline reconciles clean against the sample creative", () => {
    const reconcile = reconcileShortFormVideo();
    expect(reconcile.failures).toEqual([]);
    expect(reconcile.clean).toBe(true);
  });

  it("reports a failure when the sample creative can't pass the guard", () => {
    const reconcile = reconcileShortFormVideo(creative({ caption: "" }));
    expect(reconcile.clean).toBe(false);
    expect(reconcile.failures.length).toBeGreaterThan(0);
  });

  it("readiness is offline-ready with the live-infra steps left manual", () => {
    const readiness = buildShortFormVideoReadiness();
    expect(readiness.ready).toBe(true);
    expect(readiness.manualSteps).toBe(5);
    expect(readiness.items.filter((i) => i.status === "ready")).toHaveLength(2);
  });
});
