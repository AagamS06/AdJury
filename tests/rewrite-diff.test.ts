import { describe, it, expect } from "vitest";
import {
  afterSegments,
  beforeSegments,
  computeRewriteDiff,
  MAX_DIFF_TOKENS,
  tokenize,
  type DiffSegment,
} from "@/lib/reviews/rewrite-diff";

/**
 * Word-level before/after diff for the suggested-rewrite UX (DailyPlan Day 15).
 * The React panel is a thin wrapper over this pure logic (vitest env is node —
 * the repo tests the logic, not the DOM), so the correctness that matters — a
 * legible, reconstructable diff — is proven here.
 */

/** Reassemble a side of the diff back into text, to prove nothing is lost. */
function join(segments: DiffSegment[]): string {
  return segments.map((s) => s.value).join("");
}

describe("tokenize", () => {
  it("splits into whitespace and non-whitespace runs that rejoin exactly", () => {
    const text = "  Buy   now,\nfriend ";
    expect(tokenize(text).join("")).toBe(text);
  });

  it("returns an empty list for an empty string", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("computeRewriteDiff — unchanged cases", () => {
  it("reports no change when the original is missing", () => {
    const diff = computeRewriteDiff(null, "Anything at all.");
    expect(diff.changed).toBe(false);
    expect(diff.segments).toEqual([]);
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);
  });

  it("reports no change for a blank/whitespace original", () => {
    expect(computeRewriteDiff("   \n ", "New copy").changed).toBe(false);
  });

  it("reports no change when the rewrite equals the original (PRD §7 allows it)", () => {
    // Differ only by surrounding whitespace — trimmed, they match.
    expect(computeRewriteDiff("Ship it as-is.", "  Ship it as-is.  ").changed).toBe(
      false,
    );
  });
});

describe("computeRewriteDiff — word-level changes", () => {
  it("marks a replaced word as removed + added, keeping the shared words equal", () => {
    const diff = computeRewriteDiff(
      "The best sleep supplement.",
      "The finest sleep supplement.",
    );
    expect(diff.changed).toBe(true);
    expect(diff.tooLarge).toBe(false);
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);

    const types = diff.segments.map((s) => s.type);
    expect(types).toContain("equal");
    expect(types).toContain("added");
    expect(types).toContain("removed");
  });

  it("reconstructs the original from the before view and the rewrite from the after view", () => {
    const original = "Grab our new energy drink today.";
    const rewrite = "Grab our refreshing energy drink now.";
    const diff = computeRewriteDiff(original, rewrite);

    expect(join(beforeSegments(diff.segments)).trim()).toBe(original.trim());
    expect(join(afterSegments(diff.segments)).trim()).toBe(rewrite.trim());
  });

  it("counts a pure insertion as added only", () => {
    const diff = computeRewriteDiff("Sleep better.", "Sleep much better.");
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(0);
  });

  it("counts a pure deletion as removed only", () => {
    const diff = computeRewriteDiff("Sleep much better.", "Sleep better.");
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(1);
  });

  it("coalesces an added word and its trailing space into a single segment", () => {
    // "Sleep better." → "Sleep much better.": the shared words (and the space
    // between them) stay equal; the insertion is one added run of "much ".
    const diff = computeRewriteDiff("Sleep better.", "Sleep much better.");
    const added = diff.segments.filter((s) => s.type === "added");
    expect(added).toHaveLength(1);
    expect(added[0].value.trim()).toBe("much");
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(0);
  });
});

describe("computeRewriteDiff — size guardrail", () => {
  it("flags tooLarge and skips inline segments past the token cap", () => {
    const original = Array.from({ length: MAX_DIFF_TOKENS + 5 }, (_, i) => `w${i}`).join(
      " ",
    );
    const rewrite = original + " extra";
    const diff = computeRewriteDiff(original, rewrite);

    expect(diff.changed).toBe(true);
    expect(diff.tooLarge).toBe(true);
    expect(diff.segments).toEqual([]);
  });
});
