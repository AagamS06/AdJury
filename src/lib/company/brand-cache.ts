/**
 * Brand-voice cache — write side (DailyPlan Day 29).
 *
 * A company's tone/style guide can be up to `MAX_TONE_GUIDE_CHARS` (8,000) long.
 * Sending it to the Brand Voice Guardian on every review reprocesses the whole
 * guide each time, which fights the core cost mechanic (Rules.md §1; PRD §6.2
 * v1.5 "avoid reprocessing the style guide every review"; Architecture.md §5
 * "brand-voice caching"). This module computes a bounded brand-voice summary
 * ONCE per `brand_profiles` update; Day 30 makes reviews read the cached summary
 * instead of the full guide.
 *
 * Two artifacts are produced on a save:
 *  - `summary` — a bounded, condensed brand-voice summary (the cache payload).
 *  - `embeddingRef` — the cache KEY (Architecture.md §3 calls `embedding_ref` the
 *    "pointer/hash to cached embedding"): a version tag + a stable hash of the
 *    NORMALIZED guide. It lets a save tell whether the stored summary is still
 *    fresh for the current guide and skip recomputation when it is
 *    (`isBrandCacheFresh`) — so the summary is computed once per real change, not
 *    on every idempotent save.
 *
 * Everything here is PURE and deterministic so it is unit-testable without a
 * database, a request, or a model key. The summarizer is an extractive,
 * offline condenser (no model spend): it keeps the leading, most voice-defining
 * portion of the guide up to a small character budget. That already achieves the
 * cost win — reviews stop reprocessing an arbitrarily long guide — and works in
 * the credential-free build. A model-based abstractive summary could later slot
 * in behind `computeBrandVoiceCache` without changing its callers or the stored
 * shape; the version tag in the key exists precisely so bumping the summarizer
 * invalidates every stale cache on the next save.
 */
import type { BrandProfileRow } from "@/types/db";

/**
 * Bump when the summarizer's output changes so every previously-cached summary
 * is treated as stale on the next save (the version is part of the cache key).
 */
export const BRAND_SUMMARY_VERSION = 1;

/**
 * Upper bound on the cached summary's length. Small enough to keep the per-review
 * brand-context cost bounded regardless of how long the full guide is, but large
 * enough to carry the voice-defining substance. Well under `MAX_TONE_GUIDE_CHARS`
 * so a large guide is genuinely condensed; a short guide is already under it and
 * is summarized to (essentially) itself.
 */
export const MAX_BRAND_SUMMARY_CHARS = 600;

/** The cache artifacts stored on a brand profile: the key and the payload. */
export interface BrandVoiceCache {
  /** Cache key: `v<version>:<hash>` of the normalized guide. Stored in embedding_ref. */
  embeddingRef: string;
  /** Bounded, condensed brand-voice summary. Stored in brand_summary. */
  summary: string;
}

/**
 * Normalize a guide for hashing/summarizing: collapse all runs of whitespace
 * (including newlines) to single spaces and trim. So cosmetically-different but
 * substantively-identical guides ("Measured.\n\nExpert." vs "Measured. Expert.")
 * hash to the same key and don't trigger a needless recompute.
 */
export function normalizeGuide(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Stable, dependency-free hash of a string (FNV-1a, 32-bit), returned as hex.
 * Matches the approach in `lib/ai/client.ts` so the whole codebase shares one
 * portable hash and pulls in no crypto import. Only used as a cache key — not a
 * security boundary — so a fast non-cryptographic hash is appropriate.
 */
export function stableHash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // >>> 0 coerces to an unsigned 32-bit int before hex formatting.
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * The cache key for a guide: the summarizer version plus a hash of the
 * normalized guide. Two saves with the same substantive guide produce the same
 * key, so a save can detect that the stored summary is already current.
 */
export function brandCacheKey(guideText: string): string {
  return `v${BRAND_SUMMARY_VERSION}:${stableHash(normalizeGuide(guideText))}`;
}

/**
 * Condense a guide into a bounded brand-voice summary (extractive, deterministic,
 * offline). Normalizes first, then keeps whole leading sentences up to
 * `MAX_BRAND_SUMMARY_CHARS`; if even the first sentence overflows the budget, it
 * is truncated at a word boundary with an ellipsis so the result is always
 * bounded and never cuts a word mid-way. A guide already within the budget is
 * returned as its normalized self (nothing to trim). Returns "" for an
 * empty/whitespace-only guide (callers only cache a real guide).
 */
export function summarizeBrandVoice(guideText: string): string {
  const normalized = normalizeGuide(guideText);
  if (normalized.length === 0) return "";
  if (normalized.length <= MAX_BRAND_SUMMARY_CHARS) return normalized;

  // Split into sentences, keeping their trailing punctuation, then greedily
  // accumulate whole sentences until the next one would exceed the budget.
  const sentences = normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [normalized];
  let summary = "";
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    const candidate = summary ? `${summary} ${sentence}` : sentence;
    if (candidate.length > MAX_BRAND_SUMMARY_CHARS) break;
    summary = candidate;
  }

  if (summary.length > 0) return summary;

  // The first sentence alone overflows: truncate at a word boundary within the
  // budget (leaving room for the ellipsis) rather than emitting an empty summary.
  const room = MAX_BRAND_SUMMARY_CHARS - 1;
  const clipped = normalized.slice(0, room);
  const lastSpace = clipped.lastIndexOf(" ");
  const head = lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped;
  return `${head.trimEnd()}…`;
}

/** Compute both cache artifacts (the key and the condensed summary) for a guide. */
export function computeBrandVoiceCache(guideText: string): BrandVoiceCache {
  return {
    embeddingRef: brandCacheKey(guideText),
    summary: summarizeBrandVoice(guideText),
  };
}

/**
 * Whether the profile's stored cache is already current for `guideText`: it has
 * a summary and its `embedding_ref` equals the key the current guide (and current
 * summarizer version) would produce. When true, a save can reuse the stored
 * artifacts and skip recomputation — the cache is "computed once per update,"
 * and an idempotent save (or one that bumps nothing but `updated_at`) does no
 * extra work. A version bump changes the key, so every cache reads stale until
 * recomputed.
 */
export function isBrandCacheFresh(
  profile: Pick<BrandProfileRow, "embedding_ref" | "brand_summary"> | null,
  guideText: string,
): boolean {
  if (!profile) return false;
  if (!profile.brand_summary || !profile.embedding_ref) return false;
  return profile.embedding_ref === brandCacheKey(guideText);
}
