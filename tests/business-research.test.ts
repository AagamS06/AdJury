import { describe, it, expect } from "vitest";
import {
  BUSINESS_RESEARCH_SYSTEM_PROMPT,
  MAX_BUSINESS_SUMMARY_CHARS,
  RESEARCH_MAX_OUTPUT_TOKENS,
  buildBusinessResearchPrompt,
  businessContextRef,
  computeBusinessContextCacheAsync,
  modelBusinessResearcher,
  offlineBusinessResearcher,
  researchBusinessContext,
  resolveLiveBusinessResearcher,
  type AsyncBusinessResearcher,
  type BusinessIdentity,
} from "@/lib/company/business-context";
import {
  buildBusinessResearchReadiness,
  reconcileBusinessResearch,
  sampleBusinessIdentity,
} from "@/lib/company/business-research-readiness";
import { getModelClient, type CompleteArgs, type ModelClient } from "@/lib/ai/client";

/**
 * Live business research (DailyPlan Day 88) — swap the offline business-context
 * researcher for a web-search-backed one behind the existing seam. These tests
 * pin the grounded offline floor, the live researcher (refuses the mock, requests
 * web search, bounds + grounds its output), the live-with-offline fallback, and
 * the reconcile/readiness. The live model call itself is credential-gated, so it
 * is exercised here through a fake client — nothing reaches the network.
 */

const IDENTITY: BusinessIdentity = sampleBusinessIdentity();

/** A fake live client that records the args it was called with. */
function fakeLiveClient(
  response: string,
  capture?: CompleteArgs[],
): ModelClient {
  return {
    model: "claude-test",
    isMock: false,
    complete: async (args) => {
      capture?.push(args);
      return response;
    },
  };
}

describe("offline researcher stays the grounded floor", () => {
  it("states the business, field, and site and invents no new number", () => {
    const summary = offlineBusinessResearcher.research(IDENTITY);
    expect(summary).toContain("North Peak Outfitters");
    expect(summary).toContain("outdoor retail");
    expect(summary).toContain("https://store24.example");
    // The only digits in the summary are those already in the identity (24).
    const nums = summary.match(/\d+/g) ?? [];
    for (const n of nums) expect("store24".includes(n)).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(MAX_BUSINESS_SUMMARY_CHARS);
  });
});

describe("modelBusinessResearcher (live seam)", () => {
  it("refuses to run on the offline mock", async () => {
    const mock = getModelClient(); // no key in CI → mock
    expect(mock.isMock).toBe(true);
    await expect(modelBusinessResearcher(mock).research(IDENTITY)).rejects.toThrow(/mock/i);
  });

  it("requests web search with no persona and the research budget", async () => {
    const capture: CompleteArgs[] = [];
    const researcher = modelBusinessResearcher(fakeLiveClient("North Peak Outfitters sells outdoor gear.", capture));
    await researcher.research(IDENTITY);
    expect(capture).toHaveLength(1);
    const args = capture[0];
    expect(args.webSearch?.maxUses).toBeGreaterThanOrEqual(1);
    expect(args.persona).toBeUndefined(); // research is NOT a juror call
    expect(args.maxOutputTokens).toBe(RESEARCH_MAX_OUTPUT_TOKENS);
    expect(args.system).toBe(BUSINESS_RESEARCH_SYSTEM_PROMPT);
    expect(args.user).toContain("https://store24.example");
  });

  it("bounds a long model summary to the cache size", async () => {
    const long = "word ".repeat(400).trim();
    const summary = await modelBusinessResearcher(fakeLiveClient(long)).research(IDENTITY);
    expect(summary.length).toBeLessThanOrEqual(MAX_BUSINESS_SUMMARY_CHARS);
    expect(summary.endsWith("…")).toBe(true);
  });

  it("short-circuits to empty for an empty identity (no model call)", async () => {
    const capture: CompleteArgs[] = [];
    const researcher = modelBusinessResearcher(fakeLiveClient("should not be used", capture));
    const summary = await researcher.research({ name: "", industry: null, websiteUrl: null });
    expect(summary).toBe("");
    expect(capture).toHaveLength(0);
  });

  it("names the live model as its provenance", () => {
    expect(modelBusinessResearcher(fakeLiveClient("x")).name).toBe("claude-test");
  });
});

describe("the research system prompt is grounded by construction", () => {
  it("asks for web search and forbids invention", () => {
    const sys = BUSINESS_RESEARCH_SYSTEM_PROMPT.toLowerCase();
    expect(sys).toContain("web_search");
    expect(sys).toContain("never invent");
  });

  it("the prompt carries the identity being researched", () => {
    const p = buildBusinessResearchPrompt(IDENTITY);
    expect(p).toContain("North Peak Outfitters");
    expect(p).toContain("outdoor retail");
    expect(p).toContain("https://store24.example");
  });
});

describe("computeBusinessContextCacheAsync", () => {
  it("caches a live summary under the identity-keyed ref", async () => {
    const cache = await computeBusinessContextCacheAsync(
      IDENTITY,
      modelBusinessResearcher(fakeLiveClient("North Peak Outfitters sells outdoor gear to hikers.")),
    );
    expect(cache.summary).toContain("outdoor gear");
    expect(cache.contextRef).toBe(businessContextRef(IDENTITY));
  });

  it("caches nothing for an empty identity", async () => {
    const cache = await computeBusinessContextCacheAsync(
      { name: "", industry: null, websiteUrl: null },
      modelBusinessResearcher(fakeLiveClient("unused")),
    );
    expect(cache).toEqual({ summary: null, contextRef: null });
  });

  it("caches nothing when the live researcher returns empty", async () => {
    const cache = await computeBusinessContextCacheAsync(IDENTITY, modelBusinessResearcher(fakeLiveClient("   ")));
    expect(cache).toEqual({ summary: null, contextRef: null });
  });
});

describe("researchBusinessContext (live-with-offline fallback)", () => {
  it("uses the live researcher when one is configured", async () => {
    const result = await researchBusinessContext(
      IDENTITY,
      modelBusinessResearcher(fakeLiveClient("North Peak Outfitters: outdoor gear for serious hikers.")),
    );
    expect(result.source).toBe("live");
    expect(result.summary).toContain("outdoor gear");
    expect(result.contextRef).toBe(businessContextRef(IDENTITY));
  });

  it("falls back to the offline floor when no live researcher is given", async () => {
    const result = await researchBusinessContext(IDENTITY, null);
    expect(result.source).toBe("offline");
    expect(result.summary).toContain("North Peak Outfitters");
  });

  it("falls back to offline when the live call throws", async () => {
    const throwing: AsyncBusinessResearcher = {
      name: "boom",
      research: async () => {
        throw new Error("network down");
      },
    };
    const result = await researchBusinessContext(IDENTITY, throwing);
    expect(result.source).toBe("offline");
    expect(result.summary).toContain("North Peak Outfitters");
  });

  it("falls back to offline when the live call returns nothing", async () => {
    const result = await researchBusinessContext(IDENTITY, modelBusinessResearcher(fakeLiveClient("")));
    expect(result.source).toBe("offline");
    expect(result.summary).toContain("North Peak Outfitters");
  });

  it("returns none for an empty identity (no researcher consulted)", async () => {
    const result = await researchBusinessContext(
      { name: "  ", industry: null, websiteUrl: "" },
      modelBusinessResearcher(fakeLiveClient("unused")),
    );
    expect(result).toEqual({ summary: null, contextRef: null, source: "none" });
  });
});

describe("resolveLiveBusinessResearcher", () => {
  it("returns null for the offline mock and a researcher for a live client", () => {
    expect(resolveLiveBusinessResearcher(getModelClient())).toBeNull(); // mock in CI
    const live = resolveLiveBusinessResearcher(fakeLiveClient("x"));
    expect(live?.name).toBe("claude-test");
  });
});

describe("reconcile + readiness", () => {
  it("the sample reconciles clean", () => {
    expect(reconcileBusinessResearch()).toEqual({ clean: true, failures: [] });
  });

  it("reconcile is non-vacuous: an empty identity fails it", () => {
    const r = reconcileBusinessResearch({ name: "", industry: null, websiteUrl: null });
    expect(r.clean).toBe(false);
    expect(r.failures.length).toBeGreaterThan(0);
  });

  it("readiness is ready and reports the manual steps (offline mock)", () => {
    const r = buildBusinessResearchReadiness(getModelClient());
    expect(r.ready).toBe(true);
    expect(r.manualSteps).toBe(2);
    expect(r.liveConfigured).toBe(false);
  });

  it("readiness reports live configured for a live client", () => {
    const r = buildBusinessResearchReadiness(fakeLiveClient("x"));
    expect(r.liveConfigured).toBe(true);
    // The two grounding/offline checks are still `ready`.
    expect(r.ready).toBe(true);
  });
});
