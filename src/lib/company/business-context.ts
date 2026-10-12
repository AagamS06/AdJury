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
 * ── Live research (needs credentials / network — owner action) ───────────────
 * The offline researcher summarizes only the inputs the company already gave us.
 * To ground reviews in what the site actually says, wire a `BusinessResearcher`
 * that calls Claude's web search tool (web_search) over `website_url` + name, and
 * run it once per identity change (on save), caching the result here. That needs
 * a live `AI_API_KEY` + outbound network, neither of which exists in the cloud
 * build, so it is left as a documented seam — the cache/plumbing/reviews are all
 * proven offline today.
 */
import { createHash } from "node:crypto";
import type { CompanyRow } from "@/types/db";

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
