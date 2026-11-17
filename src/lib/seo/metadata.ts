/**
 * SEO & social metadata (DailyPlan Day 80 — Week 12 deploy & launch prep).
 *
 * "Domain, OG/meta tags, favicon, sitemap basics. DoD: shareable, indexable pages."
 *
 * This is the single, PURE, node-testable source of truth for every SEO surface:
 * the canonical site origin, the per-page `<title>`/description/OpenGraph/Twitter
 * metadata, the `robots.txt` policy, and the sitemap entries. The thin Next
 * runtime files (`app/layout.tsx`, `app/robots.ts`, `app/sitemap.ts`, the public
 * pages' `metadata` exports) consume this core and add no SEO logic of their own,
 * so "shareable, indexable pages" is a property that is checked offline with no
 * browser, no crawler and no live domain.
 *
 * It composes the existing route inventory rather than restating it: the set of
 * indexable/blocked routes is derived from the Day-79 `auditRoutePostures`
 * (deploy-plan) plus one small, explicit per-public-route indexability decision,
 * so sitemap/robots can never silently drift from the routes that actually ship
 * (cf. Day 43/46/78 "static inventory + reconcile drift guard"). A new public
 * route forces an indexability decision the same way a new route forces a posture
 * decision — `reconcileSeo` flags the omission instead of guessing.
 *
 * Surfaces:
 *   1. SITE URL         — resolve the absolute origin from `NEXT_PUBLIC_APP_URL`
 *                         (the Day-79 domain var), with a documented placeholder
 *                         fallback; never throws.
 *   2. METADATA         — root defaults (metadataBase, title template, default OG/
 *                         Twitter, icons, robots) + per-page canonical/OG/Twitter.
 *   3. ROUTE POLICY     — which routes are indexable (sitemap + allowed) vs
 *                         noindex (private/auth) vs blocked, composed from the
 *                         route-posture audit.
 *   4. ROBOTS + SITEMAP — build the `robots.txt` rules and sitemap entries from
 *                         the policy, plus `reconcileSeo` as the drift guard.
 */

import type { Metadata } from "next";
import {
  auditRoutePostures,
  type RoutePostureAudit,
} from "@/lib/deploy/deploy-plan";

// ── 1. Site URL ──────────────────────────────────────────────────────────────

/**
 * Documented placeholder origin used when `NEXT_PUBLIC_APP_URL` is unset. It uses
 * the reserved `.example` TLD on purpose (mirrors the demo-data convention) so a
 * credential-less cloud build never claims or links to a domain nobody owns — the
 * real domain is wired at deploy by setting `NEXT_PUBLIC_APP_URL` (Day 79,
 * docs/DEPLOYMENT.md §5). Absolute canonical/OG URLs still resolve against it, and
 * `isPlaceholder` lets callers (and the readiness checks) see it is not the real
 * origin yet.
 */
export const PLACEHOLDER_SITE_URL = "https://adjury.example";

export interface ResolvedSiteUrl {
  /** Absolute origin with no trailing slash, e.g. "https://adjury.app". */
  url: string;
  /** True when we fell back to `PLACEHOLDER_SITE_URL` (no valid env value). */
  isPlaceholder: boolean;
}

/** Strip trailing slash(es); "" stays "". */
function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

/**
 * Resolve the canonical site origin. Accepts the raw `NEXT_PUBLIC_APP_URL` value
 * (which may be undefined/empty/garbage) and returns a usable absolute origin,
 * never throwing:
 *   - trims whitespace;
 *   - requires an http(s) URL (a bare host or a non-http scheme is rejected);
 *   - reduces to just the origin (scheme + host + port) — a path/query/hash on the
 *     env value is dropped so canonical URLs are built from a clean base;
 *   - strips any trailing slash.
 * Falls back to `PLACEHOLDER_SITE_URL` on anything invalid.
 */
export function resolveSiteUrl(raw?: string | null): ResolvedSiteUrl {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length > 0) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return { url: stripTrailingSlash(parsed.origin), isPlaceholder: false };
      }
    } catch {
      // fall through to the placeholder
    }
  }
  return { url: PLACEHOLDER_SITE_URL, isPlaceholder: true };
}

/**
 * Join the site origin with an app-relative path into an absolute URL. The path
 * is normalized to exactly one leading slash; "/" and "" both map to the bare
 * origin (no trailing slash) so a canonical home URL is stable.
 */
export function canonicalUrl(siteUrl: string, path: string): string {
  const base = stripTrailingSlash(siteUrl);
  const p = (path ?? "").trim();
  if (p === "" || p === "/") return base;
  const withSlash = p.startsWith("/") ? p : `/${p}`;
  return `${base}${withSlash}`;
}

// ── 2. Metadata ──────────────────────────────────────────────────────────────

/** Brand/product constants reused across every metadata surface. */
export const SITE_NAME = "AdJury";
export const TITLE_SUFFIX = " — AdJury";
/** Default document title used when a page sets none (home + fallback). */
export const DEFAULT_TITLE = "AdJury — AI content critique";
/**
 * Default social/description copy. Kept in sync with the product's one-line
 * value proposition; short enough for OG/Twitter and search snippets.
 */
export const DEFAULT_DESCRIPTION =
  "Six AI juror personas review your marketing content before you publish — " +
  "brand voice, compliance, audience fit, SEO, hook, and business fit, each with " +
  "a score and a suggested rewrite.";

/** Robots directive for a page that must never be indexed (private/auth). */
export const NOINDEX_ROBOTS: NonNullable<Metadata["robots"]> = {
  index: false,
  follow: false,
  googleBot: { index: false, follow: false },
};

/** Robots directive for a public, indexable page. */
export const INDEX_ROBOTS: NonNullable<Metadata["robots"]> = {
  index: true,
  follow: true,
};

/**
 * Root metadata applied once in `app/layout.tsx`. Establishes:
 *   - `metadataBase` so every relative canonical/OG URL resolves to an absolute
 *     URL against the configured origin (Next needs this for correct OG tags);
 *   - a title template (`%s — AdJury`) with a sensible default;
 *   - site-wide default description + OpenGraph + Twitter card (summary_large_image
 *     so a shared link renders a large preview);
 *   - a default `index,follow` robots policy that private pages override to
 *     `noindex` via `NOINDEX_ROBOTS`.
 * The favicon is the file-based `app/icon.svg` and the OG/Twitter *image* is the
 * file-based `app/opengraph-image` — both auto-register, so neither the icon set
 * nor the social image is restated here (restating `icons` would emit a duplicate
 * <link>).
 */
export function buildRootMetadata(siteUrl: string): Metadata {
  const base = stripTrailingSlash(siteUrl);
  return {
    metadataBase: new URL(base),
    title: {
      default: DEFAULT_TITLE,
      template: `%s${TITLE_SUFFIX}`,
    },
    description: DEFAULT_DESCRIPTION,
    applicationName: SITE_NAME,
    alternates: { canonical: "/" },
    robots: INDEX_ROBOTS,
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_US",
      url: base,
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
    },
    twitter: {
      card: "summary_large_image",
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
    },
  };
}

export interface PageMetadataInput {
  /** The page title *without* the brand suffix (the template adds it). */
  title: string;
  description?: string;
  /** App-relative path for the canonical + OG url, e.g. "/pricing". */
  path: string;
  /** Override the default public `index,follow` (e.g. `NOINDEX_ROBOTS`). */
  robots?: Metadata["robots"];
}

/**
 * Per-page metadata for a public page: a relative canonical URL (resolved to
 * absolute via the root `metadataBase`), matching OpenGraph `url`/title/description
 * and Twitter title/description, so a shared link to any page carries its own
 * accurate preview rather than only the site default. `title` flows through the
 * root template, so callers pass just the page's own title.
 */
export function buildPageMetadata(input: PageMetadataInput): Metadata {
  const description = input.description ?? DEFAULT_DESCRIPTION;
  const canonicalPath =
    input.path === "" || input.path === "/" ? "/" : input.path;
  const ogTitle = `${input.title}${TITLE_SUFFIX}`;
  const meta: Metadata = {
    title: input.title,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: {
      url: canonicalPath,
      title: ogTitle,
      description,
    },
    twitter: {
      title: ogTitle,
      description,
    },
  };
  if (input.robots !== undefined) meta.robots = input.robots;
  return meta;
}

/**
 * Metadata for a private/guarded or auth page: keeps a human title but forbids
 * indexing (an authed dashboard or a login form must never surface in search).
 */
export function buildNoindexMetadata(title: string): Metadata {
  return { title, robots: NOINDEX_ROBOTS };
}

// ── 3. Route policy (composed from the route-posture inventory) ──────────────

/**
 * Per-PUBLIC-route indexability decision. Public posture (Day 79) means "served
 * to an unauthenticated visitor"; that is necessary but not sufficient for
 * indexing — the auth forms and the bearer-token invite page are public yet must
 * stay out of search. Every public route therefore carries an explicit
 * decision here, and `reconcileSeo` flags a public route with no entry (so a new
 * public route forces the call rather than defaulting into the index).
 */
export const PUBLIC_ROUTE_INDEXABLE: Record<string, boolean> = {
  "/": true,
  "/pricing": true,
  // Public but intentionally not indexed:
  "/login": false,
  "/signup": false,
  "/invite/[token]": false, // bearer-token page — never index
};

export interface SeoRouteClassification {
  /** Public, non-dynamic, indexable routes → sitemap + robots allow. */
  indexable: string[];
  /** Public routes deliberately kept out of the index (auth, invite). */
  noindexPublic: string[];
  /** Guarded (behind-auth) routes → noindex + robots disallow. */
  guarded: string[];
  /** Public routes with no indexability decision (drift — must be declared). */
  undeclared: string[];
}

/**
 * Classify every route in a posture audit into its SEO treatment. Pure: the
 * caller supplies the audit (tests feed it the real `src/app` tree via
 * `auditRoutePostures`). A dynamic indexable route is demoted to `noindexPublic`
 * — a sitemap can only list concrete URLs, not `[param]` templates.
 */
export function classifySeo(audit: RoutePostureAudit): SeoRouteClassification {
  const indexable: string[] = [];
  const noindexPublic: string[] = [];
  const guarded: string[] = [];
  const undeclared: string[] = [];

  for (const page of audit.pages) {
    if (page.posture === "guarded") {
      guarded.push(page.route);
      continue;
    }
    // public
    const decision = PUBLIC_ROUTE_INDEXABLE[page.route];
    if (decision === undefined) {
      undeclared.push(page.route);
      continue;
    }
    if (decision && !page.dynamic) indexable.push(page.route);
    else noindexPublic.push(page.route);
  }

  indexable.sort();
  noindexPublic.sort();
  guarded.sort();
  undeclared.sort();
  return { indexable, noindexPublic, guarded, undeclared };
}

/**
 * The static, runtime-facing SEO route lists. The sitemap/robots route files run
 * in the Next runtime and must not scan the source tree, so they read these
 * frozen constants; `reconcileSeo` proves they still equal what `classifySeo`
 * derives from the real routes on disk, so the two representations cannot drift.
 */
export const INDEXABLE_ROUTES: readonly string[] = ["/", "/pricing"] as const;

/**
 * Path prefixes `robots.txt` disallows. Everything not public-indexable: the API,
 * every guarded (behind-auth) area, and the public-but-noindex auth/invite pages.
 * Prefixes (not exact routes) so nested paths like `/review/123` are covered.
 */
export const ROBOTS_DISALLOW: readonly string[] = [
  "/api/",
  "/account",
  "/analytics",
  "/brand",
  "/dashboard",
  "/history",
  "/invite/",
  "/login",
  "/onboarding",
  "/review",
  "/settings",
  "/signup",
  "/team",
] as const;

// ── 4. robots.txt + sitemap ──────────────────────────────────────────────────

export interface RobotsRule {
  userAgent: string;
  allow: string[];
  disallow: string[];
}

export interface RobotsPolicy {
  rules: RobotsRule[];
  sitemap: string;
  host: string;
}

/**
 * Build the `robots.txt` policy for the configured origin: allow the site root,
 * disallow every non-indexable prefix, and point crawlers at the sitemap. Shape
 * matches Next's `MetadataRoute.Robots` so `app/robots.ts` returns it directly.
 */
export function buildRobotsPolicy(siteUrl: string): RobotsPolicy {
  const host = stripTrailingSlash(siteUrl);
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/"],
        disallow: [...ROBOTS_DISALLOW],
      },
    ],
    sitemap: canonicalUrl(host, "/sitemap.xml"),
    host,
  };
}

export type ChangeFrequency =
  | "always"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "never";

export interface SitemapEntry {
  url: string;
  lastModified: string;
  changeFrequency: ChangeFrequency;
  priority: number;
}

/**
 * Per-route sitemap hints. The home page is the highest-priority, most-frequently
 * refreshed public surface; pricing changes less often. Only routes in
 * `INDEXABLE_ROUTES` appear — robots blocks everything else.
 */
const SITEMAP_HINTS: Record<
  string,
  { changeFrequency: ChangeFrequency; priority: number }
> = {
  "/": { changeFrequency: "weekly", priority: 1.0 },
  "/pricing": { changeFrequency: "monthly", priority: 0.8 },
};

/**
 * Build sitemap entries (absolute URLs) for the indexable routes. `now` is
 * injected (not read from the clock) so the output is deterministic and testable;
 * callers pass `new Date()`. Shape matches Next's `MetadataRoute.Sitemap`.
 */
export function buildSitemap(siteUrl: string, now: Date): SitemapEntry[] {
  const lastModified = now.toISOString();
  return INDEXABLE_ROUTES.map((route) => {
    const hint = SITEMAP_HINTS[route] ?? {
      changeFrequency: "monthly" as ChangeFrequency,
      priority: 0.5,
    };
    return {
      url: canonicalUrl(siteUrl, route),
      lastModified,
      changeFrequency: hint.changeFrequency,
      priority: hint.priority,
    };
  });
}

// ── 5. Reconcile (drift guard) ───────────────────────────────────────────────

export interface SeoReconcileResult {
  ok: boolean;
  issues: string[];
  classification: SeoRouteClassification;
}

/**
 * Prove the static SEO policy still matches the routes that actually ship, and is
 * internally consistent. Takes the real `src/app` page paths (the test reads them
 * from disk), classifies them, and checks:
 *   - no public route lacks an indexability decision (`undeclared` empty);
 *   - the derived indexable set equals the static `INDEXABLE_ROUTES` (sitemap);
 *   - nothing indexable is also blocked by `robots.txt` (no "index but disallow"
 *     contradiction), and nothing blocked sneaks into the sitemap;
 *   - every guarded and every noindex-public route IS covered by a
 *     `ROBOTS_DISALLOW` prefix (private/auth surfaces are fenced off);
 *   - the API is disallowed and the indexable set is non-empty (non-vacuous).
 */
export function reconcileSeo(pagePaths: readonly string[]): SeoReconcileResult {
  const audit = auditRoutePostures(pagePaths);
  const classification = classifySeo(audit);
  const issues: string[] = [];

  if (classification.undeclared.length > 0) {
    issues.push(
      `public route(s) with no indexability decision: ${classification.undeclared.join(", ")}`,
    );
  }

  const derivedIndexable = [...classification.indexable].sort();
  const staticIndexable = [...INDEXABLE_ROUTES].sort();
  if (derivedIndexable.join("|") !== staticIndexable.join("|")) {
    issues.push(
      `INDEXABLE_ROUTES drift: static [${staticIndexable.join(", ")}] vs derived [${derivedIndexable.join(", ")}]`,
    );
  }

  const isBlocked = (route: string): boolean =>
    ROBOTS_DISALLOW.some((prefix) => route === prefix || route.startsWith(prefix));

  for (const route of classification.indexable) {
    if (isBlocked(route)) {
      issues.push(`indexable route is also robots-disallowed: ${route}`);
    }
  }

  for (const route of [...classification.guarded, ...classification.noindexPublic]) {
    if (!isBlocked(route)) {
      issues.push(`private/auth route not covered by robots disallow: ${route}`);
    }
  }

  if (!ROBOTS_DISALLOW.includes("/api/")) {
    issues.push("robots must disallow /api/");
  }
  if (classification.indexable.length === 0) {
    issues.push("no indexable routes (sitemap would be empty)");
  }

  return { ok: issues.length === 0, issues, classification };
}
