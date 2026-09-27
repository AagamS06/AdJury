/**
 * Brand-voice cache — compute side (DailyPlan Day 29).
 *
 * When an admin saves the company's tone/style guide (Day 26), we derive a small,
 * bounded **brand summary** and a content-addressed **cache key** from it, once,
 * and store both on the `brand_profiles` row (`brand_summary` + `embedding_ref`).
 * A review (Day 30) then reuses the cached summary instead of reprocessing the
 * full guide every time — so cost per review stays independent of guide size
 * (Rules.md §1 cost discipline; Architecture.md §5 brand-voice caching).
 *
 * The summary is produced by a **pure, deterministic, offline** condensation — no
 * model call — so it is free, reproducible, and fully unit-testable with no live
 * credential (this cloud build has none). The offline mock in `lib/ai/client.ts`
 * exists for the juror fan-out; the brand-voice cache deliberately does not spend
 * a model call per edit. A future swap to a model/embedding summary can live
 * behind this same function without touching the write path or the review reader.
 *
 * This module is the compute half only. The DB write is in `queries.ts`, the
 * decision/authz core in `save-brand-profile.ts`. Reviews consuming the cached
 * summary is Day 30 (this day does not change the review read path).
 */
import { createHash } from "node:crypto";

/**
 * Bump when the summarization algorithm changes so every stored `embedding_ref`
 * from an older version reads as stale (the key embeds the version), and the next
 * brand save recomputes. Keeps the cache honest across algorithm changes.
 */
export const BRAND_SUMMARY_VERSION = 1;

/**
 * The cached summary is intentionally small and bounded regardless of the guide's
 * size — that is the whole point of the cache (Day 30: "cost per review unchanged
 * by guide size"). Comfortably under the guide cap (8000) and the review token
 * budget so the two never fight.
 */
export const MAX_BRAND_SUMMARY_CHARS = 600;

/** Prefix on the cache key so a stored ref is self-describing and versioned. */
const REF_PREFIX = "bvc";

/**
 * Collapse all whitespace runs (including newlines) to single spaces and trim.
 * Normalizing first makes the summary and the cache key depend only on the
 * guide's meaningful content, not on incidental formatting — so re-saving the
 * same guide with different spacing does not churn the cache.
 */
export function normalizeGuideText(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Split normalized text into sentence-ish units on terminal punctuation, keeping
 * the punctuation. Falls back to the whole string when there is no terminator, so
 * a guide written as fragments still condenses sensibly.
 */
function splitSentences(normalized: string): string[] {
  const parts = normalized.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g);
  return parts ? parts.map((p) => p.trim()).filter(Boolean) : [];
}

/**
 * A deterministic extractive summary of the brand guide: the leading sentences up
 * to {@link MAX_BRAND_SUMMARY_CHARS}. For a tone/style guide the opening usually
 * carries the voice description, so leading content is the most useful signal.
 *
 * - Empty / whitespace-only input → "" (no cache; mirrors `resolveBrandContext`).
 * - Already within the cap → the normalized guide verbatim (nothing to trim).
 * - Otherwise → whole sentences that fit; if even the first sentence overflows,
 *   hard-truncate at a word boundary and add an ellipsis so we never cut a word.
 */
export function summarizeBrandGuide(text: string | null | undefined): string {
  const normalized = normalizeGuideText(text);
  if (normalized.length === 0) return "";
  if (normalized.length <= MAX_BRAND_SUMMARY_CHARS) return normalized;

  const sentences = splitSentences(normalized);
  let summary = "";
  for (const sentence of sentences) {
    const candidate = summary ? `${summary} ${sentence}` : sentence;
    if (candidate.length > MAX_BRAND_SUMMARY_CHARS) break;
    summary = candidate;
  }
  if (summary) return summary;

  // The first sentence alone exceeds the cap: truncate at a word boundary.
  return truncateAtWord(normalized, MAX_BRAND_SUMMARY_CHARS);
}

function truncateAtWord(text: string, max: number): string {
  const ellipsis = "…";
  const budget = Math.max(0, max - ellipsis.length);
  const slice = text.slice(0, budget);
  const lastSpace = slice.lastIndexOf(" ");
  const head = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return `${head.trimEnd()}${ellipsis}`;
}

/**
 * A stable, content-addressed cache key for the guide: `bvc<version>-<sha256>`
 * over the version + normalized text. The same guide always yields the same ref
 * (so an unchanged guide is "computed once and reused" — Architecture.md §5), and
 * any change to the text or the algorithm version yields a new ref (so staleness
 * is detectable). This is the `embedding_ref` "pointer/hash to cached embedding".
 */
export function brandGuideRef(text: string | null | undefined): string {
  const normalized = normalizeGuideText(text);
  const hash = createHash("sha256")
    .update(`${BRAND_SUMMARY_VERSION}:${normalized}`)
    .digest("hex");
  return `${REF_PREFIX}${BRAND_SUMMARY_VERSION}-${hash}`;
}

/** The cached summary + key written to `brand_profiles` on a brand-guide save. */
export interface BrandCache {
  /** Bounded, reusable brand summary; null when the guide is empty. */
  summary: string | null;
  /** Content-addressed cache key (`embedding_ref`); null when the guide is empty. */
  embeddingRef: string | null;
}

/**
 * Compute the cache to persist for a guide. Called once per brand-guide save
 * (Day 29 write side), never per review (Day 30 read side reuses this). An empty
 * / whitespace-only guide caches nothing (both null) — consistent with a guide
 * that reads as "not set" elsewhere (`hasBrandProfile` / `resolveBrandContext`).
 */
export function computeBrandCache(text: string | null | undefined): BrandCache {
  const normalized = normalizeGuideText(text);
  if (normalized.length === 0) {
    return { summary: null, embeddingRef: null };
  }
  return {
    summary: summarizeBrandGuide(normalized),
    embeddingRef: brandGuideRef(normalized),
  };
}

/**
 * Whether a stored row's cache is already current for the given guide text, i.e.
 * its `embedding_ref` matches what we would compute now (same text + algorithm
 * version). Lets a caller skip a needless recompute/write when the guide is
 * unchanged, and lets a future backfill find rows whose cache is stale or missing.
 */
export function isBrandCacheFresh(
  row: { embedding_ref: string | null } | null,
  text: string | null | undefined,
): boolean {
  if (!row?.embedding_ref) return false;
  return row.embedding_ref === brandGuideRef(text);
}
