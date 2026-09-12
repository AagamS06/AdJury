/**
 * Word-level before/after diff between the submitted content and a juror's
 * suggested rewrite (DailyPlan Day 15 — suggested-rewrite UX).
 *
 * Kept out of the React components (like `review-form.ts`/`scorecard-view.ts`)
 * so the diff logic is unit-testable in the node test env without a browser. A
 * "tone" here is a semantic role (`equal`/`added`/`removed`); the component maps
 * it to Tailwind classes and always pairs it with a text cue — the highlight is
 * never colour-only (Design.md §6).
 *
 * The diff is an LCS over whitespace-preserving tokens so the "before" and
 * "after" streams reconstruct the original texts exactly. It is bounded: a very
 * long original or rewrite skips the inline highlight (`tooLarge`) and the
 * component falls back to plain side-by-side blocks, keeping the render legible
 * and the O(n·m) table small.
 */

/** A segment's role: unchanged, inserted by the rewrite, or removed from it. */
export type DiffType = "equal" | "added" | "removed";

/** A contiguous run of tokens sharing one role. `value` includes whitespace. */
export interface DiffSegment {
  type: DiffType;
  value: string;
}

/** The result of comparing an original against a suggested rewrite. */
export interface RewriteDiff {
  /**
   * True when there is a meaningful before/after to show — the original is
   * present and differs from the rewrite. A rewrite that equals the original
   * (PRD §7 allows `suggested_rewrite` to match when nothing needs changing) or
   * a missing original reads as `false`, so the UI hides the comparison.
   */
  changed: boolean;
  /**
   * True when either side is too long for a legible inline diff. `segments` is
   * empty; the UI should show the two texts plainly instead of highlighting.
   */
  tooLarge: boolean;
  /** Coalesced diff segments (empty when `!changed` or `tooLarge`). */
  segments: DiffSegment[];
  /** Count of non-whitespace tokens the rewrite adds. */
  added: number;
  /** Count of non-whitespace tokens the rewrite removes. */
  removed: number;
}

/**
 * Cap on tokens per side for the inline diff. Marketing rewrites are short (a
 * line or a paragraph); beyond this the highlight stops being scannable and the
 * DP table grows, so we fall back to plain before/after blocks.
 */
export const MAX_DIFF_TOKENS = 400;

/**
 * Split text into tokens, each either a run of whitespace or a run of
 * non-whitespace, so joining the tokens reproduces the input exactly.
 */
export function tokenize(text: string): string[] {
  return text.match(/\s+|\S+/g) ?? [];
}

/** True when a token is purely whitespace (not counted in added/removed). */
function isWhitespace(token: string): boolean {
  return /^\s+$/.test(token);
}

/**
 * Compare a submitted `original` against a juror's `rewrite`, producing a
 * word-level before/after diff. Whitespace/`null` originals and rewrites that
 * match the original both read as unchanged.
 */
export function computeRewriteDiff(
  original: string | null | undefined,
  rewrite: string,
): RewriteDiff {
  const before = (original ?? "").trim();
  const after = rewrite.trim();

  const empty: RewriteDiff = {
    changed: false,
    tooLarge: false,
    segments: [],
    added: 0,
    removed: 0,
  };

  // Nothing to compare against, or the rewrite matches the original.
  if (before.length === 0 || before === after) {
    return empty;
  }

  const aTokens = tokenize(before);
  const bTokens = tokenize(after);

  if (aTokens.length > MAX_DIFF_TOKENS || bTokens.length > MAX_DIFF_TOKENS) {
    return { ...empty, changed: true, tooLarge: true };
  }

  const raw = lcsDiff(aTokens, bTokens);
  const segments = coalesce(raw);

  let added = 0;
  let removed = 0;
  for (const seg of raw) {
    if (isWhitespace(seg.value)) continue;
    if (seg.type === "added") added += 1;
    else if (seg.type === "removed") removed += 1;
  }

  return { changed: true, tooLarge: false, segments, added, removed };
}

/** The tokens to render for the "before" (original) view: equal + removed. */
export function beforeSegments(segments: DiffSegment[]): DiffSegment[] {
  return segments.filter((s) => s.type !== "added");
}

/** The tokens to render for the "after" (rewrite) view: equal + added. */
export function afterSegments(segments: DiffSegment[]): DiffSegment[] {
  return segments.filter((s) => s.type !== "removed");
}

/**
 * A token-level diff via longest-common-subsequence. Emits one `{type,value}`
 * per token; adjacent same-type tokens are merged by `coalesce`.
 */
function lcsDiff(a: string[], b: string[]): DiffSegment[] {
  const n = a.length;
  const m = b.length;

  // dp[i][j] = LCS length of a[i:] and b[j:].
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "equal", value: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "removed", value: a[i] });
      i++;
    } else {
      out.push({ type: "added", value: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ type: "removed", value: a[i++] });
  while (j < m) out.push({ type: "added", value: b[j++] });
  return out;
}

/** Merge consecutive segments of the same type into one for cleaner rendering. */
function coalesce(segments: DiffSegment[]): DiffSegment[] {
  const out: DiffSegment[] = [];
  for (const seg of segments) {
    const last = out[out.length - 1];
    if (last && last.type === seg.type) {
      last.value += seg.value;
    } else {
      out.push({ ...seg });
    }
  }
  return out;
}
