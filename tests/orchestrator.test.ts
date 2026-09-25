import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompleteArgs, ModelClient } from "@/lib/ai/client";
import { buildUserPrompt, runReview } from "@/lib/ai/orchestrator";
import { PERSONAS } from "@/lib/ai/personas";
import type { ResilienceOptions } from "@/lib/ai/resilience";
import type { PersonaName, ReviewInput } from "@/lib/schema/juror";
import { ReviewInputSchema } from "@/lib/schema/juror";

/**
 * Orchestrator integration hardening (DailyPlan Day 21 — Week 3 hardening).
 *
 * Week 3 layered three behaviours onto the fan-out that were only unit-tested in
 * isolation (Day 20 `buildUserPrompt`) or asserted via comments (Day 19). These
 * tests drive the *whole* `runReview` path with a recording client so the
 * cross-cutting invariants are proven end-to-end and can't silently regress:
 *  - platform guidance actually reaches the two platform-aware jurors' prompts;
 *  - the corrective JSON nudge is appended only after an *output* error, never
 *    after a transient provider failure (a nudge can't fix a dead connection);
 *  - the persona field is force-set to the juror we asked for.
 */

const ALL_PERSONAS = PERSONAS.map((p) => p.name);
const PLATFORM_BLOCK = "Platform-specific expectations for this juror";

// A no-wait resilience policy so transient-retry tests don't sleep on real time.
const FAST: Partial<ResilienceOptions> = {
  sleep: async () => {},
  baseDelayMs: 0,
  jitter: false,
};

function input(overrides: Partial<ReviewInput> = {}): ReviewInput {
  return ReviewInputSchema.parse({
    content_text: "Introducing our new all-in-one dashboard for busy teams.",
    content_type: "social_post",
    platform: "instagram",
    brand_context: null,
    ...overrides,
  });
}

function validJurorJson(
  persona: PersonaName,
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    persona,
    score: 8,
    confidence: "high",
    summary: "Reads cleanly on this lens.",
    issues: [],
    suggested_rewrite: "A sharper version of the same content.",
    ...overrides,
  });
}

/** A scripted response for one `complete` call: a string to return, or an error to throw. */
type Behavior = { return: string } | { throw: unknown };

/**
 * A recording model client. Captures every `complete` call and, when a
 * per-persona behavior queue is supplied, plays those behaviors in order
 * (falling back to a valid response once a queue is exhausted).
 */
function recordingClient(behaviors: Partial<Record<PersonaName, Behavior[]>> = {}) {
  const calls: CompleteArgs[] = [];
  const queues: Partial<Record<PersonaName, Behavior[]>> = {};
  for (const [persona, list] of Object.entries(behaviors)) {
    queues[persona as PersonaName] = [...(list ?? [])];
  }

  const client: ModelClient = {
    model: "test-model",
    isMock: true,
    async complete(args: CompleteArgs): Promise<string> {
      calls.push(args);
      const next = queues[args.persona]?.shift();
      if (next && "throw" in next) throw next.throw;
      if (next && "return" in next) return next.return;
      return validJurorJson(args.persona);
    },
  };

  const callsFor = (persona: PersonaName) => calls.filter((c) => c.persona === persona);
  return { client, calls, callsFor };
}

function transientError(status = 503): Error {
  return Object.assign(new Error(`provider ${status}`), { status });
}

describe("runReview — platform pass-through end-to-end (Day 20)", () => {
  it("injects platform guidance only into the SEO and stop-scrolling prompts", async () => {
    const { client, callsFor } = recordingClient();
    const review = await runReview(input({ platform: "instagram" }), {
      client,
      resilience: FAST,
    });

    expect(callsFor("seo_discoverability")[0].user).toContain(PLATFORM_BLOCK);
    expect(callsFor("stop_scrolling")[0].user).toContain(PLATFORM_BLOCK);
    for (const other of [
      "brand_voice_guardian",
      "compliance_legal_flagger",
      "target_audience_fit",
    ] as const) {
      expect(callsFor(other)[0].user).not.toContain(PLATFORM_BLOCK);
    }
    // The composed review still carries the platform through unchanged.
    expect(review.platform).toBe("instagram");
    // Sanity: the recorded prompt matches what buildUserPrompt produces.
    const seo = PERSONAS.find((p) => p.name === "seo_discoverability")!;
    expect(callsFor("seo_discoverability")[0].user).toBe(
      buildUserPrompt(input({ platform: "instagram" }), seo),
    );
  });

  it("injects no platform block for any juror when no platform is selected", async () => {
    const { client, callsFor } = recordingClient();
    await runReview(input({ platform: null }), { client, resilience: FAST });
    for (const name of ALL_PERSONAS) {
      expect(callsFor(name)[0].user).not.toContain(PLATFORM_BLOCK);
    }
  });

  it("sends every juror the shared calibration fragments in its system prompt", async () => {
    const { client, callsFor } = recordingClient();
    await runReview(input(), { client, resilience: FAST });
    for (const name of ALL_PERSONAS) {
      const system = callsFor(name)[0].system;
      expect(system).toContain("Confidence guidance");
      expect(system).toContain("Suggested-rewrite guidance");
    }
  });
});

describe("runReview — brand context is scoped to the Brand Voice Guardian (Day 27)", () => {
  const BRAND_LINE = "Brand context / style guide:";
  const NO_BRAND_NOTE = "No brand context provided";
  const GUIDE = "Tone: measured, expert, trustworthy. Avoid hype and slang.";

  it("injects the stored guide into ONLY the brand juror's prompt", async () => {
    const { client, callsFor } = recordingClient();
    await runReview(input({ brand_context: GUIDE }), { client, resilience: FAST });

    const brandPrompt = callsFor("brand_voice_guardian")[0].user;
    expect(brandPrompt).toContain(BRAND_LINE);
    expect(brandPrompt).toContain(GUIDE);

    // No other juror sees the guide text or any brand block — brand voice is
    // juror 1's lens alone (Rules.md §3), and sending it to all five would waste
    // tokens on lenses that ignore it (Rules.md §1).
    for (const other of [
      "compliance_legal_flagger",
      "target_audience_fit",
      "seo_discoverability",
      "stop_scrolling",
    ] as const) {
      const prompt = callsFor(other)[0].user;
      expect(prompt).not.toContain(BRAND_LINE);
      expect(prompt).not.toContain(GUIDE);
      expect(prompt).not.toContain(NO_BRAND_NOTE);
    }
  });

  it("tells only the brand juror to infer a baseline when no guide is stored", async () => {
    const { client, callsFor } = recordingClient();
    await runReview(input({ brand_context: null }), { client, resilience: FAST });

    expect(callsFor("brand_voice_guardian")[0].user).toContain(NO_BRAND_NOTE);
    for (const other of [
      "compliance_legal_flagger",
      "target_audience_fit",
      "seo_discoverability",
      "stop_scrolling",
    ] as const) {
      expect(callsFor(other)[0].user).not.toContain(NO_BRAND_NOTE);
    }
  });

  it("matches what buildUserPrompt produces for the brand juror", async () => {
    const { client, callsFor } = recordingClient();
    const reviewInput = input({ brand_context: GUIDE });
    await runReview(reviewInput, { client, resilience: FAST });
    const brand = PERSONAS.find((p) => p.name === "brand_voice_guardian")!;
    expect(callsFor("brand_voice_guardian")[0].user).toBe(
      buildUserPrompt(reviewInput, brand),
    );
  });
});

describe("runReview — corrective nudge is output-only (Day 19)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("appends the nudge on the retry after invalid JSON, then recovers", async () => {
    const { client, callsFor } = recordingClient({
      brand_voice_guardian: [{ return: "not valid json at all" }],
    });
    const review = await runReview(input(), { client, resilience: FAST });

    const calls = callsFor("brand_voice_guardian");
    // Exactly two calls: the failed parse, then one corrective retry.
    expect(calls).toHaveLength(2);
    expect(calls[0].user).not.toContain("not valid JSON");
    expect(calls[1].user).toContain("Return ONLY the JSON object");
    // The juror recovered to a real result, not an error slot.
    const slot = review.jurors.find((j) => j.persona === "brand_voice_guardian")!;
    expect(slot.status).toBe("ok");
  });

  it("does NOT append the nudge when a transient provider error is retried", async () => {
    // First call throws a retryable 503; callWithResilience retries the SAME
    // prompt internally — the output was never the problem, so no nudge.
    const { client, callsFor } = recordingClient({
      seo_discoverability: [{ throw: transientError(503) }],
    });
    const review = await runReview(input(), { client, resilience: FAST });

    const calls = callsFor("seo_discoverability");
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const c of calls) {
      expect(c.user).not.toContain("Return ONLY the JSON object");
    }
    const slot = review.jurors.find((j) => j.persona === "seo_discoverability")!;
    expect(slot.status).toBe("ok");
  });

  it("degrades a juror to a clean error slot after its retries are exhausted", async () => {
    // Invalid JSON on both the first call and the corrective retry → error slot,
    // while every other juror still returns ok.
    const { client } = recordingClient({
      compliance_legal_flagger: [{ return: "nope" }, { return: "still nope" }],
    });
    const review = await runReview(input(), { client, resilience: FAST });

    const compliance = review.jurors.find(
      (j) => j.persona === "compliance_legal_flagger",
    )!;
    expect(compliance.status).toBe("error");
    if (compliance.status === "error") {
      expect(compliance.error).toBe("invalid model output (not JSON)");
    }
    expect(review.jurors.filter((j) => j.status === "ok")).toHaveLength(4);
  });
});

describe("runReview — persona field is authoritative", () => {
  it("forces each slot's persona to the juror we asked for, even if the model echoes a different one", async () => {
    // Every juror returns a VALID object, but all claim to be the brand-voice
    // juror. The orchestrator must overwrite persona with the one it requested.
    const { client } = recordingClient(
      Object.fromEntries(
        ALL_PERSONAS.map((name) => [
          name,
          [{ return: validJurorJson("brand_voice_guardian") }],
        ]),
      ),
    );
    const review = await runReview(input(), { client, resilience: FAST });

    expect(review.jurors.map((j) => j.persona)).toEqual(ALL_PERSONAS);
    for (const slot of review.jurors) {
      expect(slot.status).toBe("ok");
    }
  });
});
