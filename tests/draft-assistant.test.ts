import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AdDraftSchema,
  DRAFT_DISCLAIMER,
  MAX_DRAFT_VARIANTS,
  MAX_KEY_MESSAGE_CHARS,
  MIN_DRAFT_VARIANTS,
  buildDraftPrompt,
  checkDraftBrief,
  composeOfflineDrafts,
  generateDrafts,
  modelDraftGenerator,
  offlineDraftGenerator,
  type DraftBrief,
  type DraftGenerator,
} from "@/lib/draft/draft-assistant";
import {
  buildDraftAssistantReadiness,
  findJuryImports,
  reconcileDraftAssistant,
  sampleDraftBrief,
} from "@/lib/draft/draft-assistant-readiness";
import { getModelClient, type ModelClient } from "@/lib/ai/client";

/**
 * Draft Assistant (DailyPlan Day 87) — the one deliberate, *separate* generation
 * mode (PRD §6.3). AdJury stays a QA layer: these tests pin the brief guard, the
 * deterministic + honest offline generator, the jury-separation invariant (the
 * core imports neither the orchestrator nor any persona), the model-output
 * validation, and the reconcile/readiness.
 */

function brief(overrides: Partial<DraftBrief> = {}): DraftBrief {
  return { ...sampleDraftBrief(), ...overrides };
}

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const coreSource = readFileSync(`${repoRoot}/src/lib/draft/draft-assistant.ts`, "utf8");

describe("checkDraftBrief", () => {
  it("accepts a well-formed brief", () => {
    expect(checkDraftBrief(brief())).toEqual({ ok: true });
  });

  it("rejects each missing required field", () => {
    for (const field of ["product", "audience", "keyMessage"] as const) {
      const d = checkDraftBrief(brief({ [field]: "   " } as Partial<DraftBrief>));
      expect(d.ok).toBe(false);
      if (!d.ok) {
        expect(d.code).toBe("missing_field");
        if (d.code === "missing_field") expect(d.field).toBe(field);
      }
    }
  });

  it("rejects an over-long field", () => {
    const d = checkDraftBrief(brief({ keyMessage: "x".repeat(MAX_KEY_MESSAGE_CHARS + 1) }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("field_too_long");
  });

  it("rejects too many must-include / must-avoid items", () => {
    const d = checkDraftBrief(brief({ mustInclude: Array.from({ length: 9 }, (_, i) => `p${i}`) }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("too_many_constraints");
  });

  it("rejects an out-of-range or non-integer variant count", () => {
    for (const variants of [MIN_DRAFT_VARIANTS - 1, MAX_DRAFT_VARIANTS + 1, 2.5]) {
      const d = checkDraftBrief(brief({ variants }));
      expect(d.ok).toBe(false);
      if (!d.ok) expect(d.code).toBe("variants_out_of_range");
    }
  });

  it("rejects a must-avoid term that also appears in the brief's own copy", () => {
    const d = checkDraftBrief(brief({ product: "a sleep aid", mustAvoid: ["sleep"] }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.code).toBe("contradictory_constraint");
  });
});

describe("offline generator", () => {
  it("is deterministic and produces exactly the requested count with distinct labels", () => {
    const b = brief({ variants: 4 });
    const a = composeOfflineDrafts(b);
    const c = composeOfflineDrafts(b);
    expect(a).toEqual(c);
    expect(a).toHaveLength(4);
    expect(new Set(a.map((d) => d.variantLabel)).size).toBe(4);
    for (const draft of a) expect(AdDraftSchema.safeParse(draft).success).toBe(true);
  });

  it("invents no number that is not in the brief", () => {
    const drafts = composeOfflineDrafts(brief());
    const briefDigits = new Set(
      (sampleDraftBrief().keyMessage.match(/\d+/g) ?? []),
    );
    for (const draft of drafts) {
      const nums = `${draft.headline} ${draft.body} ${draft.cta}`.match(/\d+/g) ?? [];
      for (const n of nums) expect(briefDigits.has(n)).toBe(true);
    }
  });

  it("includes every must-include phrase (non-social) and never a must-avoid term", () => {
    const drafts = composeOfflineDrafts(brief({ content_type: "email", mustInclude: ["Free returns"], mustAvoid: ["cure"] }));
    for (const draft of drafts) {
      const copy = `${draft.headline} ${draft.body} ${draft.cta}`;
      expect(copy).toContain("Free returns");
      expect(copy.toLowerCase()).not.toContain("cure");
    }
  });

  it("keeps a social post to the hook (does not append must-include)", () => {
    const drafts = composeOfflineDrafts(brief({ content_type: "social_post", mustInclude: ["Free returns"] }));
    // The social body stays short — the must-include phrase is not force-appended.
    expect(drafts.some((d) => !d.body.includes("Free returns"))).toBe(true);
  });

  it("carries no juror-result fields", () => {
    for (const draft of composeOfflineDrafts(brief())) {
      for (const field of ["score", "verdict", "confidence", "persona", "issues"]) {
        expect(field in (draft as unknown as Record<string, unknown>)).toBe(false);
      }
    }
  });
});

describe("generateDrafts", () => {
  it("wraps drafts with the offline provenance and the standing disclaimer", async () => {
    const r = await generateDrafts(brief());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.generator).toBe("offline");
      expect(r.result.disclaimer).toBe(DRAFT_DISCLAIMER);
      expect(r.result.drafts).toHaveLength(brief().variants);
    }
  });

  it("propagates a brief rejection without generating", async () => {
    const r = await generateDrafts(brief({ product: "" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("missing_field");
  });

  it("records a custom generator's name", async () => {
    const stub: DraftGenerator = {
      name: "stub-model",
      generate: () => [
        { variantLabel: "Variant A", angle: "test", headline: "H", body: "B", cta: "Go" },
      ],
    };
    const r = await generateDrafts(brief(), { generator: stub });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.generator).toBe("stub-model");
  });
});

describe("the disclaimer keeps the QA-layer identity honest", () => {
  it("says drafts are not a review, are not auto-graded, and names the product", () => {
    expect(DRAFT_DISCLAIMER.toLowerCase()).toContain("not a review");
    expect(DRAFT_DISCLAIMER.toLowerCase()).toMatch(/grade/);
    expect(DRAFT_DISCLAIMER).toContain("AdJury");
  });
});

describe("jury separation (the load-bearing invariant)", () => {
  it("the real core imports neither the orchestrator nor any persona", () => {
    expect(findJuryImports(coreSource)).toEqual([]);
  });

  it("catches a planted jury import (non-vacuous)", () => {
    const planted = 'import { runReview } from "@/lib/ai/orchestrator";\n';
    expect(findJuryImports(planted)).toContain("@/lib/ai/orchestrator");
    expect(findJuryImports('import { PERSONAS } from "@/lib/ai/personas";')).toContain(
      "@/lib/ai/personas",
    );
  });

  it("does not false-positive on jury mentions in comments/prose", () => {
    const prose = "// This module never calls runReview or imports @/lib/ai/personas.\nconst x = 1;\n";
    expect(findJuryImports(prose)).toEqual([]);
  });
});

describe("model-backed generator (live seam)", () => {
  function fakeClient(response: string): ModelClient {
    return {
      model: "claude-test",
      isMock: false,
      complete: async () => response,
    };
  }

  it("refuses to run on the offline mock", async () => {
    const mock = getModelClient(); // no key in CI → mock
    expect(mock.isMock).toBe(true);
    await expect(modelDraftGenerator(mock).generate(brief())).rejects.toThrow(/offline mock/i);
  });

  it("validates, clamps to the variant count, and drops must-avoid output", async () => {
    const payload = JSON.stringify([
      { variantLabel: "Variant A", angle: "benefit-led", headline: "Good one", body: "Clean body", cta: "Learn more" },
      { variantLabel: "Variant B", angle: "outcome", headline: "Has cure word", body: "This cure is bad", cta: "Go" },
      { variantLabel: "Variant C", angle: "direct", headline: "Third", body: "Also clean", cta: "See" },
    ]);
    const gen = modelDraftGenerator(fakeClient(payload));
    const drafts = await gen.generate(brief({ variants: 2, mustAvoid: ["cure"] }));
    // The "cure" draft is dropped; result is clamped to the requested 2.
    expect(drafts.length).toBeLessThanOrEqual(2);
    expect(drafts.every((d) => !`${d.headline} ${d.body}`.toLowerCase().includes("cure"))).toBe(true);
  });

  it("rejects malformed model output", async () => {
    const gen = modelDraftGenerator(fakeClient("not json"));
    await expect(gen.generate(brief())).rejects.toThrow();
  });

  it("builds a prompt that carries every brief field", () => {
    const p = buildDraftPrompt(brief());
    expect(p).toContain("Product");
    expect(p).toContain("Audience");
    expect(p).toContain("Key message");
    expect(p).toContain("Must avoid");
  });
});

describe("the offline mock rejects a non-juror (persona-less) call", () => {
  it("throws rather than returning juror-shaped output", async () => {
    const mock = getModelClient();
    expect(mock.isMock).toBe(true);
    await expect(mock.complete({ system: "s", user: "u" })).rejects.toThrow(/juror/i);
    // A juror call (with a persona) still works as before.
    const out = await mock.complete({ system: "s", user: "u", persona: "brand_voice_guardian" });
    expect(() => JSON.parse(out)).not.toThrow();
  });
});

describe("reconcile + readiness", () => {
  it("the sample reconciles clean", () => {
    expect(reconcileDraftAssistant()).toEqual({ clean: true, failures: [] });
  });

  it("reconcile is non-vacuous: a bad brief fails it", () => {
    const r = reconcileDraftAssistant(brief({ variants: 99 }));
    expect(r.clean).toBe(false);
    expect(r.failures.length).toBeGreaterThan(0);
  });

  it("readiness is ready with the real source and reports the manual steps", () => {
    const r = buildDraftAssistantReadiness(coreSource);
    expect(r.ready).toBe(true);
    expect(r.manualSteps).toBe(2);
    const sep = r.items.find((i) => i.title.includes("separate from the jury"));
    expect(sep?.status).toBe("ready");
  });

  it("readiness flips to not-ready if the core becomes coupled to the jury", () => {
    const coupled = `${coreSource}\nimport { runReview } from "@/lib/ai/orchestrator";\n`;
    const r = buildDraftAssistantReadiness(coupled);
    expect(r.ready).toBe(false);
  });
});
