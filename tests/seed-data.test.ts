import { describe, it, expect } from "vitest";
import { getModelClient } from "@/lib/ai/client";
import { runReview } from "@/lib/ai/orchestrator";
import {
  ReviewInputSchema,
  VerdictSchema,
  type Verdict,
} from "@/lib/schema/juror";
import { isBrandCacheFresh, MAX_BRAND_SUMMARY_CHARS } from "@/lib/company/brand-summary";
import {
  MAX_BUSINESS_SUMMARY_CHARS,
  resolveBusinessContext,
} from "@/lib/company/business-context";
import {
  DEMO_BRAND_GUIDE,
  DEMO_COMPANY,
  DEMO_IMAGE_DATA_URL,
  DEMO_REVIEW_SCENARIOS,
  DEMO_USERS,
  demoBrandCache,
  demoBusinessContextCache,
  demoReviewInput,
} from "@/lib/demo/seed-data";

/**
 * Demo dataset integrity (DailyPlan Day 68 — user-testing prep). The pure dataset
 * in `src/lib/demo/seed-data.ts` is what a tester's whole session is built on, so
 * its promises are proved here rather than eyeballed: every scenario is
 * schema-valid, the scenarios cover every content type + both ad formats, the
 * pinned verdicts actually cover pass/revise/fail under the offline mock (and don't
 * drift), the caches are genuine + bounded + fresh, and the dataset impersonates no
 * real company/person (reserved `.example` identities, no committed secrets).
 */

/** Precondition: these tests pin behaviour against the OFFLINE MOCK model. */
const client = getModelClient();

describe("demo dataset — scenarios are schema-valid and well-formed", () => {
  it("builds a valid orchestrator input for every scenario", () => {
    for (const scenario of DEMO_REVIEW_SCENARIOS) {
      expect(() => demoReviewInput(scenario)).not.toThrow();
      const input = demoReviewInput(scenario);
      // Re-parsing the built input is a no-op if it is already valid.
      expect(() => ReviewInputSchema.parse(input)).not.toThrow();
      expect(input.content_text.length).toBeGreaterThan(0);
    }
  });

  it("has unique scenario keys and a non-empty set", () => {
    expect(DEMO_REVIEW_SCENARIOS.length).toBeGreaterThan(0);
    const keys = DEMO_REVIEW_SCENARIOS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("covers every content type", () => {
    const types = new Set(DEMO_REVIEW_SCENARIOS.map((s) => s.content_type));
    expect(types).toEqual(
      new Set(["ad_copy", "social_post", "email", "landing_page"]),
    );
  });

  it("covers both ad formats, and the image ad carries a valid image", () => {
    const media = new Set(DEMO_REVIEW_SCENARIOS.map((s) => s.media_type));
    expect(media.has("text")).toBe(true);
    expect(media.has("image")).toBe(true);

    for (const scenario of DEMO_REVIEW_SCENARIOS) {
      const input = demoReviewInput(scenario);
      if (scenario.media_type === "image") {
        expect(scenario.image).toBeDefined();
        expect(input.image).not.toBeNull();
        expect(input.image?.data_url).toBe(DEMO_IMAGE_DATA_URL);
        expect(input.image?.mime_type).toMatch(/^image\//);
      } else {
        expect(input.image).toBeNull();
      }
    }
  });
});

describe("demo dataset — verdicts cover the full range under the offline mock", () => {
  it("runs on the offline mock (no AI key in this environment)", () => {
    expect(client.isMock).toBe(true);
  });

  it("realizes each scenario's pinned verdict", async () => {
    for (const scenario of DEMO_REVIEW_SCENARIOS) {
      const review = await runReview(demoReviewInput(scenario), { client });
      expect(VerdictSchema.safeParse(scenario.expected_verdict).success).toBe(true);
      expect(review.verdict, `scenario ${scenario.key}`).toBe(
        scenario.expected_verdict,
      );
    }
  });

  it("pins a spread that includes pass, revise, and fail", async () => {
    const declared = new Set<Verdict>(
      DEMO_REVIEW_SCENARIOS.map((s) => s.expected_verdict),
    );
    expect(declared).toEqual(new Set<Verdict>(["pass", "revise", "fail"]));

    // And the realized verdicts agree with the declared spread.
    const realized = new Set<Verdict>();
    for (const scenario of DEMO_REVIEW_SCENARIOS) {
      const review = await runReview(demoReviewInput(scenario), { client });
      realized.add(review.verdict);
    }
    expect(realized).toEqual(new Set<Verdict>(["pass", "revise", "fail"]));
  });

  it("is deterministic — the same scenario yields the same verdict + aggregate", async () => {
    const scenario = DEMO_REVIEW_SCENARIOS[0];
    const a = await runReview(demoReviewInput(scenario), { client });
    const b = await runReview(demoReviewInput(scenario), { client });
    expect(a.verdict).toBe(b.verdict);
    expect(a.aggregate_score).toBe(b.aggregate_score);
  });

  it("the compliance-fail scenario is actually vetoed by the compliance juror", async () => {
    const scenario = DEMO_REVIEW_SCENARIOS.find((s) => s.expected_verdict === "fail");
    expect(scenario).toBeDefined();
    const review = await runReview(demoReviewInput(scenario!), { client });
    expect(review.verdict).toBe("fail");
    const compliance = review.jurors.find(
      (j) => j.persona === "compliance_legal_flagger",
    );
    expect(compliance?.status).toBe("ok");
    if (compliance?.status === "ok") {
      const vetoes =
        compliance.score <= 2 ||
        compliance.issues.some((i) => i.severity === "high");
      expect(vetoes).toBe(true);
    }
  });
});

describe("demo dataset — caches are genuine, bounded, and fresh", () => {
  it("produces a real, bounded, fresh brand cache from the demo guide", () => {
    const cache = demoBrandCache();
    expect(cache.summary && cache.summary.length).toBeGreaterThan(0);
    expect(cache.embeddingRef).not.toBeNull();
    expect((cache.summary ?? "").length).toBeLessThanOrEqual(MAX_BRAND_SUMMARY_CHARS);
    expect(isBrandCacheFresh({ embedding_ref: cache.embeddingRef }, DEMO_BRAND_GUIDE)).toBe(
      true,
    );
  });

  it("produces a real, bounded business-context cache that reads back from cache", () => {
    const cache = demoBusinessContextCache();
    expect(cache.summary && cache.summary.length).toBeGreaterThan(0);
    expect(cache.contextRef).not.toBeNull();
    expect((cache.summary ?? "").length).toBeLessThanOrEqual(
      MAX_BUSINESS_SUMMARY_CHARS,
    );
    // The business summary is grounded in the identity (no invented facts).
    expect(cache.summary).toContain(DEMO_COMPANY.name);

    // A company row built from the cache resolves via the cache (no recompute).
    const resolved = resolveBusinessContext({
      name: DEMO_COMPANY.name,
      industry: DEMO_COMPANY.industry,
      website_url: DEMO_COMPANY.website_url,
      business_summary: cache.summary,
      business_context_ref: cache.contextRef,
    });
    expect(resolved.source).toBe("cache");
    expect(resolved.summary).toBe(cache.summary);
  });
});

describe("demo dataset — honest, safe fixtures (no impersonation, no secrets)", () => {
  it("uses reserved .example identities for every user and the website", () => {
    for (const user of DEMO_USERS) {
      expect(user.email.endsWith("@adjury.example")).toBe(true);
    }
    const host = new URL(DEMO_COMPANY.website_url).hostname;
    expect(host.endsWith(".example")).toBe(true);
  });

  it("has exactly one admin and one member with unique keys", () => {
    const roles = DEMO_USERS.map((u) => u.role).sort();
    expect(roles).toEqual(["admin", "member"]);
    const keys = DEMO_USERS.map((u) => u.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("ships a non-empty brand guide and embeds no credential-shaped fields", () => {
    expect(DEMO_BRAND_GUIDE.trim().length).toBeGreaterThan(0);
    // The dataset defines no passwords/tokens — those are generated at run time.
    const serialized = JSON.stringify({ DEMO_COMPANY, DEMO_USERS, DEMO_REVIEW_SCENARIOS });
    expect(serialized.toLowerCase()).not.toContain("password");
    expect(serialized.toLowerCase()).not.toContain("secret");
  });
});
