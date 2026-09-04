import { describe, it, expect } from "vitest";
import {
  CONFIDENCE_GUIDANCE,
  OUTPUT_CONTRACT,
  SHARED_ANCHORS,
} from "@/lib/ai/personas/base";
import { PERSONAS } from "@/lib/ai/personas";
import { PERSONA_NAMES } from "@/lib/schema/juror";

/**
 * Persona-wiring contract (DailyPlan Day 7 — Week 1 hardening).
 *
 * Persona prompts are code (Rules.md §3): changing one is a reviewed change, not
 * a live edit. These tests pin the wiring so a refactor can't silently drop a
 * juror, break the machine-name ↔ schema link, or omit the shared fragments
 * (anchors, the Day 7 confidence rubric, the JSON output contract) that keep the
 * five jurors comparable and their output valid against the schema.
 */

describe("PERSONAS wiring", () => {
  it("defines exactly the five schema personas in canonical order", () => {
    expect(PERSONAS.map((p) => p.name)).toEqual([...PERSONA_NAMES]);
  });

  it("has no duplicate persona machine-names", () => {
    const names = PERSONAS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every persona a human title and a one-line lens for the UI", () => {
    for (const p of PERSONAS) {
      expect(p.title.trim().length).toBeGreaterThan(0);
      expect(p.lens.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("each persona system prompt", () => {
  it.each(PERSONAS.map((p) => [p.name, p] as const))(
    "%s embeds its machine-name, the shared anchors, confidence rubric, and output contract",
    (name, persona) => {
      // The model is told to echo its own machine-name in the persona field;
      // the orchestrator also force-sets it, but the prompt must ask for it so a
      // live model returns a self-consistent object.
      expect(persona.systemPrompt).toContain(`"${name}"`);
      expect(persona.systemPrompt).toContain(SHARED_ANCHORS);
      expect(persona.systemPrompt).toContain(CONFIDENCE_GUIDANCE);
      expect(persona.systemPrompt).toContain(OUTPUT_CONTRACT);
    },
  );

  it("instructs JSON-only output and a required suggested_rewrite (PRD §7)", () => {
    // Guard the two contract rules most likely to be regressed in a prompt edit.
    expect(OUTPUT_CONTRACT).toMatch(/SINGLE JSON object/i);
    expect(OUTPUT_CONTRACT).toMatch(/suggested_rewrite.*required/is);
  });
});
