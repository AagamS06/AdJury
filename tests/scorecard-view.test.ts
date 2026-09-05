import { describe, it, expect } from "vitest";
import {
  confidenceLabel,
  formatAggregate,
  scoreTone,
  severityLabel,
  verdictLabel,
  verdictTone,
} from "@/lib/reviews/scorecard-view";

/**
 * Pure presentation logic for the Scorecard / JurorCard (DailyPlan Day 9),
 * exercised without a browser. The React components are thin wrappers over
 * these mappings (the repo tests the logic, not the DOM — vitest env is node).
 */

describe("formatAggregate", () => {
  it("renders one decimal place", () => {
    expect(formatAggregate(7)).toBe("7.0");
    expect(formatAggregate(7.25)).toBe("7.3");
    expect(formatAggregate(0)).toBe("0.0");
  });

  it("renders an em dash for a not-scored (null) review", () => {
    expect(formatAggregate(null)).toBe("—");
  });
});

describe("verdictLabel", () => {
  it("labels each verdict with its word", () => {
    expect(verdictLabel("pass")).toBe("Pass");
    expect(verdictLabel("revise")).toBe("Revise");
    expect(verdictLabel("fail")).toBe("Fail");
  });

  it("falls back to a neutral label when not scored", () => {
    expect(verdictLabel(null)).toBe("Not scored");
  });
});

describe("verdictTone", () => {
  it("maps verdicts to Design.md §5 pill tones", () => {
    expect(verdictTone("pass")).toBe("success");
    expect(verdictTone("revise")).toBe("warning");
    expect(verdictTone("fail")).toBe("danger");
    expect(verdictTone(null)).toBe("neutral");
  });
});

describe("scoreTone", () => {
  it("maps score bands to tones", () => {
    expect(scoreTone(10)).toBe("success");
    expect(scoreTone(9)).toBe("success");
    expect(scoreTone(8)).toBe("royal");
    expect(scoreTone(7)).toBe("royal");
    expect(scoreTone(6)).toBe("warning");
    expect(scoreTone(5)).toBe("warning");
    expect(scoreTone(4)).toBe("danger");
    expect(scoreTone(0)).toBe("danger");
  });
});

describe("severityLabel", () => {
  it("capitalises the severity word", () => {
    expect(severityLabel("high")).toBe("High");
    expect(severityLabel("medium")).toBe("Medium");
    expect(severityLabel("low")).toBe("Low");
  });
});

describe("confidenceLabel", () => {
  it("renders a screen-reader-friendly confidence label", () => {
    expect(confidenceLabel("high")).toBe("High confidence");
    expect(confidenceLabel("medium")).toBe("Medium confidence");
    expect(confidenceLabel("low")).toBe("Low confidence");
  });
});
