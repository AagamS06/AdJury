import { describe, it, expect } from "vitest";
import {
  BRAND_SUMMARY_VERSION,
  MAX_BRAND_SUMMARY_CHARS,
  brandGuideRef,
  computeBrandCache,
  isBrandCacheFresh,
  normalizeGuideText,
  summarizeBrandGuide,
} from "@/lib/company/brand-summary";

/**
 * Brand-voice cache — compute side (DailyPlan Day 29). Proves the pure, offline,
 * deterministic summarizer + content-addressed key that a brand-guide save
 * persists so a review (Day 30) reuses a small cached summary instead of
 * reprocessing the full guide. The central guarantees: the summary is bounded
 * regardless of guide size (so Day 30's per-review cost is guide-size-independent),
 * computing is deterministic (same guide → same summary + ref), a changed guide
 * yields a new ref (staleness is detectable), and an empty guide caches nothing.
 */

describe("normalizeGuideText", () => {
  it("collapses whitespace runs and trims", () => {
    expect(normalizeGuideText("  Measured,\n\n expert.   Never   hype.  ")).toBe(
      "Measured, expert. Never hype.",
    );
  });

  it("treats null/undefined/whitespace as empty", () => {
    expect(normalizeGuideText(null)).toBe("");
    expect(normalizeGuideText(undefined)).toBe("");
    expect(normalizeGuideText("   \n\t ")).toBe("");
  });
});

describe("summarizeBrandGuide", () => {
  it("returns a short guide unchanged (after normalization)", () => {
    expect(summarizeBrandGuide("  Measured and expert.  ")).toBe(
      "Measured and expert.",
    );
  });

  it("returns empty string for an empty/whitespace guide", () => {
    expect(summarizeBrandGuide("")).toBe("");
    expect(summarizeBrandGuide("   ")).toBe("");
    expect(summarizeBrandGuide(null)).toBe("");
  });

  it("bounds the summary to the cap regardless of guide size", () => {
    const huge = "Our voice is measured and expert. ".repeat(2000);
    const summary = summarizeBrandGuide(huge);
    expect(summary.length).toBeLessThanOrEqual(MAX_BRAND_SUMMARY_CHARS);
    // Cost per review must not scale with guide size (Day 30 DoD): a 10x-longer
    // guide yields the same bounded summary.
    const huger = "Our voice is measured and expert. ".repeat(20000);
    expect(summarizeBrandGuide(huger).length).toBeLessThanOrEqual(
      MAX_BRAND_SUMMARY_CHARS,
    );
  });

  it("keeps whole leading sentences when trimming a long guide", () => {
    const guide =
      "Speak plainly and with authority. " +
      "Avoid hype, superlatives, and exclamation points. " +
      "Prefer concrete nouns and active verbs. " +
      "X".repeat(MAX_BRAND_SUMMARY_CHARS);
    const summary = summarizeBrandGuide(guide);
    expect(summary.length).toBeLessThanOrEqual(MAX_BRAND_SUMMARY_CHARS);
    expect(summary).toContain("Speak plainly and with authority.");
    // The trailing giant "sentence" does not fit, so it is dropped whole rather
    // than cut mid-content.
    expect(summary).not.toContain("XXXX");
  });

  it("hard-truncates at a word boundary when the first sentence alone overflows", () => {
    const words = "brandvoice ".repeat(200).trim(); // one long terminator-free run
    const summary = summarizeBrandGuide(words);
    expect(summary.length).toBeLessThanOrEqual(MAX_BRAND_SUMMARY_CHARS);
    expect(summary.endsWith("…")).toBe(true);
    // Never cuts a word: the char before the ellipsis is not mid-token.
    expect(summary).not.toMatch(/brandvoi…$/);
    expect(summary.slice(0, -1).trimEnd().endsWith("brandvoice")).toBe(true);
  });

  it("is deterministic (same input → same summary)", () => {
    const guide = "Measured and expert. ".repeat(100);
    expect(summarizeBrandGuide(guide)).toBe(summarizeBrandGuide(guide));
  });
});

describe("brandGuideRef", () => {
  it("is a stable, versioned, content-addressed key", () => {
    const ref = brandGuideRef("Measured and expert.");
    expect(ref).toMatch(new RegExp(`^bvc${BRAND_SUMMARY_VERSION}-[0-9a-f]{64}$`));
    expect(brandGuideRef("Measured and expert.")).toBe(ref);
  });

  it("ignores incidental whitespace differences (same normalized text → same ref)", () => {
    expect(brandGuideRef("Measured   and\n expert.")).toBe(
      brandGuideRef("Measured and expert."),
    );
  });

  it("changes when the guide's meaningful content changes", () => {
    expect(brandGuideRef("Measured and expert.")).not.toBe(
      brandGuideRef("Playful and bold."),
    );
  });
});

describe("computeBrandCache", () => {
  it("returns a summary + ref for a real guide", () => {
    const cache = computeBrandCache("Measured and expert. Avoid hype.");
    expect(cache.summary).toBe("Measured and expert. Avoid hype.");
    expect(cache.embeddingRef).toMatch(/^bvc\d+-[0-9a-f]{64}$/);
  });

  it("caches nothing (both null) for an empty/whitespace guide", () => {
    expect(computeBrandCache("")).toEqual({ summary: null, embeddingRef: null });
    expect(computeBrandCache("   \n ")).toEqual({
      summary: null,
      embeddingRef: null,
    });
    expect(computeBrandCache(null)).toEqual({ summary: null, embeddingRef: null });
  });
});

describe("isBrandCacheFresh", () => {
  it("is true only when the stored ref matches the current guide+version", () => {
    const guide = "Measured and expert.";
    const ref = brandGuideRef(guide);
    expect(isBrandCacheFresh({ embedding_ref: ref }, guide)).toBe(true);
    // Changed guide → stale.
    expect(isBrandCacheFresh({ embedding_ref: ref }, "Playful and bold.")).toBe(
      false,
    );
  });

  it("is false when there is no cached ref", () => {
    expect(isBrandCacheFresh(null, "Measured and expert.")).toBe(false);
    expect(isBrandCacheFresh({ embedding_ref: null }, "Measured and expert.")).toBe(
      false,
    );
  });
});
