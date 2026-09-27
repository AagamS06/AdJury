import { describe, it, expect } from "vitest";
import {
  MAX_BRAND_SUMMARY_CHARS,
  brandGuideRef,
  computeBrandCache,
  resolveBrandSummary,
} from "@/lib/company/brand-summary";
import type { BrandProfileRow } from "@/types/db";

/**
 * Brand-voice cache — read side (DailyPlan Day 30). A review reuses the small,
 * bounded summary written once per brand-guide save (Day 29) instead of
 * reprocessing the full guide every time. The central guarantees proved here:
 *  - a fresh cache is reused verbatim (no reprocessing) — `source: "cache"`;
 *  - a missing/stale cache recomputes the SAME bounded summary live once — the
 *    fallback is still guide-size-independent, never the full guide;
 *  - the resolved brand context is bounded regardless of guide size (so per-review
 *    cost does not grow with the guide), and an empty guide resolves to null.
 */

type CacheRow = Pick<
  BrandProfileRow,
  "tone_guide_text" | "embedding_ref" | "brand_summary"
>;

/** A brand_profiles row shape with a *fresh* cache for its own guide text. */
function freshRow(guide: string): CacheRow {
  const cache = computeBrandCache(guide);
  return {
    tone_guide_text: guide,
    embedding_ref: cache.embeddingRef,
    brand_summary: cache.summary,
  };
}

describe("resolveBrandSummary — no usable guide", () => {
  it("null row → null, source none", () => {
    expect(resolveBrandSummary(null)).toEqual({ summary: null, source: "none" });
  });

  it("absent tone guide → null, source none", () => {
    expect(
      resolveBrandSummary({
        tone_guide_text: null,
        embedding_ref: null,
        brand_summary: null,
      }),
    ).toEqual({ summary: null, source: "none" });
  });

  it("whitespace-only guide → null, source none (mirrors resolveBrandContext)", () => {
    expect(
      resolveBrandSummary({
        tone_guide_text: "   \n\t ",
        embedding_ref: "bvc1-whatever",
        brand_summary: "stale summary",
      }),
    ).toEqual({ summary: null, source: "none" });
  });
});

describe("resolveBrandSummary — fresh cache is reused (no reprocessing)", () => {
  it("reuses the stored summary verbatim when the ref matches the guide", () => {
    const guide = "Tone: measured, expert, trustworthy. Avoid hype and slang.";
    const row = freshRow(guide);
    const resolved = resolveBrandSummary(row);
    expect(resolved.source).toBe("cache");
    expect(resolved.summary).toBe(row.brand_summary);
  });

  it("reuses the stored summary EVEN IF it differs from what the guide would produce (proves it is not reprocessing)", () => {
    // A hand-set summary with a matching ref: a true reuse returns this text, not
    // a re-derivation of the guide. (In production the writer keeps them in sync;
    // this isolates the reuse behaviour.)
    const guide = "Tone: measured, expert, trustworthy.";
    const row: CacheRow = {
      tone_guide_text: guide,
      embedding_ref: brandGuideRef(guide),
      brand_summary: "SENTINEL CACHED VOICE",
    };
    expect(resolveBrandSummary(row)).toEqual({
      summary: "SENTINEL CACHED VOICE",
      source: "cache",
    });
  });
});

describe("resolveBrandSummary — missing/stale cache recomputes bounded (never the full guide)", () => {
  it("recomputes when there is no cached ref/summary yet", () => {
    const guide = "Tone: bold and playful. Speak like a friend, never a lawyer.";
    const resolved = resolveBrandSummary({
      tone_guide_text: guide,
      embedding_ref: null,
      brand_summary: null,
    });
    expect(resolved.source).toBe("recomputed");
    // For a short guide the bounded summary is the normalized guide itself.
    expect(resolved.summary).toBe("Tone: bold and playful. Speak like a friend, never a lawyer.");
  });

  it("recomputes when the cached ref is stale (guide edited since it was written)", () => {
    const oldGuide = "Tone: formal and reserved.";
    const newGuide = "Tone: warm and conversational, but precise.";
    const resolved = resolveBrandSummary({
      tone_guide_text: newGuide,
      // ref + summary belong to the OLD guide → stale.
      embedding_ref: brandGuideRef(oldGuide),
      brand_summary: computeBrandCache(oldGuide).summary,
    });
    expect(resolved.source).toBe("recomputed");
    expect(resolved.summary).toBe(newGuide);
  });

  it("recomputes when the ref matches but the cached summary is empty/whitespace", () => {
    const guide = "Tone: concise and confident.";
    const resolved = resolveBrandSummary({
      tone_guide_text: guide,
      embedding_ref: brandGuideRef(guide),
      brand_summary: "   ",
    });
    expect(resolved.source).toBe("recomputed");
    expect(resolved.summary).toBe(guide);
  });
});

describe("resolveBrandSummary — bounded regardless of guide size (the cache's whole point)", () => {
  const unit = "Our brand voice is measured, expert, and reassuring. ";

  it("a large guide resolves to a bounded summary from a fresh cache", () => {
    const bigGuide = unit.repeat(200); // ~10k chars, far over the summary cap
    const row = freshRow(bigGuide);
    const resolved = resolveBrandSummary(row);
    expect(resolved.source).toBe("cache");
    expect(resolved.summary).not.toBeNull();
    expect(resolved.summary!.length).toBeLessThanOrEqual(MAX_BRAND_SUMMARY_CHARS);
  });

  it("a 10× larger guide yields the same bounded length (cost independent of guide size)", () => {
    const smallGuide = unit.repeat(30);
    const bigGuide = unit.repeat(300);
    const small = resolveBrandSummary(freshRow(smallGuide));
    const big = resolveBrandSummary(freshRow(bigGuide));
    // Both are bounded, and neither grows with the guide.
    expect(small.summary!.length).toBeLessThanOrEqual(MAX_BRAND_SUMMARY_CHARS);
    expect(big.summary!.length).toBeLessThanOrEqual(MAX_BRAND_SUMMARY_CHARS);
    expect(big.summary!.length).toBe(small.summary!.length);
  });

  it("the recompute fallback is also bounded (a stale/missing cache never injects the full guide)", () => {
    const bigGuide = unit.repeat(200);
    const resolved = resolveBrandSummary({
      tone_guide_text: bigGuide,
      embedding_ref: null,
      brand_summary: null,
    });
    expect(resolved.source).toBe("recomputed");
    expect(resolved.summary!.length).toBeLessThanOrEqual(MAX_BRAND_SUMMARY_CHARS);
    expect(resolved.summary!.length).toBeLessThan(bigGuide.length);
  });
});
