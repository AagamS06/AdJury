import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { SessionContext } from "@/lib/auth/session";
import type { InsertReviewParams } from "@/lib/db/queries";
import { createReview } from "@/lib/reviews/create-review";
import type { PersonaWeightsConfig } from "@/lib/schema/weights";
import type { PlanTier, ReviewWithScores } from "@/types/db";

/**
 * Plan gating of the scoring path (DailyPlan Day 75). Custom juror weights are a
 * paid-plan feature (`custom_juror_weights`, unlocked at enterprise). The gate
 * binds where the feature actually takes effect — the aggregate computation in
 * `createReview` — not merely where weights would be edited: a company with
 * stored custom weights but a plan that doesn't include the feature scores on
 * equal weights, while an enterprise company's custom weights are honored.
 *
 * The offline mock model client gives each persona a distinct, deterministic
 * score, so a weight config skewed entirely onto one juror makes the aggregate
 * equal that juror's score — a clean, deterministic probe for whether the custom
 * weights were applied.
 */

// All weight on the Brand Voice Guardian, zero elsewhere ⇒ when honored, the
// aggregate equals that juror's score; when ignored, it's the equal-weight mean.
const SKEWED_WEIGHTS: PersonaWeightsConfig = {
  brand_voice_guardian: 1,
  compliance_legal_flagger: 0,
  target_audience_fit: 0,
  seo_discoverability: 0,
  stop_scrolling: 0,
  business_analyst: 0,
};

function sessionWith(
  plan: PlanTier,
  weights: PersonaWeightsConfig | null,
): SessionContext {
  return {
    authUserId: "11111111-1111-1111-1111-111111111111",
    email: "admin@acme.test",
    companyId: "22222222-2222-2222-2222-222222222222",
    role: "admin",
    company: {
      id: "22222222-2222-2222-2222-222222222222",
      name: "Acme",
      industry: null,
      plan_tier: plan,
      juror_weights: weights,
      onboarded_at: "2026-08-31T00:00:00.000Z",
      created_at: "2026-08-31T00:00:00.000Z",
    },
  };
}

function recordingPersist() {
  const persist = async (params: InsertReviewParams): Promise<ReviewWithScores> => ({
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
  });
  return { persist };
}

const VALID_BODY = {
  content_text:
    "Introducing our new sleep supplement, backed by a small clinical study.",
  content_type: "ad_copy",
  platform: "instagram",
};

async function aggregateFor(
  plan: PlanTier,
  weights: PersonaWeightsConfig | null,
): Promise<{ aggregate: number; brandVoiceScore: number }> {
  const { persist } = recordingPersist();
  const result = await createReview(VALID_BODY, {
    session: sessionWith(plan, weights),
    persist,
  });
  if (!result.ok) throw new Error("expected a successful review");
  const brandVoice = result.review.jurors.find(
    (j) => j.persona === "brand_voice_guardian",
  );
  if (!brandVoice || brandVoice.status !== "ok") {
    throw new Error("expected an ok brand_voice_guardian juror");
  }
  return {
    aggregate: result.review.aggregate_score,
    brandVoiceScore: brandVoice.score,
  };
}

describe("createReview — custom juror weights are plan-gated (Day 75)", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("an enterprise plan HONORS stored custom weights", async () => {
    const { aggregate, brandVoiceScore } = await aggregateFor(
      "enterprise",
      SKEWED_WEIGHTS,
    );
    // All weight on brand voice ⇒ aggregate equals that juror's score.
    expect(aggregate).toBe(brandVoiceScore);
  });

  it("a free plan IGNORES stored custom weights (scores on equal weights)", async () => {
    const equalAggregate = (await aggregateFor("free", null)).aggregate;
    const skewedOnFree = await aggregateFor("free", SKEWED_WEIGHTS);
    // The skew is dropped: free scores identically whether or not weights are set.
    expect(skewedOnFree.aggregate).toBe(equalAggregate);
  });

  it("a pro plan also IGNORES custom weights (enterprise-only feature)", async () => {
    const equalAggregate = (await aggregateFor("pro", null)).aggregate;
    const skewedOnPro = await aggregateFor("pro", SKEWED_WEIGHTS);
    expect(skewedOnPro.aggregate).toBe(equalAggregate);
  });

  it("the gate is observable: the skew changes the aggregate when honored", async () => {
    // Guards against a vacuous pass — prove the skewed weights actually move the
    // aggregate, so "free ignores them" is a real difference, not a no-op config.
    const equalAggregate = (await aggregateFor("enterprise", null)).aggregate;
    const honored = await aggregateFor("enterprise", SKEWED_WEIGHTS);
    expect(honored.aggregate).not.toBe(equalAggregate);
  });
});
