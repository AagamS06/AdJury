import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  PLACEHOLDER_SITE_URL,
  SITE_NAME,
  DEFAULT_TITLE,
  DEFAULT_DESCRIPTION,
  TITLE_SUFFIX,
  NOINDEX_ROBOTS,
  INDEX_ROBOTS,
  INDEXABLE_ROUTES,
  ROBOTS_DISALLOW,
  PUBLIC_ROUTE_INDEXABLE,
  resolveSiteUrl,
  canonicalUrl,
  buildRootMetadata,
  buildPageMetadata,
  buildNoindexMetadata,
  classifySeo,
  buildRobotsPolicy,
  buildSitemap,
  reconcileSeo,
} from "@/lib/seo/metadata";
import { auditRoutePostures } from "@/lib/deploy/deploy-plan";

/**
 * SEO & social metadata (DailyPlan Day 80 — Week 12 deploy & launch prep).
 *
 * "Domain, OG/meta tags, favicon, sitemap basics. DoD: shareable, indexable pages."
 *
 * The offline-verifiable DoD runs here over the REAL repo: the site-URL resolver
 * never throws and rejects garbage, the metadata builders emit correct canonical/
 * OpenGraph/Twitter tags, robots.txt and the sitemap are built from the SAME route
 * inventory the rest of the app ships (so they can't drift), every private/auth
 * route is fenced off, and `reconcileSeo` proves the static policy still matches
 * the routes on disk — plus each scanner is shown to bite a planted fault.
 */

// ── Load the real route tree, as the sitemap/robots reconcile does ───────────

const appDir = fileURLToPath(new URL("../src/app", import.meta.url));

function collectAppFiles(leaf: string): string[] {
  const out: string[] = [];
  function walk(absDir: string, rel: string): void {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const abs = `${absDir}/${entry.name}`;
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(abs, childRel);
      else if (entry.name === leaf) out.push(childRel);
    }
  }
  walk(appDir, "src/app");
  return out;
}

function realPagePaths(): string[] {
  return collectAppFiles("page.tsx");
}

const NOW = new Date("2026-11-16T00:00:00.000Z");

// ── 1. Site URL resolution ───────────────────────────────────────────────────

describe("resolveSiteUrl", () => {
  it("uses a valid https env value, stripped to its origin with no trailing slash", () => {
    expect(resolveSiteUrl("https://adjury.app/")).toEqual({
      url: "https://adjury.app",
      isPlaceholder: false,
    });
    expect(resolveSiteUrl("https://adjury.app/some/path?x=1#h")).toEqual({
      url: "https://adjury.app",
      isPlaceholder: false,
    });
    expect(resolveSiteUrl("http://localhost:3000")).toEqual({
      url: "http://localhost:3000",
      isPlaceholder: false,
    });
  });

  it("falls back to the documented placeholder on missing/blank/invalid values (never throws)", () => {
    for (const bad of [
      undefined,
      null,
      "",
      "   ",
      "not a url",
      "adjury.app", // bare host, no scheme
      "ftp://adjury.app", // non-http scheme
      "javascript:alert(1)",
    ]) {
      const r = resolveSiteUrl(bad as string | null | undefined);
      expect(r).toEqual({ url: PLACEHOLDER_SITE_URL, isPlaceholder: true });
    }
  });

  it("the placeholder uses the reserved .example TLD (claims no real domain)", () => {
    expect(PLACEHOLDER_SITE_URL).toMatch(/^https:\/\/[^/]+\.example$/);
    expect(resolveSiteUrl(undefined).isPlaceholder).toBe(true);
  });
});

describe("canonicalUrl", () => {
  it("joins origin + path, normalizing slashes; home maps to the bare origin", () => {
    expect(canonicalUrl("https://adjury.app", "/")).toBe("https://adjury.app");
    expect(canonicalUrl("https://adjury.app/", "")).toBe("https://adjury.app");
    expect(canonicalUrl("https://adjury.app", "/pricing")).toBe(
      "https://adjury.app/pricing",
    );
    expect(canonicalUrl("https://adjury.app", "pricing")).toBe(
      "https://adjury.app/pricing",
    );
    expect(canonicalUrl("https://adjury.app/", "/sitemap.xml")).toBe(
      "https://adjury.app/sitemap.xml",
    );
  });
});

// ── 2. Metadata builders ──────────────────────────────────────────────────────

describe("buildRootMetadata", () => {
  const meta = buildRootMetadata("https://adjury.app");

  it("sets metadataBase to the configured origin", () => {
    expect(meta.metadataBase).toBeInstanceOf(URL);
    expect(meta.metadataBase?.toString()).toBe("https://adjury.app/");
  });

  it("defines a brand title template with a sensible default", () => {
    expect(meta.title).toEqual({
      default: DEFAULT_TITLE,
      template: `%s${TITLE_SUFFIX}`,
    });
  });

  it("is indexable by default and declares the home canonical", () => {
    expect(meta.robots).toEqual(INDEX_ROBOTS);
    expect(meta.alternates?.canonical).toBe("/");
  });

  it("emits a website OpenGraph object and a large-image Twitter card", () => {
    expect(meta.openGraph).toMatchObject({
      type: "website",
      siteName: SITE_NAME,
      url: "https://adjury.app",
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
    });
    expect(meta.twitter).toMatchObject({
      card: "summary_large_image",
      title: DEFAULT_TITLE,
    });
  });

  it("does NOT restate icons (file-based app/icon.svg owns the favicon)", () => {
    // Restating `icons` here would emit a duplicate <link rel=icon>.
    expect(meta.icons).toBeUndefined();
  });
});

describe("buildPageMetadata", () => {
  it("builds a relative canonical + matching OG/Twitter for a public page", () => {
    const meta = buildPageMetadata({
      title: "Pricing",
      description: "Plans and prices.",
      path: "/pricing",
    });
    expect(meta.title).toBe("Pricing");
    expect(meta.alternates?.canonical).toBe("/pricing");
    expect(meta.openGraph).toMatchObject({
      url: "/pricing",
      title: `Pricing${TITLE_SUFFIX}`,
      description: "Plans and prices.",
    });
    expect(meta.twitter).toMatchObject({
      title: `Pricing${TITLE_SUFFIX}`,
      description: "Plans and prices.",
    });
    // Public page: no robots override (inherits the root index,follow default).
    expect(meta.robots).toBeUndefined();
  });

  it("falls back to the default description and normalizes the home path", () => {
    const meta = buildPageMetadata({ title: "Home", path: "/" });
    expect(meta.description).toBe(DEFAULT_DESCRIPTION);
    expect(meta.alternates?.canonical).toBe("/");
    expect(meta.openGraph).toMatchObject({ url: "/" });
  });

  it("applies an explicit robots override when given", () => {
    const meta = buildPageMetadata({
      title: "Secret",
      path: "/secret",
      robots: NOINDEX_ROBOTS,
    });
    expect(meta.robots).toEqual(NOINDEX_ROBOTS);
  });
});

describe("buildNoindexMetadata", () => {
  it("keeps a title but forbids indexing", () => {
    const meta = buildNoindexMetadata("Dashboard");
    expect(meta.title).toBe("Dashboard");
    expect(meta.robots).toEqual(NOINDEX_ROBOTS);
    expect(NOINDEX_ROBOTS).toMatchObject({ index: false, follow: false });
  });
});

// ── 3. Route classification (composed from the posture inventory) ────────────

describe("classifySeo", () => {
  it("splits real routes into indexable / noindex-public / guarded with no undeclared", () => {
    const audit = auditRoutePostures(realPagePaths());
    const c = classifySeo(audit);

    expect(c.undeclared).toEqual([]);
    expect(c.indexable).toEqual(["/", "/pricing"]);
    // The public auth + invite pages are public but deliberately not indexed.
    expect(c.noindexPublic).toEqual(expect.arrayContaining(["/login", "/signup"]));
    expect(c.noindexPublic).toContain("/invite/[token]");
    // Guarded areas are all present and none leak into indexable.
    expect(c.guarded).toEqual(
      expect.arrayContaining([
        "/account",
        "/analytics",
        "/brand",
        "/dashboard",
        "/history",
        "/review",
        "/review/[id]",
        "/settings",
        "/team",
        "/onboarding",
      ]),
    );
    for (const r of c.indexable) expect(c.guarded).not.toContain(r);
  });

  it("records a public route with no indexability decision as undeclared (forces a call)", () => {
    // A public page whose route is absent from PUBLIC_ROUTE_INDEXABLE must not be
    // guessed into (or out of) the index — it is reported as undeclared.
    const synthetic = {
      pages: [
        { route: "/campaign", path: "src/app/campaign/page.tsx", posture: "public" as const, dynamic: false },
      ],
      undeclared: [],
      count: 1,
      clean: true,
    };
    const c = classifySeo(synthetic);
    expect(c.undeclared).toEqual(["/campaign"]);
    expect(c.indexable).toEqual([]);
  });

  it("demotes a dynamic indexable route to noindex-public (a sitemap needs concrete URLs)", () => {
    const synthetic = {
      pages: [
        { route: "/", path: "src/app/page.tsx", posture: "public" as const, dynamic: false },
        { route: "/pricing", path: "src/app/pricing/page.tsx", posture: "public" as const, dynamic: false },
        // pretend an indexable route is dynamic:
        { route: "/invite/[token]", path: "src/app/invite/[token]/page.tsx", posture: "public" as const, dynamic: true },
      ],
      undeclared: [],
      count: 3,
      clean: true,
    };
    const c = classifySeo(synthetic);
    expect(c.indexable).toEqual(["/", "/pricing"]);
    expect(c.noindexPublic).toContain("/invite/[token]");
  });
});

// ── 4. robots.txt + sitemap ──────────────────────────────────────────────────

describe("buildRobotsPolicy", () => {
  const policy = buildRobotsPolicy("https://adjury.app/");

  it("allows the root and disallows every non-indexable prefix", () => {
    expect(policy.rules).toHaveLength(1);
    expect(policy.rules[0].userAgent).toBe("*");
    expect(policy.rules[0].allow).toEqual(["/"]);
    expect(policy.rules[0].disallow).toEqual([...ROBOTS_DISALLOW]);
    expect(policy.rules[0].disallow).toContain("/api/");
  });

  it("points crawlers at the absolute sitemap URL and sets host", () => {
    expect(policy.sitemap).toBe("https://adjury.app/sitemap.xml");
    expect(policy.host).toBe("https://adjury.app");
  });
});

describe("buildSitemap", () => {
  const entries = buildSitemap("https://adjury.app", NOW);

  it("lists exactly the indexable routes as absolute URLs", () => {
    expect(entries.map((e) => e.url)).toEqual([
      "https://adjury.app",
      "https://adjury.app/pricing",
    ]);
  });

  it("uses the injected timestamp and valid change frequencies + priorities", () => {
    for (const e of entries) {
      expect(e.lastModified).toBe(NOW.toISOString());
      expect(e.priority).toBeGreaterThan(0);
      expect(e.priority).toBeLessThanOrEqual(1);
      expect([
        "always",
        "hourly",
        "daily",
        "weekly",
        "monthly",
        "yearly",
        "never",
      ]).toContain(e.changeFrequency);
    }
    // Home is the highest-priority surface.
    const home = entries.find((e) => e.url === "https://adjury.app");
    expect(home?.priority).toBe(1.0);
  });

  it("covers every INDEXABLE_ROUTES entry and nothing else", () => {
    expect(entries).toHaveLength(INDEXABLE_ROUTES.length);
  });
});

// ── 5. Reconcile (drift guard) over the REAL repo ────────────────────────────

describe("reconcileSeo over the real route tree", () => {
  const result = reconcileSeo(realPagePaths());

  it("is clean: static policy matches the routes on disk", () => {
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("is non-vacuous: there really are indexable routes", () => {
    expect(result.classification.indexable.length).toBeGreaterThan(0);
    expect(INDEXABLE_ROUTES.length).toBeGreaterThan(0);
  });

  it("no indexable route is also robots-disallowed, and no sitemap route is blocked", () => {
    const blocked = (route: string) =>
      ROBOTS_DISALLOW.some((p) => route === p || route.startsWith(p));
    for (const r of result.classification.indexable) {
      expect(blocked(r)).toBe(false);
    }
  });

  it("every guarded and noindex-public route IS fenced off by robots disallow", () => {
    const blocked = (route: string) =>
      ROBOTS_DISALLOW.some((p) => route === p || route.startsWith(p));
    for (const r of [
      ...result.classification.guarded,
      ...result.classification.noindexPublic,
    ]) {
      expect(blocked(r)).toBe(true);
    }
  });
});

describe("reconcileSeo bites planted faults", () => {
  it("flags a public route with no SEO indexability decision", () => {
    // `/campaign` is public but absent from PUBLIC_ROUTE_INDEXABLE.
    expect(PUBLIC_ROUTE_INDEXABLE["/campaign"]).toBeUndefined();
    // The route-posture audit declares ungrouped routes, so add it via a group
    // that classifies as public: an `(auth)`-grouped page is public posture.
    const paths = [...realPagePaths(), "src/app/(auth)/campaign/page.tsx"];
    const result = reconcileSeo(paths);
    expect(result.ok).toBe(false);
    expect(result.issues.join(" ")).toContain("/campaign");
  });

  it("flags INDEXABLE_ROUTES drift when a declared-indexable public route disappears", () => {
    // Drop /pricing from disk: derived indexable no longer equals the static list.
    const paths = realPagePaths().filter(
      (p) => p !== "src/app/pricing/page.tsx",
    );
    const result = reconcileSeo(paths);
    expect(result.ok).toBe(false);
    expect(result.issues.join(" ")).toContain("INDEXABLE_ROUTES drift");
  });
});

// ── 6. The static constants are internally sane ──────────────────────────────

describe("static SEO constants", () => {
  it("robots disallows the API and every indexable route avoids every disallow prefix", () => {
    expect(ROBOTS_DISALLOW).toContain("/api/");
    for (const r of INDEXABLE_ROUTES) {
      for (const prefix of ROBOTS_DISALLOW) {
        expect(r === prefix || r.startsWith(prefix)).toBe(false);
      }
    }
  });

  it("every PUBLIC_ROUTE_INDEXABLE=false route is covered by a disallow prefix", () => {
    for (const [route, indexable] of Object.entries(PUBLIC_ROUTE_INDEXABLE)) {
      if (!indexable) {
        const covered = ROBOTS_DISALLOW.some(
          (p) => route === p || route.startsWith(p),
        );
        expect(covered).toBe(true);
      }
    }
  });
});
