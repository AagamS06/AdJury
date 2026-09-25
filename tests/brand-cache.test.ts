import { describe, it, expect } from "vitest";
import {
  BRAND_SUMMARY_VERSION,
  MAX_BRAND_SUMMARY_CHARS,
  brandCacheKey,
  computeBrandVoiceCache,
  isBrandCacheFresh,
  normalizeGuide,
  stableHash,
  summarizeBrandVoice,
} from "@/lib/company/brand-cache";
import type { BrandProfileRow } from "@/types/db";
import { MAX_TONE_GUIDE_CHARS } from "@/lib/company/brand-profile";

/**
 * Brand-voice cache — write side (DailyPlan Day 29). Pure, deterministic module
 * that condenses the tone/style guide into a bounded summary once per save and
 * derives a version-tagged cache key, so reviews reuse the summary instead of
 * reprocessing the full guide (Day 30 reads it). The central guarantees proved:
 * the summary is BOUNDED regardless of guide size, the key is STABLE across
 * cosmetic-only whitespace changes and changes with the guide, and freshness
 * correctly distinguishes a current cache from a stale/absent one.
 */

const GUIDE = "Measured, expert, never hype. Prefer plain verbs. Avoid slang.";

describe("normalizeGuide", () => {
  it("collapses whitespace runs and trims", () => {
    expect(normalizeGuide("  Measured.\n\n  Expert.\tNever hype.  ")).toBe(
      "Measured. Expert. Never hype.",
    );
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(normalizeGuide("   \n\t ")).toBe("");
  });
});

describe("stableHash", () => {
  it("is deterministic and 8 hex chars", () => {
    expect(stableHash(GUIDE)).toBe(stableHash(GUIDE));
    expect(stableHash(GUIDE)).toMatch(/^[0-9a-f]{8}$/);
  });

  it("differs for different input", () => {
    expect(stableHash("a")).not.toBe(stableHash("b"));
  });
});

describe("brandCacheKey", () => {
  it("is stable across cosmetic-only whitespace differences (via normalization)", () => {
    expect(brandCacheKey("Measured. Expert.")).toBe(
      brandCacheKey("  Measured.\n\n  Expert.  "),
    );
  });

  it("changes when the guide's substance changes", () => {
    expect(brandCacheKey("Measured, expert.")).not.toBe(
      brandCacheKey("Loud, hypey."),
    );
  });

  it("carries the summarizer version so a bump invalidates every cache", () => {
    expect(brandCacheKey(GUIDE).startsWith(`v${BRAND_SUMMARY_VERSION}:`)).toBe(
      true,
    );
  });
});

describe("summarizeBrandVoice", () => {
  it("returns a short guide unchanged (after normalization)", () => {
    expect(summarizeBrandVoice(`  ${GUIDE}  `)).toBe(GUIDE);
  });

  it("returns '' for an empty/whitespace-only guide", () => {
    expect(summarizeBrandVoice("")).toBe("");
    expect(summarizeBrandVoice("   \n ")).toBe("");
  });

  it("bounds a very long guide to the summary cap", () => {
    // A guide near the max length made of many short sentences.
    const long = Array.from(
      { length: 400 },
      (_, i) => `Sentence ${i} about the brand voice.`,
    ).join(" ");
    expect(long.length).toBeGreaterThan(MAX_BRAND_SUMMARY_CHARS);
    const summary = summarizeBrandVoice(long);
    expect(summary.length).toBeLessThanOrEqual(MAX_BRAND_SUMMARY_CHARS);
    expect(summary.length).toBeGreaterThan(0);
    // Extractive: the summary is a leading prefix of the normalized guide.
    expect(normalizeGuide(long).startsWith(summary)).toBe(true);
  });

  it("truncates at a word boundary with an ellipsis when the first sentence overflows", () => {
    const oneHugeSentence = `${"word ".repeat(400).trim()} end`;
    const summary = summarizeBrandVoice(oneHugeSentence);
    expect(summary.length).toBeLessThanOrEqual(MAX_BRAND_SUMMARY_CHARS);
    expect(summary.endsWith("…")).toBe(true);
    // No mid-word cut: the char before the ellipsis is not a partial token start.
    expect(summary).not.toContain("  ");
  });

  it("keeps a max-length guide's summary within the cap", () => {
    const atMax = "a ".repeat(MAX_TONE_GUIDE_CHARS / 2);
    const summary = summarizeBrandVoice(atMax);
    expect(summary.length).toBeLessThanOrEqual(MAX_BRAND_SUMMARY_CHARS);
  });
});

describe("computeBrandVoiceCache", () => {
  it("returns the key and the summary together", () => {
    const cache = computeBrandVoiceCache(GUIDE);
    expect(cache.embeddingRef).toBe(brandCacheKey(GUIDE));
    expect(cache.summary).toBe(summarizeBrandVoice(GUIDE));
  });

  it("is deterministic", () => {
    expect(computeBrandVoiceCache(GUIDE)).toEqual(computeBrandVoiceCache(GUIDE));
  });
});

describe("isBrandCacheFresh", () => {
  function row(overrides: Partial<BrandProfileRow> = {}): BrandProfileRow {
    return {
      id: "p1",
      company_id: "c1",
      tone_guide_text: GUIDE,
      embedding_ref: null,
      brand_summary: null,
      updated_at: "2026-09-22T00:00:00.000Z",
      ...overrides,
    };
  }

  it("is false for a null profile", () => {
    expect(isBrandCacheFresh(null, GUIDE)).toBe(false);
  });

  it("is false when no summary or no key is stored", () => {
    const cache = computeBrandVoiceCache(GUIDE);
    expect(isBrandCacheFresh(row({ embedding_ref: cache.embeddingRef }), GUIDE)).toBe(
      false,
    );
    expect(isBrandCacheFresh(row({ brand_summary: cache.summary }), GUIDE)).toBe(
      false,
    );
  });

  it("is true when the stored key matches the current guide", () => {
    const cache = computeBrandVoiceCache(GUIDE);
    expect(
      isBrandCacheFresh(
        row({ embedding_ref: cache.embeddingRef, brand_summary: cache.summary }),
        // Cosmetic-only difference still normalizes to the same key.
        `  ${GUIDE}  `,
      ),
    ).toBe(true);
  });

  it("is false when the guide has changed from the cached one", () => {
    const cache = computeBrandVoiceCache(GUIDE);
    expect(
      isBrandCacheFresh(
        row({ embedding_ref: cache.embeddingRef, brand_summary: cache.summary }),
        "A different brand voice entirely.",
      ),
    ).toBe(false);
  });
});
