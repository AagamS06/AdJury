/**
 * Business context — research + cache (DailyPlan Day 23a).
 *
 * When a review runs, every juror benefits from knowing *what business the ad is
 * for* — its field, offering, and audience (PRD §4/§5: "judging an ad should know
 * which business it is about"). A company records its public website at
 * onboarding (Day 22/23); from its name + industry + website AdJury derives a
 * small, bounded **business summary** and a content-addressed **cache key**, once,
 * and stores both on the `companies` row (`business_summary` + `business_context_ref`).
 * A review then reuses the cached summary instead of re-researching the business
 * every time — so cost per review stays independent of the business's web
 * footprint (Rules.md §1 cost discipline; Architecture.md §5 caching).
 *
 * This mirrors the brand-voice cache (`brand-summary.ts`) exactly, with one added
 * seam: an injectable {@link BusinessResearcher}. The default researcher is a
 * **pure, deterministic, offline** condensation of the identity inputs — no
 * network, no model/search spend — so it is free, reproducible, and fully
 * unit-testable with no live credential (this cloud build has none). A production
 * researcher that actually fetches/searches the website (via the model's web
 * search tool) can be swapped in behind this same interface without touching the
 * review read path — exactly how the live model client swaps in behind the
 * offline mock in `lib/ai/client.ts`.
 *
 * ── Live research (DailyPlan Day 88 — needs credentials / network) ───────────
 * The offline researcher summarizes only the inputs the company already gave us.
 * To ground reviews in what the site actually *says*, {@link modelBusinessResearcher}
 * makes ONE Claude call with the server-side web-search tool over the company's
 * name + website (Rules.md §2 — one provider behind `lib/ai/client.ts`), and
 * {@link computeBusinessContextCacheAsync} runs it once per identity change (on
 * save), caching the bounded result here exactly like the offline floor — so the
 * read path is still a plain cache lookup and cost per review is unchanged. The
 * live call needs a live `AI_API_KEY` + outbound network (the offline mock cannot
 * search, so the researcher refuses to run on it); {@link researchBusinessContext}
 * is the convenience that prefers the live researcher when configured and falls
 * back to the deterministic offline floor otherwise. Wiring it into the
 * onboarding/save action is the one remaining operator step (see
 * `docs/BUSINESS_RESEARCH.md`); the whole seam is proven offline today.
 */
import { createHash } from "node:crypto";
import type { CompanyRow } from "@/types/db";
import type { ModelClient } from "@/lib/ai/client";

/**
 * Bump when the summarization/research algorithm changes so every stored
 * `business_context_ref` from an older version reads as stale (the key embeds the
 * version), and the next save recomputes. Keeps the cache honest across changes.
 */
export const BUSINESS_CONTEXT_VERSION = 1;

/**
 * The cached summary is intentionally small and bounded — that is the whole point
 * of the cache. Comfortably under the review token budget so the two never fight
 * even though, unlike brand context, this is injected into every juror.
 */
export const MAX_BUSINESS_SUMMARY_CHARS = 500;

/** Prefix on the cache key so a stored ref is self-describing and versioned. */
const REF_PREFIX = "bzc";

/** The company identity that research is keyed on (name + industry + website). */
export interface BusinessIdentity {
  name: string;
  industry: string | null | undefined;
  websiteUrl: string | null | undefined;
}

/** Collapse whitespace runs to single spaces and trim. */
export function normalizeText(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Normalize a user-supplied website into a canonical `https://host[/path]` form,
 * or null when it is empty or not a usable http(s) URL. Lenient on input (adds a
 * scheme when missing) but strict on output (only http/https, host required) so a
 * junk value never reaches research or the cache key.
 */
export function normalizeWebsiteUrl(
  raw: string | null | undefined,
): string | null {
  const trimmed = normalizeText(raw);
  if (trimmed.length === 0) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname || !url.hostname.includes(".")) return null;
  // Drop a trailing slash on the bare-root path so "site.com" and "site.com/"
  // produce one canonical key.
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.host}${path}`;
}

/**
 * The identity inputs, normalized and joined into the stable string the cache key
 * and the offline summary are both derived from. Keeping this one function means
 * the key and the summary can never disagree about what the inputs were.
 */
function identityBasis(identity: BusinessIdentity): {
  name: string;
  industry: string;
  website: string;
} {
  return {
    name: normalizeText(identity.name),
    industry: normalizeText(identity.industry),
    website: normalizeWebsiteUrl(identity.websiteUrl) ?? "",
  };
}

/** True when there is nothing to research (no name, no industry, no website). */
export function hasBusinessIdentity(identity: BusinessIdentity): boolean {
  const { name, industry, website } = identityBasis(identity);
  return name.length > 0 || industry.length > 0 || website.length > 0;
}

/**
 * How a review's business context was sourced — for observability + testing.
 */
export type BusinessContextSource = "cache" | "recomputed" | "none";

/**
 * A researcher turns a company's identity into a short, plain-language blurb
 * describing the business — its field and likely offering/audience — that grounds
 * the jurors. Injectable so the offline default (below) can be swapped for a live
 * web-search implementation without touching callers.
 */
export interface BusinessResearcher {
  research(identity: BusinessIdentity): string;
}

/**
 * Deterministic, offline researcher. It does not reach the network; it states the
 * business's name, field, and site in a compact, bounded blurb built only from the
 * inputs the company already provided. This is the honest offline floor: it tells
 * each juror which business/field the ad is for without inventing facts about the
 * company (a live researcher would enrich this from the actual site — see the
 * module header). Returns "" when there is nothing to say.
 */
export const offlineBusinessResearcher: BusinessResearcher = {
  research(identity) {
    const { name, industry, website } = identityBasis(identity);
    if (name.length === 0 && industry.length === 0 && website.length === 0) {
      return "";
    }
    const subject = name.length > 0 ? name : "This business";
    const parts: string[] = [];
    if (industry.length > 0) {
      parts.push(`${subject} operates in the ${industry} field.`);
    } else {
      parts.push(`${subject} is the business this ad is for.`);
    }
    if (website.length > 0) {
      parts.push(`Its public website is ${website}.`);
    }
    parts.push(
      "Judge the ad as a prospective customer of this business, in its field and for its likely audience.",
    );
    return boundSummary(parts.join(" "));
  },
};

/** Trim a summary to {@link MAX_BUSINESS_SUMMARY_CHARS} at a word boundary. */
export function boundSummary(text: string): string {
  const normalized = normalizeText(text);
  if (normalized.length <= MAX_BUSINESS_SUMMARY_CHARS) return normalized;
  const ellipsis = "…";
  const budget = Math.max(0, MAX_BUSINESS_SUMMARY_CHARS - ellipsis.length);
  const slice = normalized.slice(0, budget);
  const lastSpace = slice.lastIndexOf(" ");
  const head = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return `${head.trimEnd()}${ellipsis}`;
}

/**
 * A stable, content-addressed cache key for the identity: `bzc<version>-<sha256>`
 * over the version + normalized name/industry/website. The same identity always
 * yields the same ref (so unchanged identity is "researched once and reused"), and
 * any change to an input or the algorithm version yields a new ref (so staleness
 * is detectable). This is `companies.business_context_ref`.
 */
export function businessContextRef(identity: BusinessIdentity): string {
  const { name, industry, website } = identityBasis(identity);
  const hash = createHash("sha256")
    .update(`${BUSINESS_CONTEXT_VERSION}:${name}\u0000${industry}\u0000${website}`)
    .digest("hex");
  return `${REF_PREFIX}${BUSINESS_CONTEXT_VERSION}-${hash}`;
}

// ── Live, web-search-backed research (DailyPlan Day 88) ──────────────────────

/**
 * How many web searches the live researcher may run in its single call. A small
 * cap keeps research cost predictable (Rules.md §1): one or two searches over a
 * company's own site is plenty to describe what it does.
 */
export const MAX_RESEARCH_SEARCHES = 3;

/** Output-token ceiling for the research call — a bounded summary, not an essay. */
export const RESEARCH_MAX_OUTPUT_TOKENS = 400;

/**
 * An async researcher — the live counterpart to the synchronous
 * {@link BusinessResearcher}. Separate interface (rather than widening the sync
 * one) so the offline write path and its callers are untouched: the live path
 * opts in by calling {@link computeBusinessContextCacheAsync} /
 * {@link researchBusinessContext}.
 */
export interface AsyncBusinessResearcher {
  /** Provenance recorded for observability (`offline` or the live model name). */
  readonly name: string;
  research(identity: BusinessIdentity): Promise<string>;
}

/**
 * System prompt for live research. It is deliberately strict about grounding
 * (Rules.md §3 "grounded, not invented"): the model may describe only what it can
 * actually find about the business, must invent no facts, and must stay brief.
 */
export const BUSINESS_RESEARCH_SYSTEM_PROMPT =
  "You research what a business does so an ad reviewer knows the field and " +
  "audience the ad is for. Use the web_search tool to look up the company's own " +
  "website and public pages. Describe ONLY what you can verify from those " +
  "sources: the field it operates in, what it offers, and who its likely " +
  "audience is. Never invent facts — no made-up products, revenue, customers, " +
  "claims, or statistics. If you cannot find reliable information, say only what " +
  "the provided name, industry, and website indicate, and no more. Reply with a " +
  `single plain-text paragraph of at most ${MAX_BUSINESS_SUMMARY_CHARS} characters ` +
  "and nothing else (no markdown, no citations, no preamble).";

/** Assemble the research user prompt from a company's identity. */
export function buildBusinessResearchPrompt(identity: BusinessIdentity): string {
  const { name, industry, website } = identityBasis(identity);
  return [
    `Business name: ${name || "(not given)"}`,
    `Stated industry: ${industry || "(not given)"}`,
    `Website: ${website || "(not given)"}`,
    "Research this business and summarize it for an ad reviewer.",
  ].join("\n");
}

/**
 * Live, web-search-backed researcher — one Claude call with the server-side
 * web_search tool (Rules.md §2 — one provider). Grounding comes from the search
 * (the model is told to describe only what it finds), and the output is bounded
 * to {@link MAX_BUSINESS_SUMMARY_CHARS} like every cached summary. Model output
 * is untrusted text, so it is normalized + bounded before use (Rules.md §3).
 *
 * The offline mock cannot search the web (it only produces juror JSON), so this
 * refuses to run on it — use {@link offlineBusinessResearcher} with no key, or
 * set `AI_API_KEY` for live research. A higher temperature than scoring is
 * correct here: this is descriptive summarization, not the deterministic,
 * low-temperature *judgement* Rules.md §3 reserves for the jurors.
 */
export function modelBusinessResearcher(
  client: ModelClient,
  opts: { temperature?: number; maxSearches?: number } = {},
): AsyncBusinessResearcher {
  return {
    name: client.model,
    async research(identity) {
      if (client.isMock) {
        throw new Error(
          "The offline mock cannot research the web. Use offlineBusinessResearcher (no key needed), or configure AI_API_KEY for live web-search research.",
        );
      }
      if (!hasBusinessIdentity(identity)) return "";
      const raw = await client.complete({
        system: BUSINESS_RESEARCH_SYSTEM_PROMPT,
        user: buildBusinessResearchPrompt(identity),
        webSearch: { maxUses: Math.max(1, Math.floor(opts.maxSearches ?? MAX_RESEARCH_SEARCHES)) },
        maxOutputTokens: RESEARCH_MAX_OUTPUT_TOKENS,
        temperature: opts.temperature ?? 0.3,
      });
      return boundSummary(raw);
    },
  };
}

/**
 * Pick the researcher to use for the live write path: the live, web-search
 * researcher when the client is real, otherwise none (the caller falls back to
 * the deterministic offline floor). Returns `null` for the mock so a caller can
 * decide its fallback explicitly rather than silently get offline output from a
 * "live" researcher.
 */
export function resolveLiveBusinessResearcher(
  client: ModelClient,
): AsyncBusinessResearcher | null {
  return client.isMock ? null : modelBusinessResearcher(client);
}

/** The cached summary + key written to `companies` on an identity change. */
export interface BusinessContextCache {
  /** Bounded, reusable business summary; null when there is nothing to research. */
  summary: string | null;
  /** Content-addressed cache key (`business_context_ref`); null when nothing to research. */
  contextRef: string | null;
}

/**
 * Compute the cache to persist for a company identity. Called once per
 * onboarding/website change (write side), never per review (the read side reuses
 * this). Nothing to research (no name, industry, or website) caches nothing.
 */
export function computeBusinessContextCache(
  identity: BusinessIdentity,
  researcher: BusinessResearcher = offlineBusinessResearcher,
): BusinessContextCache {
  if (!hasBusinessIdentity(identity)) {
    return { summary: null, contextRef: null };
  }
  const summary = boundSummary(researcher.research(identity));
  if (summary.length === 0) {
    return { summary: null, contextRef: null };
  }
  return { summary, contextRef: businessContextRef(identity) };
}

/**
 * Async counterpart of {@link computeBusinessContextCache} for the live,
 * web-search-backed researcher (DailyPlan Day 88). Same contract — nothing to
 * research caches nothing; otherwise a bounded summary + the identity-keyed ref —
 * but the researcher may make a network/model call. The cache key is unchanged
 * (identity + algorithm version), so a live-researched summary and an offline one
 * for the same identity share a ref and the read path stays a plain lookup.
 * Called once per onboarding/website change (write side), never per review.
 */
export async function computeBusinessContextCacheAsync(
  identity: BusinessIdentity,
  researcher: AsyncBusinessResearcher,
): Promise<BusinessContextCache> {
  if (!hasBusinessIdentity(identity)) {
    return { summary: null, contextRef: null };
  }
  const summary = boundSummary(await researcher.research(identity));
  if (summary.length === 0) {
    return { summary: null, contextRef: null };
  }
  return { summary, contextRef: businessContextRef(identity) };
}

/** How a researched summary was produced — for observability + the readiness report. */
export type ResearchSource = "live" | "offline" | "none";

/** The result of researching a business: the summary, cache ref, and how it was sourced. */
export interface BusinessResearchResult extends BusinessContextCache {
  source: ResearchSource;
}

/**
 * Research a business for the write path, preferring the live researcher when one
 * is configured and **always** falling back to the deterministic offline floor —
 * so the save path never fails or produces nothing just because a live key is
 * absent or a web search turns up empty (Rules.md §6 fail-safe). With no live
 * researcher (`null`), or if the live call yields nothing or throws, the offline
 * summary is used. This is the function the onboarding/save action would call to
 * "swap in" live research behind the seam without any other code change.
 */
export async function researchBusinessContext(
  identity: BusinessIdentity,
  live: AsyncBusinessResearcher | null,
): Promise<BusinessResearchResult> {
  if (!hasBusinessIdentity(identity)) {
    return { summary: null, contextRef: null, source: "none" };
  }
  if (live) {
    try {
      const cache = await computeBusinessContextCacheAsync(identity, live);
      if (cache.summary) return { ...cache, source: "live" };
    } catch {
      // Live research is best-effort grounding; never let it break a save. Fall
      // through to the offline floor (no secrets/PII in logs — Rules.md §6; the
      // caller logs the failure with context if it wants to).
    }
  }
  const offline = computeBusinessContextCache(identity);
  return offline.summary
    ? { ...offline, source: "offline" }
    : { summary: null, contextRef: null, source: "none" };
}

/** Whether a company's stored business-context cache is current for its identity. */
export function isBusinessContextFresh(
  company: Pick<CompanyRow, "business_context_ref">,
  identity: BusinessIdentity,
): boolean {
  if (!company.business_context_ref) return false;
  return company.business_context_ref === businessContextRef(identity);
}

/** The business context to inject into a review, plus where it was sourced from. */
export interface ResolvedBusinessContext {
  /** Bounded business context for every juror; null when there is nothing to say. */
  summary: string | null;
  source: BusinessContextSource;
}

/**
 * Resolve the business context to inject into a review (read side of the cache;
 * Architecture.md §5 "reuse cached … rather than reprocessing"). Mirrors
 * `resolveBrandSummary`:
 *
 * - No identity (no name/industry/website) → `null` (`source: "none"`).
 * - Fresh cache — a stored `business_summary` whose `business_context_ref` matches
 *   the company's current identity + algorithm version — → reuse it verbatim
 *   (`source: "cache"`), no re-research.
 * - Cache missing or stale → recompute the **same** bounded summary offline this
 *   once (`source: "recomputed"`); the next save repopulates the cache. (A live
 *   researcher is not called on the read path — re-researching per review is
 *   exactly the per-review cost the cache exists to remove.)
 */
export function resolveBusinessContext(
  company: Pick<
    CompanyRow,
    "name" | "industry" | "website_url" | "business_summary" | "business_context_ref"
  >,
): ResolvedBusinessContext {
  const identity: BusinessIdentity = {
    name: company.name,
    industry: company.industry,
    websiteUrl: company.website_url,
  };
  if (!hasBusinessIdentity(identity)) {
    return { summary: null, source: "none" };
  }
  const cached = normalizeText(company.business_summary);
  if (cached.length > 0 && isBusinessContextFresh(company, identity)) {
    return { summary: cached, source: "cache" };
  }
  const summary = boundSummary(offlineBusinessResearcher.research(identity));
  return summary.length > 0
    ? { summary, source: "recomputed" }
    : { summary: null, source: "none" };
}
