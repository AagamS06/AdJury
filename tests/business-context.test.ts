import { describe, it, expect } from "vitest";
import {
  BUSINESS_CONTEXT_VERSION,
  MAX_BUSINESS_SUMMARY_CHARS,
  boundSummary,
  businessContextRef,
  computeBusinessContextCache,
  hasBusinessIdentity,
  isBusinessContextFresh,
  normalizeWebsiteUrl,
  offlineBusinessResearcher,
  resolveBusinessContext,
  type BusinessIdentity,
} from "@/lib/company/business-context";
import { buildUserPrompt } from "@/lib/ai/orchestrator";
import { PERSONAS } from "@/lib/ai/personas";
import { ReviewInputSchema } from "@/lib/schema/juror";
import type { CompanyRow } from "@/types/db";

/**
 * Business context (DailyPlan Day 23a). AdJury researches what business an ad is
 * for (from the company's name + industry + website) and grounds every juror in
 * it, caching the result so reviews don't re-research per run (Architecture.md §5,
 * mirroring the brand-voice cache). These tests pin the pure cache + the offline
 * researcher, and prove the context reaches every juror's prompt.
 */

const IDENTITY: BusinessIdentity = {
  name: "Acme Sleep Co.",
  industry: "healthcare",
  websiteUrl: "acmesleep.com",
};

describe("normalizeWebsiteUrl", () => {
  it("adds a scheme and canonicalizes", () => {
    expect(normalizeWebsiteUrl("acmesleep.com")).toBe("https://acmesleep.com");
    expect(normalizeWebsiteUrl("http://acmesleep.com/")).toBe("http://acmesleep.com");
    expect(normalizeWebsiteUrl("  https://acmesleep.com/shop  ")).toBe(
      "https://acmesleep.com/shop",
    );
  });

  it("rejects empty or junk values", () => {
    expect(normalizeWebsiteUrl("")).toBeNull();
    expect(normalizeWebsiteUrl("   ")).toBeNull();
    expect(normalizeWebsiteUrl(null)).toBeNull();
    expect(normalizeWebsiteUrl("not a url")).toBeNull(); // has a space
    expect(normalizeWebsiteUrl("localhost")).toBeNull(); // no dot in host
    expect(normalizeWebsiteUrl("ftp://acmesleep.com")).toBeNull(); // non-http(s)
  });

  it("maps bare-root and trailing slash to one canonical form (stable cache key)", () => {
    expect(normalizeWebsiteUrl("acmesleep.com")).toBe(
      normalizeWebsiteUrl("acmesleep.com/"),
    );
  });
});

describe("offlineBusinessResearcher", () => {
  it("states the business, its field, and its site — grounding, not invention", () => {
    const blurb = offlineBusinessResearcher.research(IDENTITY);
    expect(blurb).toContain("Acme Sleep Co.");
    expect(blurb).toContain("healthcare");
    expect(blurb).toContain("https://acmesleep.com");
    expect(blurb.length).toBeLessThanOrEqual(MAX_BUSINESS_SUMMARY_CHARS);
  });

  it("returns empty when there is nothing to research", () => {
    expect(
      offlineBusinessResearcher.research({ name: "", industry: null, websiteUrl: null }),
    ).toBe("");
  });

  it("works from a name alone (no industry, no site)", () => {
    const blurb = offlineBusinessResearcher.research({
      name: "Acme",
      industry: null,
      websiteUrl: null,
    });
    expect(blurb).toContain("Acme");
    expect(blurb.length).toBeGreaterThan(0);
  });
});

describe("hasBusinessIdentity", () => {
  it("is true when any of name/industry/website is present", () => {
    expect(hasBusinessIdentity(IDENTITY)).toBe(true);
    expect(hasBusinessIdentity({ name: "X", industry: null, websiteUrl: null })).toBe(true);
    expect(hasBusinessIdentity({ name: "", industry: "saas", websiteUrl: null })).toBe(true);
  });
  it("is false when nothing is provided", () => {
    expect(hasBusinessIdentity({ name: "  ", industry: null, websiteUrl: "" })).toBe(false);
  });
});

describe("boundSummary", () => {
  it("passes short text through and truncates long text at a word boundary", () => {
    expect(boundSummary("Short and sweet.")).toBe("Short and sweet.");
    const long = "word ".repeat(400).trim();
    const bounded = boundSummary(long);
    expect(bounded.length).toBeLessThanOrEqual(MAX_BUSINESS_SUMMARY_CHARS);
    expect(bounded.endsWith("…")).toBe(true);
    expect(bounded).not.toMatch(/\s…$/); // trimmed before the ellipsis
  });
});

describe("computeBusinessContextCache", () => {
  it("returns both null when there is nothing to research", () => {
    expect(
      computeBusinessContextCache({ name: "", industry: null, websiteUrl: null }),
    ).toEqual({ summary: null, contextRef: null });
  });

  it("returns a bounded summary and a versioned content-addressed ref", () => {
    const cache = computeBusinessContextCache(IDENTITY);
    expect(cache.summary && cache.summary.length).toBeGreaterThan(0);
    expect(cache.summary!.length).toBeLessThanOrEqual(MAX_BUSINESS_SUMMARY_CHARS);
    expect(cache.contextRef).toMatch(new RegExp(`^bzc${BUSINESS_CONTEXT_VERSION}-[0-9a-f]{64}$`));
  });

  it("is stable for the same identity and changes when any input changes", () => {
    const a = computeBusinessContextCache(IDENTITY).contextRef;
    const again = computeBusinessContextCache({ ...IDENTITY }).contextRef;
    expect(again).toBe(a);

    expect(computeBusinessContextCache({ ...IDENTITY, name: "Other Co." }).contextRef).not.toBe(a);
    expect(computeBusinessContextCache({ ...IDENTITY, industry: "finance" }).contextRef).not.toBe(a);
    expect(computeBusinessContextCache({ ...IDENTITY, websiteUrl: "other.com" }).contextRef).not.toBe(a);

    // A website that canonicalizes identically does NOT churn the key.
    expect(computeBusinessContextCache({ ...IDENTITY, websiteUrl: "acmesleep.com/" }).contextRef).toBe(a);
  });

  it("honours an injected researcher", () => {
    const cache = computeBusinessContextCache(IDENTITY, {
      research: () => "Custom researched blurb about the business.",
    });
    expect(cache.summary).toBe("Custom researched blurb about the business.");
  });
});

function companyRow(overrides: Partial<CompanyRow> = {}): CompanyRow {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    name: "Acme Sleep Co.",
    industry: "healthcare",
    plan_tier: "free",
    juror_weights: null,
    onboarded_at: "2026-09-18T00:00:00.000Z",
    website_url: "https://acmesleep.com",
    business_summary: null,
    business_context_ref: null,
    created_at: "2026-09-18T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveBusinessContext (review read side)", () => {
  it("returns none when the company has no usable identity", () => {
    const resolved = resolveBusinessContext(
      companyRow({ name: "", industry: null, website_url: null }),
    );
    expect(resolved).toEqual({ summary: null, source: "none" });
  });

  it("reuses a fresh cache verbatim (no re-research)", () => {
    const cache = computeBusinessContextCache({
      name: "Acme Sleep Co.",
      industry: "healthcare",
      websiteUrl: "https://acmesleep.com",
    });
    const resolved = resolveBusinessContext(
      companyRow({ business_summary: cache.summary, business_context_ref: cache.contextRef }),
    );
    expect(resolved.source).toBe("cache");
    expect(resolved.summary).toBe(cache.summary);
  });

  it("recomputes when the cache is missing or stale", () => {
    // Missing cache.
    expect(resolveBusinessContext(companyRow()).source).toBe("recomputed");
    // Stale cache (ref does not match the current identity).
    const stale = resolveBusinessContext(
      companyRow({ business_summary: "old", business_context_ref: "bzc1-deadbeef" }),
    );
    expect(stale.source).toBe("recomputed");
    expect(stale.summary).toContain("Acme Sleep Co.");
  });
});

describe("isBusinessContextFresh", () => {
  it("matches only when the stored ref equals the current identity's ref", () => {
    const identity: BusinessIdentity = {
      name: "Acme Sleep Co.",
      industry: "healthcare",
      websiteUrl: "https://acmesleep.com",
    };
    const ref = businessContextRef(identity);
    expect(isBusinessContextFresh({ business_context_ref: ref }, identity)).toBe(true);
    expect(isBusinessContextFresh({ business_context_ref: null }, identity)).toBe(false);
    expect(isBusinessContextFresh({ business_context_ref: "bzc1-nope" }, identity)).toBe(false);
  });
});

describe("business context reaches every juror's prompt", () => {
  it("injects the business block into all five jurors when present", () => {
    const input = ReviewInputSchema.parse({
      content_text: "Introducing our new sleep supplement.",
      content_type: "ad_copy",
      platform: "instagram",
      business_context: "Acme Sleep Co. operates in the healthcare field.",
    });
    for (const persona of PERSONAS) {
      const prompt = buildUserPrompt(input, persona);
      expect(prompt, `${persona.name} sees business context`).toContain(
        "Business context (what this ad is for):",
      );
      expect(prompt).toContain("Acme Sleep Co. operates in the healthcare field.");
    }
  });

  it("omits the business block when there is no business context", () => {
    const input = ReviewInputSchema.parse({
      content_text: "Introducing our new sleep supplement.",
      content_type: "ad_copy",
      platform: "instagram",
      business_context: null,
    });
    for (const persona of PERSONAS) {
      expect(buildUserPrompt(input, persona)).not.toContain("Business context (what this ad is for):");
    }
  });
});
