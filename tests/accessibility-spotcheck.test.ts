import { describe, it, expect } from "vitest";
import {
  confidenceLabel,
  issueTone,
  jurorHealthNotice,
  scoreTierLabel,
  scoreTone,
  severityLabel,
  summarizeJurorHealth,
  verdictLabel,
  verdictTone,
  type Tone,
} from "@/lib/reviews/scorecard-view";
import { toHistoryRow } from "@/lib/reviews/history-view";
import type { ReviewSummary } from "@/lib/reviews/read-reviews";
import {
  BADGE_CLASSES,
  CHIP_CLASSES,
  ISSUE_BORDER_CLASSES,
  PILL_CLASSES,
} from "@/components/review/tone-classes";
import type { Severity, Verdict } from "@/lib/schema/juror";

/**
 * Week 2 accessibility & consistency spot-check (DailyPlan Day 14), made durable
 * as executable invariants rather than a one-off manual pass.
 *
 * The core Design.md §6 rule is that **meaning is never encoded in colour
 * alone** — every verdict, score band, and severity that the scorecard / history
 * table can render must always ship a paired text label, and every semantic
 * `Tone` must map to a real (non-empty) class so a signal never renders
 * style-less. The components carry the paired labels in markup (asserted by
 * reading the JSX in review); these tests pin the *logic* those labels and
 * colours come from, exhaustively over every possible value, so a future change
 * that drops a label or a tone mapping fails here.
 */

/** The full semantic tone union — kept in sync with `scorecard-view.ts`. */
const ALL_TONES: Tone[] = [
  "success",
  "royal",
  "warning",
  "warning-deep",
  "danger",
  "burgundy",
  "neutral",
];

const ALL_VERDICTS: Array<Verdict | null> = ["pass", "revise", "fail", null];
const ALL_SEVERITIES: Severity[] = ["high", "medium", "low"];
const ALL_CONFIDENCES = ["high", "medium", "low"] as const;

describe("colour never travels alone: every score band carries a tier word", () => {
  it("gives every integer score 0–10 a tone and a non-empty paired tier label", () => {
    for (let score = 0; score <= 10; score++) {
      const tone = scoreTone(score);
      const label = scoreTierLabel(score);
      expect(ALL_TONES).toContain(tone);
      // The chip shows the number + this word, so the band is legible without colour.
      expect(label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("colour never travels alone: every verdict carries its word", () => {
  it("gives every verdict (incl. not-scored) a non-empty label and a mapped tone", () => {
    for (const verdict of ALL_VERDICTS) {
      const label = verdictLabel(verdict);
      const tone = verdictTone(verdict);
      expect(label.trim().length).toBeGreaterThan(0);
      expect(ALL_TONES).toContain(tone);
    }
  });

  it("uses a neutral tone only for the not-scored verdict, which still has a word", () => {
    expect(verdictTone(null)).toBe("neutral");
    expect(verdictLabel(null)).toBe("Not scored");
    // Every *real* verdict reads in a decisive (non-neutral) tone.
    for (const verdict of ["pass", "revise", "fail"] as const) {
      expect(verdictTone(verdict)).not.toBe("neutral");
    }
  });
});

describe("colour never travels alone: every severity carries its word", () => {
  it("gives every severity a non-empty label and a mapped tone (plain + compliance)", () => {
    for (const severity of ALL_SEVERITIES) {
      expect(severityLabel(severity).trim().length).toBeGreaterThan(0);
      expect(ALL_TONES).toContain(issueTone(severity));
      // The compliance override still resolves to a real tone.
      expect(ALL_TONES).toContain(issueTone(severity, true));
    }
  });
});

describe("confidence is always announced in words", () => {
  it("labels every confidence level for the juror header", () => {
    for (const confidence of ALL_CONFIDENCES) {
      const label = confidenceLabel(confidence);
      expect(label.toLowerCase()).toContain("confidence");
      expect(label.toLowerCase()).toContain(confidence);
    }
  });
});

describe("every semantic tone maps to a real class (no style-less signal)", () => {
  const MAPS: Array<[string, Record<Tone, string>]> = [
    ["PILL_CLASSES", PILL_CLASSES],
    ["CHIP_CLASSES", CHIP_CLASSES],
    ["BADGE_CLASSES", BADGE_CLASSES],
    ["ISSUE_BORDER_CLASSES", ISSUE_BORDER_CLASSES],
  ];

  for (const [name, map] of MAPS) {
    it(`${name} has a non-empty class for every tone`, () => {
      for (const tone of ALL_TONES) {
        expect(map[tone], `${name} is missing a class for tone "${tone}"`).toBeTruthy();
        expect(map[tone].trim().length).toBeGreaterThan(0);
      }
      // No stray keys beyond the known tones (a removed tone would be caught above).
      expect(Object.keys(map).sort()).toEqual([...ALL_TONES].sort());
    });
  }
});

describe("degraded-review notice always carries a message, never colour alone", () => {
  it("pairs every notice tone with non-empty message text", () => {
    // some-errored → warning; all-errored and empty → danger.
    const partial = jurorHealthNotice(
      summarizeJurorHealth([
        { persona: "brand_voice_guardian", status: "error", error: "x" },
        {
          persona: "seo_discoverability",
          status: "ok",
          score: 8,
          confidence: "high",
          summary: "ok",
          issues: [],
          suggested_rewrite: "r",
        },
      ]),
    );
    expect(partial?.tone).toBe("warning");
    expect((partial?.message ?? "").trim().length).toBeGreaterThan(0);

    const none = jurorHealthNotice(summarizeJurorHealth([]));
    expect(none?.tone).toBe("danger");
    expect((none?.message ?? "").trim().length).toBeGreaterThan(0);
  });
});

describe("history and scorecard read a review consistently (shared helpers)", () => {
  function summary(overrides: Partial<ReviewSummary> = {}): ReviewSummary {
    return {
      review_id: "rev-1",
      content_type: "ad_copy",
      platform: "instagram",
      aggregate_score: 7.2,
      verdict: "revise",
      created_at: "2026-09-01T00:00:00.000Z",
      ...overrides,
    };
  }

  it("derives the same verdict word + tone a scorecard would, for every verdict", () => {
    for (const verdict of ALL_VERDICTS) {
      const row = toHistoryRow(summary({ verdict }));
      expect(row.verdict).toBe(verdictLabel(verdict));
      expect(row.verdictTone).toBe(verdictTone(verdict));
    }
  });

  it("derives the same score chip tone + tier word a scorecard would", () => {
    const row = toHistoryRow(summary({ aggregate_score: 3.5 }));
    expect(row.aggregateTone).toBe(scoreTone(3.5));
    expect(row.aggregateTierLabel).toBe(scoreTierLabel(3.5));
  });
});
