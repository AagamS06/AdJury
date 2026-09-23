import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { ModelClient } from "@/lib/ai/client";
import type { SessionContext } from "@/lib/auth/session";
import type { InsertReviewParams } from "@/lib/db/queries";
import { createReview } from "@/lib/reviews/create-review";
import { PERSONA_NAMES } from "@/lib/schema/juror";
import type { BrandProfileRow, ReviewWithScores } from "@/types/db";

/**
 * Endpoint logic for POST /api/reviews (DailyPlan Day 5), exercised with the
 * offline mock model client and an injected persist stub — no network, no DB.
 * The route handler itself is a thin wrapper that only wires real dependencies
 * and maps the outcome to an HTTP response.
 */

const SESSION: SessionContext = {
  authUserId: "11111111-1111-1111-1111-111111111111",
  email: "admin@acme.test",
  companyId: "22222222-2222-2222-2222-222222222222",
  role: "admin",
  company: {
    id: "22222222-2222-2222-2222-222222222222",
    name: "Acme",
    industry: null,
    plan_tier: "free",
    juror_weights: null,
    onboarded_at: "2026-08-31T00:00:00.000Z",
    created_at: "2026-08-31T00:00:00.000Z",
  },
};

/** A persist stub that records the params it was called with. */
function recordingPersist() {
  const calls: InsertReviewParams[] = [];
  const persist = async (params: InsertReviewParams): Promise<ReviewWithScores> => {
    calls.push(params);
    return {
      review: {
        id: params.review.review_id,
        company_id: params.companyId,
        submitted_by: params.submittedBy,
        content_text: params.content_text,
        content_type: params.review.content_type as never,
        platform: params.review.platform,
        aggregate_score: params.review.aggregate_score,
        verdict: params.review.verdict,
        created_at: "2026-09-01T00:00:00.000Z",
      },
      scores: [],
    };
  };
  return { calls, persist };
}

const VALID_BODY = {
  content_text: "Introducing our new sleep supplement, backed by a small clinical study.",
  content_type: "ad_copy",
  platform: "instagram",
};

describe("createReview (POST /api/reviews)", () => {
  // Successful reviews emit a redacted `console.info("review usage", …)` line
  // (Day 18). Silence it by default so the suite output stays clean; the
  // redaction-contract test below installs its own spy to assert on it.
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs the jurors, persists, and returns a 201 with a valid review", async () => {
    const { calls, persist } = recordingPersist();

    const result = await createReview(VALID_BODY, { session: SESSION, persist });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.status).toBe(201);
    // A juror slot per persona; aggregate + verdict present.
    expect(result.review.jurors).toHaveLength(PERSONA_NAMES.length);
    expect(["pass", "revise", "fail"]).toContain(result.review.verdict);
    expect(typeof result.review.aggregate_score).toBe("number");
    expect(calls).toHaveLength(1);
  });

  it("derives company_id / submitted_by from the session, never the body", async () => {
    const { calls, persist } = recordingPersist();

    // The body tries to spoof tenancy fields; they must be ignored.
    const result = await createReview(
      {
        ...VALID_BODY,
        company_id: "99999999-9999-9999-9999-999999999999",
        submitted_by: "88888888-8888-8888-8888-888888888888",
      },
      { session: SESSION, persist },
    );

    expect(result.ok).toBe(true);
    expect(calls[0]?.companyId).toBe(SESSION.companyId);
    expect(calls[0]?.submittedBy).toBe(SESSION.authUserId);
    // The persisted content is exactly what was submitted.
    expect(calls[0]?.content_text).toBe(VALID_BODY.content_text);
  });

  it("rejects an unauthenticated caller with 401 and never persists", async () => {
    const { calls, persist } = recordingPersist();

    const result = await createReview(VALID_BODY, { session: null, persist });

    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(calls).toHaveLength(0);
  });

  it("rejects a missing content_type with 400 and never persists", async () => {
    const { calls, persist } = recordingPersist();

    const result = await createReview(
      { content_text: "hello", platform: null },
      { session: SESSION, persist },
    );

    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(calls).toHaveLength(0);
  });

  it("rejects empty content with 400", async () => {
    const { persist } = recordingPersist();
    const result = await createReview(
      { content_text: "", content_type: "email", platform: null },
      { session: SESSION, persist },
    );
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects oversized content with 400", async () => {
    const { persist } = recordingPersist();
    const result = await createReview(
      { content_text: "x".repeat(10_001), content_type: "email", platform: null },
      { session: SESSION, persist },
    );
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects an unknown content_type value with 400 and never persists", async () => {
    const { calls, persist } = recordingPersist();
    const result = await createReview(
      { content_text: "hello", content_type: "blog_post", platform: null },
      { session: SESSION, persist },
    );
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(calls).toHaveLength(0);
  });

  it("passes the submitted content_type and platform through to persistence untampered", async () => {
    const { calls, persist } = recordingPersist();
    const result = await createReview(
      { content_text: "A short promo.", content_type: "email", platform: "newsletter" },
      { session: SESSION, persist },
    );
    expect(result.ok).toBe(true);
    expect(calls[0]?.review.content_type).toBe("email");
    expect(calls[0]?.review.platform).toBe("newsletter");
  });

  it("returns 502 and does not persist when every juror fails", async () => {
    const { calls, persist } = recordingPersist();
    // A client that never returns valid JSON makes every juror error out.
    const brokenClient: ModelClient = {
      model: "broken-test",
      isMock: true,
      complete: async () => "not json at all",
    };

    const result = await createReview(VALID_BODY, {
      session: SESSION,
      persist,
      client: brokenClient,
    });

    expect(result).toMatchObject({ ok: false, status: 502 });
    expect(calls).toHaveLength(0);
  });

  it("logs redacted usage on success and never logs the submitted content (Day 18)", async () => {
    const { persist } = recordingPersist();
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});

    const secretish = "Buy our miracle cure now — call 555-0100, promo code HUSH";
    const result = await createReview(
      { content_text: secretish, content_type: "ad_copy", platform: null },
      { session: SESSION, persist },
    );

    expect(result.ok).toBe(true);
    // A single redacted usage line was emitted...
    expect(spy).toHaveBeenCalledWith("review usage", expect.any(Object));
    const [, record] = spy.mock.calls.find(([msg]) => msg === "review usage") ?? [];
    // ...carrying only IDs/counts/scores, and NEVER the user's content (Rules.md §3).
    expect(JSON.stringify(record)).not.toContain("miracle cure");
    expect(JSON.stringify(record)).not.toContain("555-0100");
    expect(record).toMatchObject({
      companyId: SESSION.companyId,
      jurorCount: PERSONA_NAMES.length,
      isMock: true,
    });
    expect((record as { contentTokens: number }).contentTokens).toBeGreaterThan(0);
    spy.mockRestore();
  });

  it("returns 500 without reporting success when the write fails", async () => {
    const failingPersist = async (): Promise<ReviewWithScores> => {
      throw new Error("db.insertReviewWithScores/review failed [XX000]: boom");
    };
    // Silence the expected error log for this path.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await createReview(VALID_BODY, {
      session: SESSION,
      persist: failingPersist,
    });

    expect(result).toMatchObject({ ok: false, status: 500 });
    spy.mockRestore();
  });
});

/**
 * Brand voice in reviews (DailyPlan Day 27). The company's stored brand guide is
 * loaded server-side (scoped to the session company, never the client — Rules.md
 * §5) and injected into the Brand Voice Guardian's prompt only. A recording
 * client captures each juror's prompt so we can prove the guide reaches juror 1
 * and no one else, and that a read failure fails open.
 */
describe("createReview — brand context (Day 27)", () => {
  const BRAND_LINE = "Brand context / style guide:";
  const GUIDE = "Tone: measured, expert, trustworthy. Avoid hype.";

  function brandRow(overrides: Partial<BrandProfileRow> = {}): BrandProfileRow {
    return {
      id: "33333333-3333-3333-3333-333333333333",
      company_id: SESSION.companyId,
      tone_guide_text: GUIDE,
      embedding_ref: null,
      updated_at: "2026-09-22T00:00:00.000Z",
      ...overrides,
    };
  }

  /** A client that records every prompt and always returns valid juror JSON. */
  function recordingClient() {
    const calls: { persona: string; user: string }[] = [];
    const client: ModelClient = {
      model: "test-model",
      isMock: true,
      complete: async ({ persona, user }) => {
        calls.push({ persona, user });
        return JSON.stringify({
          persona,
          score: 8,
          confidence: "high",
          summary: "Reads cleanly on this lens.",
          issues: [],
          suggested_rewrite: "A sharper version of the same content.",
        });
      },
    };
    const promptFor = (persona: string) =>
      calls.find((c) => c.persona === persona)?.user ?? "";
    return { client, promptFor };
  }

  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the stored guide and injects it into the Brand Voice Guardian only", async () => {
    const { persist } = recordingPersist();
    const { client, promptFor } = recordingClient();
    const companyIds: string[] = [];

    const result = await createReview(VALID_BODY, {
      session: SESSION,
      persist,
      client,
      getBrandProfile: async (companyId) => {
        companyIds.push(companyId);
        return brandRow();
      },
    });

    expect(result.ok).toBe(true);
    // Tenancy: the guide was read for the SESSION company, never a client value.
    expect(companyIds).toEqual([SESSION.companyId]);
    // Juror 1 sees the guide; the other four never do.
    expect(promptFor("brand_voice_guardian")).toContain(BRAND_LINE);
    expect(promptFor("brand_voice_guardian")).toContain(GUIDE);
    for (const other of [
      "compliance_legal_flagger",
      "target_audience_fit",
      "seo_discoverability",
      "stop_scrolling",
    ]) {
      expect(promptFor(other)).not.toContain(GUIDE);
    }
  });

  it("runs with no brand context when the company has no stored guide", async () => {
    const { persist } = recordingPersist();
    const { client, promptFor } = recordingClient();

    const result = await createReview(VALID_BODY, {
      session: SESSION,
      persist,
      client,
      getBrandProfile: async () => null,
    });

    expect(result.ok).toBe(true);
    expect(promptFor("brand_voice_guardian")).toContain("No brand context provided");
    expect(promptFor("brand_voice_guardian")).not.toContain(BRAND_LINE);
  });

  it("treats a whitespace-only stored guide as no brand context", async () => {
    const { persist } = recordingPersist();
    const { client, promptFor } = recordingClient();

    const result = await createReview(VALID_BODY, {
      session: SESSION,
      persist,
      client,
      getBrandProfile: async () => brandRow({ tone_guide_text: "   \n  " }),
    });

    expect(result.ok).toBe(true);
    expect(promptFor("brand_voice_guardian")).toContain("No brand context provided");
  });

  it("fails open when the brand profile read throws (review still runs)", async () => {
    const { calls, persist } = recordingPersist();
    const { client } = recordingClient();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await createReview(VALID_BODY, {
      session: SESSION,
      persist,
      client,
      getBrandProfile: async () => {
        throw new Error("brand read boom");
      },
    });

    // A read blip degrades to a brand-less review, not a failed request.
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    // The failure was logged with redacted context (no content/secret).
    expect(errSpy).toHaveBeenCalledWith(
      "brand profile read failed (failing open)",
      expect.objectContaining({ companyId: SESSION.companyId }),
    );
    const [, meta] = errSpy.mock.calls.find(
      ([msg]) => msg === "brand profile read failed (failing open)",
    ) ?? [];
    expect(JSON.stringify(meta)).not.toContain(VALID_BODY.content_text);
    errSpy.mockRestore();
  });
});
