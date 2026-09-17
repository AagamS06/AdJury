import { describe, it, expect } from "vitest";
import {
  PLATFORM_AWARE_PERSONAS,
  PLATFORM_GUIDANCE,
  isPlatformAwarePersona,
  normalizePlatform,
  platformGuidanceFor,
} from "@/lib/ai/personas/platform-guidance";
import { buildUserPrompt } from "@/lib/ai/orchestrator";
import { seoDiscoverability } from "@/lib/ai/personas/seo";
import { stopScrolling } from "@/lib/ai/personas/stop-scrolling";
import { brandVoiceGuardian } from "@/lib/ai/personas/brand-voice";
import { PERSONA_NAMES, type ReviewInput } from "@/lib/schema/juror";
import { PLATFORM_OPTIONS } from "@/lib/reviews/review-form";

/**
 * Platform-aware persona prompts (DailyPlan Day 20).
 *
 * The SEO and "stop scrolling" jurors adapt their expectations to the selected
 * platform. These tests pin the pure guidance mapping and prove the platform is
 * threaded through to the assembled user prompt (the DoD: "platform passed
 * through; prompts reflect it"), while the other three jurors stay unaffected.
 */

const NON_PLATFORM_AWARE = PERSONA_NAMES.filter(
  (n) => !isPlatformAwarePersona(n),
);

function inputWith(platform: string | null): ReviewInput {
  return {
    content_text: "Introducing our new widget — buy now!",
    content_type: "ad_copy",
    platform,
    brand_context: null,
  };
}

describe("platform-aware persona set", () => {
  it("is exactly the SEO and stop-scrolling jurors", () => {
    expect([...PLATFORM_AWARE_PERSONAS]).toEqual([
      "seo_discoverability",
      "stop_scrolling",
    ]);
  });

  it("every guidance entry defines both platform-aware personas with non-empty text", () => {
    for (const [key, guidance] of Object.entries(PLATFORM_GUIDANCE)) {
      expect(guidance.label.trim().length, key).toBeGreaterThan(0);
      for (const persona of PLATFORM_AWARE_PERSONAS) {
        expect(guidance[persona].trim().length, `${key}.${persona}`).toBeGreaterThan(0);
      }
    }
  });

  it("covers every curated platform option in the submission form", () => {
    for (const opt of PLATFORM_OPTIONS) {
      if (opt.value === "") continue; // the "not specified" option
      expect(
        normalizePlatform(opt.value)! in PLATFORM_GUIDANCE,
        opt.value,
      ).toBe(true);
    }
  });
});

describe("normalizePlatform", () => {
  it("returns null for null / empty / whitespace", () => {
    expect(normalizePlatform(null)).toBeNull();
    expect(normalizePlatform("")).toBeNull();
    expect(normalizePlatform("   ")).toBeNull();
  });

  it("trims and lowercases", () => {
    expect(normalizePlatform("  Instagram ")).toBe("instagram");
    expect(normalizePlatform("LinkedIn")).toBe("linkedin");
  });

  it("folds common aliases onto canonical keys", () => {
    expect(normalizePlatform("twitter")).toBe("x");
    expect(normalizePlatform("newsletter")).toBe("email");
    expect(normalizePlatform("blog")).toBe("website");
    expect(normalizePlatform("yt")).toBe("youtube");
  });

  it("passes an unrecognized platform through lowercased", () => {
    expect(normalizePlatform("Pinterest")).toBe("pinterest");
  });
});

describe("platformGuidanceFor", () => {
  it("returns null for non-platform-aware personas regardless of platform", () => {
    for (const persona of NON_PLATFORM_AWARE) {
      expect(platformGuidanceFor(persona, "instagram")).toBeNull();
    }
  });

  it("returns null for platform-aware personas when no platform is selected", () => {
    for (const persona of PLATFORM_AWARE_PERSONAS) {
      expect(platformGuidanceFor(persona, null)).toBeNull();
      expect(platformGuidanceFor(persona, "  ")).toBeNull();
    }
  });

  it("returns the curated guidance for a known platform", () => {
    expect(platformGuidanceFor("seo_discoverability", "instagram")).toBe(
      PLATFORM_GUIDANCE.instagram.seo_discoverability,
    );
    expect(platformGuidanceFor("stop_scrolling", "instagram")).toBe(
      PLATFORM_GUIDANCE.instagram.stop_scrolling,
    );
  });

  it("gives the two jurors different guidance for the same platform", () => {
    const seo = platformGuidanceFor("seo_discoverability", "google");
    const scroll = platformGuidanceFor("stop_scrolling", "google");
    expect(seo).not.toBeNull();
    expect(scroll).not.toBeNull();
    expect(seo).not.toBe(scroll);
  });

  it("normalizes case and aliases before lookup", () => {
    expect(platformGuidanceFor("seo_discoverability", "  Instagram ")).toBe(
      PLATFORM_GUIDANCE.instagram.seo_discoverability,
    );
    expect(platformGuidanceFor("stop_scrolling", "twitter")).toBe(
      PLATFORM_GUIDANCE.x.stop_scrolling,
    );
  });

  it("returns a generic, platform-naming nudge for an unrecognized platform", () => {
    const guidance = platformGuidanceFor("seo_discoverability", "Pinterest");
    expect(guidance).not.toBeNull();
    expect(guidance).toContain("pinterest");
  });
});

describe("buildUserPrompt platform pass-through", () => {
  it("injects platform-specific expectations for the SEO juror", () => {
    const prompt = buildUserPrompt(inputWith("instagram"), seoDiscoverability);
    expect(prompt).toContain("Platform: instagram");
    expect(prompt).toContain("Platform-specific expectations");
    expect(prompt).toContain(PLATFORM_GUIDANCE.instagram.seo_discoverability);
  });

  it("injects the stop-scrolling juror's own platform guidance", () => {
    const prompt = buildUserPrompt(inputWith("tiktok"), stopScrolling);
    expect(prompt).toContain(PLATFORM_GUIDANCE.tiktok.stop_scrolling);
    // and not the SEO juror's guidance
    expect(prompt).not.toContain(PLATFORM_GUIDANCE.tiktok.seo_discoverability);
  });

  it("does not add a platform block for a non-platform-aware juror", () => {
    const prompt = buildUserPrompt(inputWith("instagram"), brandVoiceGuardian);
    expect(prompt).not.toContain("Platform-specific expectations");
    // the generic platform line is still present for context
    expect(prompt).toContain("Platform: instagram");
  });

  it("adds no platform block when no platform is selected", () => {
    const prompt = buildUserPrompt(inputWith(null), seoDiscoverability);
    expect(prompt).not.toContain("Platform-specific expectations");
    expect(prompt).toContain("Platform: unspecified");
  });
});

describe("platform-aware persona system prompts", () => {
  it("both jurors' system prompts tell the model to adapt to the platform", () => {
    expect(seoDiscoverability.systemPrompt.toLowerCase()).toContain("platform");
    expect(stopScrolling.systemPrompt.toLowerCase()).toContain("platform");
  });
});
