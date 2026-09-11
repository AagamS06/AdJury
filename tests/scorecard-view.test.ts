import { describe, it, expect } from "vitest";
import {
  confidenceLabel,
  formatAggregate,
  hasComplianceFlags,
  issueTone,
  jurorHealthNotice,
  jurorScoreTone,
  scoreTierLabel,
  scoreTone,
  severityLabel,
  summarizeJurorHealth,
  verdictLabel,
  verdictTone,
} from "@/lib/reviews/scorecard-view";
import type { JurorSlot } from "@/lib/schema/juror";

/**
 * Pure presentation logic for the Scorecard / JurorCard (DailyPlan Days 9–10),
 * exercised without a browser. The React components are thin wrappers over
 * these mappings (the repo tests the logic, not the DOM — vitest env is node).
 */

/** A minimal valid `ok` juror slot; override fields per test. */
function okJuror(over: Partial<Extract<JurorSlot, { status: "ok" }>> = {}): JurorSlot {
  return {
    persona: "brand_voice_guardian",
    status: "ok",
    score: 8,
    confidence: "high",
    summary: "ok",
    issues: [],
    suggested_rewrite: "rewrite",
    ...over,
  };
}

/** An errored juror slot (Rules.md §6): the model failed to return valid JSON. */
function errorJuror(
  persona: JurorSlot["persona"] = "seo_discoverability",
): JurorSlot {
  return { persona, status: "error", error: "bad json" };
}

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
  it("maps score bands to the full 5-tier Design.md §5 mapping", () => {
    expect(scoreTone(10)).toBe("success");
    expect(scoreTone(9)).toBe("success");
    expect(scoreTone(8)).toBe("royal");
    expect(scoreTone(7)).toBe("royal");
    expect(scoreTone(6)).toBe("warning");
    expect(scoreTone(5)).toBe("warning");
    // 3–4 is the distinct "warning-deep" tier (added Day 10), not danger.
    expect(scoreTone(4)).toBe("warning-deep");
    expect(scoreTone(3)).toBe("warning-deep");
    expect(scoreTone(2)).toBe("danger");
    expect(scoreTone(0)).toBe("danger");
  });
});

describe("scoreTierLabel", () => {
  it("gives every band a paired text label (never colour-only)", () => {
    expect(scoreTierLabel(10)).toBe("Excellent");
    expect(scoreTierLabel(9)).toBe("Excellent");
    expect(scoreTierLabel(8)).toBe("Strong");
    expect(scoreTierLabel(7)).toBe("Strong");
    expect(scoreTierLabel(6)).toBe("Mixed");
    expect(scoreTierLabel(5)).toBe("Mixed");
    expect(scoreTierLabel(4)).toBe("Weak");
    expect(scoreTierLabel(3)).toBe("Weak");
    expect(scoreTierLabel(2)).toBe("Failing");
    expect(scoreTierLabel(0)).toBe("Failing");
  });
});

describe("hasComplianceFlags", () => {
  it("is true only for a scored compliance juror with at least one issue", () => {
    expect(
      hasComplianceFlags(
        okJuror({
          persona: "compliance_legal_flagger",
          issues: [{ severity: "high", excerpt: "x", explanation: "y" }],
        }),
      ),
    ).toBe(true);
  });

  it("is false for a clean compliance pass (no issues)", () => {
    expect(
      hasComplianceFlags(
        okJuror({ persona: "compliance_legal_flagger", issues: [] }),
      ),
    ).toBe(false);
  });

  it("is false for a non-compliance juror, even with issues", () => {
    expect(
      hasComplianceFlags(
        okJuror({
          persona: "brand_voice_guardian",
          issues: [{ severity: "high", excerpt: "x", explanation: "y" }],
        }),
      ),
    ).toBe(false);
  });

  it("is false for an errored juror slot", () => {
    expect(
      hasComplianceFlags({
        persona: "compliance_legal_flagger",
        status: "error",
        error: "bad json",
      }),
    ).toBe(false);
  });
});

describe("jurorScoreTone", () => {
  it("uses the score band for an ordinary juror", () => {
    expect(jurorScoreTone(okJuror({ score: 8 }))).toBe("royal");
    expect(jurorScoreTone(okJuror({ score: 4 }))).toBe("warning-deep");
  });

  it("overrides to burgundy when the compliance juror flags issues, whatever the score", () => {
    expect(
      jurorScoreTone(
        okJuror({
          persona: "compliance_legal_flagger",
          score: 10,
          issues: [{ severity: "high", excerpt: "x", explanation: "y" }],
        }),
      ),
    ).toBe("burgundy");
  });

  it("keeps the score band for a clean compliance pass", () => {
    expect(
      jurorScoreTone(
        okJuror({ persona: "compliance_legal_flagger", score: 9, issues: [] }),
      ),
    ).toBe("success");
  });

  it("is neutral for an errored slot (no score to colour)", () => {
    expect(
      jurorScoreTone({
        persona: "seo_discoverability",
        status: "error",
        error: "bad json",
      }),
    ).toBe("neutral");
  });
});

describe("issueTone", () => {
  it("maps severities to tones for issue styling", () => {
    expect(issueTone("high")).toBe("danger");
    expect(issueTone("medium")).toBe("warning");
    expect(issueTone("low")).toBe("neutral");
  });

  it("overrides every severity to burgundy for a compliance flag", () => {
    expect(issueTone("high", true)).toBe("burgundy");
    expect(issueTone("medium", true)).toBe("burgundy");
    expect(issueTone("low", true)).toBe("burgundy");
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

describe("summarizeJurorHealth", () => {
  it("counts scored vs. errored slots with all jurors healthy", () => {
    const health = summarizeJurorHealth([okJuror(), okJuror(), okJuror()]);
    expect(health).toEqual({
      total: 3,
      scored: 3,
      errored: 0,
      allErrored: false,
      someErrored: false,
    });
  });

  it("flags a partial failure as someErrored (not allErrored)", () => {
    const health = summarizeJurorHealth([okJuror(), errorJuror(), okJuror()]);
    expect(health).toMatchObject({
      total: 3,
      scored: 2,
      errored: 1,
      allErrored: false,
      someErrored: true,
    });
  });

  it("flags allErrored only when every slot failed", () => {
    const health = summarizeJurorHealth([errorJuror(), errorJuror()]);
    expect(health).toMatchObject({
      total: 2,
      scored: 0,
      errored: 2,
      allErrored: true,
      someErrored: false,
    });
  });

  it("treats an empty juror list as neither all- nor some-errored", () => {
    const health = summarizeJurorHealth([]);
    expect(health).toEqual({
      total: 0,
      scored: 0,
      errored: 0,
      allErrored: false,
      someErrored: false,
    });
  });
});

describe("jurorHealthNotice", () => {
  it("returns null when every juror scored (no banner)", () => {
    expect(jurorHealthNotice(summarizeJurorHealth([okJuror(), okJuror()]))).toBeNull();
  });

  it("warns, with counts, when some jurors errored", () => {
    const notice = jurorHealthNotice(
      summarizeJurorHealth([okJuror(), errorJuror(), okJuror(), okJuror(), okJuror()]),
    );
    expect(notice?.tone).toBe("warning");
    expect(notice?.message).toContain("1 of 5 jurors couldn't be scored");
  });

  it("agrees the noun with the total for a single failure", () => {
    const notice = jurorHealthNotice(
      summarizeJurorHealth([okJuror(), errorJuror()]),
    );
    expect(notice?.message).toContain("1 of 2 jurors couldn't be scored");
  });

  it("counts multiple failures", () => {
    const notice = jurorHealthNotice(
      summarizeJurorHealth([okJuror(), errorJuror(), errorJuror()]),
    );
    expect(notice?.message).toContain("2 of 3 jurors couldn't be scored");
  });

  it("raises a danger banner when all jurors errored", () => {
    const notice = jurorHealthNotice(
      summarizeJurorHealth([errorJuror(), errorJuror(), errorJuror()]),
    );
    expect(notice?.tone).toBe("danger");
    expect(notice?.message).toContain("None of the 3 jurors could be scored");
  });

  it("raises a danger banner for a review with no jurors at all", () => {
    const notice = jurorHealthNotice(summarizeJurorHealth([]));
    expect(notice?.tone).toBe("danger");
    expect(notice?.message).toContain("no juror results");
  });
});
