import { describe, it, expect } from "vitest";
import {
  MEDIA_TYPES,
  ReviewInputSchema,
  ReviewRequestSchema,
  type ReviewInput,
} from "@/lib/schema/juror";
import { buildUserPrompt, runReview } from "@/lib/ai/orchestrator";
import { PERSONAS } from "@/lib/ai/personas";
import type { CompleteArgs, ModelClient } from "@/lib/ai/client";
import {
  MAX_IMAGE_DATA_URL_CHARS,
  checkImageSize,
} from "@/lib/ai/cost";
import type { PersonaName } from "@/lib/schema/juror";

/**
 * Multi-format input (DailyPlan Day 15a). AdJury reviews image ads as well as
 * text ads, so it reaches advertisers whose creative is visual (PRD §4/§6). These
 * tests pin the format contract (media_type + image, kept consistent), the image
 * size guard, and that an image ad's visual is actually routed to every juror.
 */

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("media type + image contract", () => {
  it("defaults to a text ad with no image (every existing caller unchanged)", () => {
    const parsed = ReviewRequestSchema.parse({
      content_text: "Buy our thing today.",
      content_type: "ad_copy",
      platform: "instagram",
    });
    expect(parsed.media_type).toBe("text");
    expect(parsed.image).toBeNull();
  });

  it("accepts an image ad with an image + accompanying copy", () => {
    const parsed = ReviewRequestSchema.parse({
      content_text: "Sleep better tonight — 20% off.",
      content_type: "ad_copy",
      platform: "instagram",
      media_type: "image",
      image: { data_url: PNG_DATA_URL, mime_type: "image/png" },
    });
    expect(parsed.media_type).toBe("image");
    expect(parsed.image?.mime_type).toBe("image/png");
  });

  it("rejects an image ad with no image", () => {
    const result = ReviewRequestSchema.safeParse({
      content_text: "Sleep better tonight.",
      content_type: "ad_copy",
      platform: "instagram",
      media_type: "image",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "image")).toBe(true);
    }
  });

  it("rejects a text ad that smuggles in an image (format must match the input)", () => {
    const result = ReviewRequestSchema.safeParse({
      content_text: "Buy our thing today.",
      content_type: "ad_copy",
      platform: "instagram",
      media_type: "text",
      image: { data_url: PNG_DATA_URL, mime_type: "image/png" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unsupported image MIME type", () => {
    const result = ReviewRequestSchema.safeParse({
      content_text: "Sleep better tonight.",
      content_type: "ad_copy",
      platform: "instagram",
      media_type: "image",
      image: { data_url: PNG_DATA_URL, mime_type: "image/tiff" },
    });
    expect(result.success).toBe(false);
  });

  it("only ships text and image formats today (video is a later phase)", () => {
    expect([...MEDIA_TYPES]).toEqual(["text", "image"]);
  });
});

describe("image size guard", () => {
  it("accepts an image within the payload cap", () => {
    expect(checkImageSize(PNG_DATA_URL)).toEqual({ ok: true, chars: PNG_DATA_URL.length });
  });

  it("rejects an oversized image payload with a specific message", () => {
    const tooBig = `data:image/png;base64,${"A".repeat(MAX_IMAGE_DATA_URL_CHARS)}`;
    const decision = checkImageSize(tooBig);
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe("too_large");
      expect(decision.message).toMatch(/too large/i);
      expect(decision.actual).toBeGreaterThan(decision.limit);
    }
  });
});

describe("buildUserPrompt format labelling", () => {
  function imageInput(): ReviewInput {
    return ReviewInputSchema.parse({
      content_text: "Sleep better tonight — 20% off.",
      content_type: "ad_copy",
      platform: "instagram",
      media_type: "image",
      image: { data_url: PNG_DATA_URL, mime_type: "image/png" },
    });
  }

  it("tells every juror the ad is an image and its visual is attached", () => {
    for (const persona of PERSONAS) {
      const prompt = buildUserPrompt(imageInput(), persona);
      expect(prompt).toContain("Ad format: IMAGE.");
      expect(prompt).toContain("attached");
    }
  });

  it("does not label a text ad as an image", () => {
    const textInput = ReviewInputSchema.parse({
      content_text: "Buy our thing today.",
      content_type: "ad_copy",
      platform: "instagram",
    });
    expect(buildUserPrompt(textInput, PERSONAS[0])).not.toContain("Ad format: IMAGE.");
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

describe("runReview routes the image to the model", () => {
  it("passes the image to every juror and tags the review as an image ad", async () => {
    const { calls, client } = captureClient();
    const input = ReviewInputSchema.parse({
      content_text: "Sleep better tonight — 20% off.",
      content_type: "ad_copy",
      platform: "instagram",
      media_type: "image",
      image: { data_url: PNG_DATA_URL, mime_type: "image/png" },
    });

    const review = await runReview(input, { client });

    expect(review.media_type).toBe("image");
    expect(calls).toHaveLength(PERSONAS.length);
    for (const call of calls) {
      expect(call.image).toEqual({ dataUrl: PNG_DATA_URL, mimeType: "image/png" });
    }
  });

  it("sends no image for a text ad", async () => {
    const { calls, client } = captureClient();
    const input = ReviewInputSchema.parse({
      content_text: "Buy our thing today.",
      content_type: "ad_copy",
      platform: "instagram",
    });
    const review = await runReview(input, { client });
    expect(review.media_type).toBe("text");
    for (const call of calls) {
      expect(call.image ?? null).toBeNull();
    }
  });
});
