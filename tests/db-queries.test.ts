import { describe, it, expect } from "vitest";
import { jurorSlotToScoreRow } from "@/lib/db/queries";
import type { JurorSlot } from "@/lib/schema/juror";

/**
 * The DB write path maps composed juror slots to persona_scores rows. This is
 * the one piece of queries.ts that is pure (no Supabase), so it is unit-tested
 * here; the full round-trip against a real DB is covered by scripts/db-smoke.ts.
 */
describe("jurorSlotToScoreRow", () => {
  const REVIEW_ID = "00000000-0000-0000-0000-000000000001";

  it("maps an ok juror to a complete score row", () => {
    const slot: JurorSlot = {
      persona: "brand_voice_guardian",
      score: 8,
      confidence: "high",
      summary: "On-brand and confident.",
      issues: [
        { severity: "medium", excerpt: "best ever", explanation: "Hyperbolic." },
      ],
      suggested_rewrite: "One of the most effective tools we tested.",
      status: "ok",
    };

    const row = jurorSlotToScoreRow(REVIEW_ID, slot);

    expect(row).toEqual({
      review_id: REVIEW_ID,
      persona_name: "brand_voice_guardian",
      score: 8,
      confidence: "high",
      feedback_text: "On-brand and confident.",
      issues_json: slot.issues,
      suggested_rewrite: "One of the most effective tools we tested.",
      status: "ok",
    });
  });

  it("maps an error juror to a null-scored row that keeps the persona and reason", () => {
    const slot: JurorSlot = {
      persona: "seo_discoverability",
      status: "error",
      error: "invalid JSON after retry",
    };

    const row = jurorSlotToScoreRow(REVIEW_ID, slot);

    expect(row.status).toBe("error");
    expect(row.persona_name).toBe("seo_discoverability");
    expect(row.score).toBeNull();
    expect(row.confidence).toBeNull();
    expect(row.suggested_rewrite).toBeNull();
    expect(row.issues_json).toEqual([]);
    expect(row.feedback_text).toBe("invalid JSON after retry");
  });
});
