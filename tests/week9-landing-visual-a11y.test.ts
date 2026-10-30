import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  HERO,
  FINAL_CTA,
  FOOTER_COLUMNS,
  LANDING_SECTION_IDS,
  heroCtasFor,
  jurySummaries,
  type HeroCta,
  type FooterLink,
} from "@/lib/marketing/landing";
import { auditPalette } from "@/lib/ui/palette-audit";
import { auditResponsive } from "@/lib/ui/responsive-audit";
import {
  auditSemantics,
  auditCorePage,
  verifyAccessibilityAA,
  CORE_PAGES,
  type SourceModule,
  type CorePage,
} from "@/lib/ui/semantics-audit";
import { PERSONAS } from "@/lib/ai/personas";

/**
 * Week 9 hardening (DailyPlan Day 63) — landing & visual/responsive/a11y integration.
 *
 * Week 9 built the public landing page (Day 57 hero → Day 58 body → Day 59
 * CTA/footer, all over the pure `lib/marketing/landing.ts` core) and then shipped
 * three source-level verification audits — Day 60 `palette-audit` (no off-palette
 * colour), Day 61 `responsive-audit` (no horizontal overflow at phone width), and
 * Day 62 `semantics-audit` + `verifyAccessibilityAA` (WCAG-AA semantics on core
 * flows). Each of those days has its own per-day suite (`landing.test`,
 * `palette-audit.test`, `responsive-audit.test`, `semantics-audit.test`) and each
 * reads only its own slice: a landing suite that never runs an audit, and three
 * audit suites that each walk the tree and run ONE scanner.
 *
 * This is the week-end integration complement (mirroring the Day 7/14/21/28/35/
 * 42/49/56 passes): NO new product surface — it wires the REAL Week-9 cores
 * together and proves the week's invariants COMPOSE across the whole landing/
 * visual surface, and that the surfaces AGREE with one another — properties no
 * single-day suite can see:
 *
 *  1. The three Week-9 audits share ONE source model: the suite walks the real
 *     tree once and runs palette + responsive + semantics + the composite
 *     `verifyAccessibilityAA` over that one module set, so "the whole app clears
 *     the visual pass AND the responsive pass AND WCAG-AA together" is one verdict
 *     — not three separately-loaded passes that never meet. The module set is
 *     proved non-trivial and proved to include the Week-9 marketing surface, so
 *     the clean result is not vacuous with respect to the page Week 9 shipped.
 *  2. The landing surface Week 9 built (Days 57–59) itself clears ALL THREE Day
 *     60–62 audits — scoped to just the marketing files + the landing `page.tsx`,
 *     so the whole-repo clean can't be carried by older code: the NEW page is
 *     on-palette, overflow-safe, and semantically clean on its own. No single day
 *     proves the landing components pass audits shipped on later days.
 *  3. The landing page's structure agrees with the Day-62 core-page invariant: the
 *     "/" flow composes (its real files on disk) to exactly one `<h1>` (owned by
 *     `landing-hero.tsx`) and exactly one `<main>` landmark (owned by `page.tsx`)
 *     — tying the Day-57 hero copy to the Day-62 a11y structural check.
 *  4. Every outbound link the landing core emits AGREES with the real route tree
 *     on disk and the shared section ids: each hero CTA (both auth states) and
 *     each footer link resolves either to a real `page.tsx` route or to a real
 *     in-page `LANDING_SECTION_IDS` anchor — a cross-day agreement between
 *     `landing.ts` and `src/app` that neither the landing suite (no route tree)
 *     nor the audits (no link model) can see. The closing CTA band reuses the
 *     SAME `heroCtasFor` resolver, so hero and footer CTAs can never diverge.
 *  5. The jury shown on the landing page is DERIVED from the real `PERSONAS`
 *     roster the orchestrator runs — not a re-typed marketing list — so the public
 *     page can never drift from the jury that actually reviews content.
 *
 * All offline (no live model/DB/bundler): the audits read source text and the
 * landing core is pure data + pure functions, so exercising them together is
 * faithful to what ships.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/** Recursively collect every .ts/.tsx under src/, path repo-relative (POSIX). */
function loadSrcModules(): SourceModule[] {
  const out: SourceModule[] = [];
  function walk(absDir: string, rel: string): void {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const abs = `${absDir}/${entry.name}`;
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(abs, childRel);
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        out.push({ path: childRel, src: readFileSync(abs, "utf8") });
      }
    }
  }
  walk(`${repoRoot}src`, "src");
  return out;
}

/**
 * The URL route a `src/app/.../page.tsx` renders: strip the `src/app` prefix and
 * the `page.tsx` leaf, drop `(group)` route-group segments (they never appear in
 * the URL), and keep `[param]` dynamic segments as written. `src/app/page.tsx`
 * is the root `/`. Mirrors Next.js App Router path resolution.
 */
function routeForPagePath(path: string): string | null {
  const m = /^src\/app\/(.*)page\.tsx$/.exec(path);
  if (!m) return null;
  const segments = m[1]
    .split("/")
    .filter((s) => s.length > 0 && !(s.startsWith("(") && s.endsWith(")")));
  return `/${segments.join("/")}`;
}

/** Every real URL route backed by a `page.tsx` on disk. */
function realRoutes(modules: readonly SourceModule[]): Set<string> {
  const routes = new Set<string>();
  for (const mod of modules) {
    const route = routeForPagePath(mod.path);
    if (route !== null) routes.add(route);
  }
  return routes;
}

/** The Week-9 landing surface: the marketing components + the landing page. */
const MARKETING_PREFIX = "src/components/marketing/";
const LANDING_PAGE = "src/app/page.tsx";
function isLandingSurface(mod: SourceModule): boolean {
  return mod.path.startsWith(MARKETING_PREFIX) || mod.path === LANDING_PAGE;
}

const SECTION_IDS = new Set<string>(Object.values(LANDING_SECTION_IDS));

// ─────────────────────────────────────────────────────────────────────────────

describe("Week 9 hardening — landing & visual/responsive/a11y integration", () => {
  const modules = loadSrcModules();

  // ── 1. the three Week-9 audits share one source model and pass together ─────
  describe("the Week-9 verification audits compose over one shared source model", () => {
    it("loaded a non-trivial module set that includes the Week-9 marketing surface", () => {
      // Guards against a silently-empty walk making every clean result vacuous.
      expect(modules.length).toBeGreaterThan(80);
      const paths = new Set(modules.map((m) => m.path));
      for (const file of [
        "src/components/marketing/landing-hero.tsx",
        "src/components/marketing/landing-body.tsx",
        "src/components/marketing/landing-closing.tsx",
        "src/components/marketing/landing-footer.tsx",
        LANDING_PAGE,
      ]) {
        expect(paths.has(file), `${file} missing from scanned modules`).toBe(true);
      }
    });

    it("palette, responsive, and semantics audits are all clean over the one module set", () => {
      const palette = auditPalette(modules);
      const responsive = auditResponsive(modules);
      const semantics = auditSemantics(modules);
      expect(palette.clean, JSON.stringify(palette.findings)).toBe(true);
      expect(responsive.clean, JSON.stringify(responsive.findings)).toBe(true);
      expect(semantics.clean, JSON.stringify(semantics.findings)).toBe(true);
    });

    it("verifyAccessibilityAA returns one passing verdict over the same modules", () => {
      const report = verifyAccessibilityAA({ modules });
      expect(report.problems, report.problems.join("; ")).toHaveLength(0);
      expect(report.passes).toBe(true);
      // Every layer the composite verdict is built from clears on its own too.
      expect(report.contrast.passes).toBe(true);
      expect(report.semantics.clean).toBe(true);
      expect(report.structure.clean).toBe(true);
      expect(report.documentLanguage).toBe(true);
      expect(report.skipLinkTargetsLandmark).toBe(true);
    });
  });

  // ── 2. the Week-9 landing surface itself clears all three audits ────────────
  describe("the landing surface Week 9 shipped clears all three Day 60–62 audits", () => {
    const landingModules = modules.filter(isLandingSurface);

    it("scoped to a real, non-trivial landing surface (so the pass isn't vacuous)", () => {
      // The four marketing components + the landing page.tsx.
      expect(landingModules.length).toBeGreaterThanOrEqual(5);
      expect(landingModules.some((m) => m.path === LANDING_PAGE)).toBe(true);
    });

    it("is on-palette — every colour comes from a Design.md token (Day 60)", () => {
      const audit = auditPalette(landingModules);
      expect(audit.clean, JSON.stringify(audit.findings)).toBe(true);
    });

    it("is overflow-safe at phone width (Day 61)", () => {
      const audit = auditResponsive(landingModules);
      expect(audit.clean, JSON.stringify(audit.findings)).toBe(true);
    });

    it("has no element-level WCAG-AA semantic defect (Day 62)", () => {
      const audit = auditSemantics(landingModules);
      expect(audit.clean, JSON.stringify(audit.findings)).toBe(true);
    });
  });

  // ── 3. the landing structure agrees with the Day-62 core-page invariant ─────
  describe("the '/' landing flow agrees with the core-page heading/landmark invariant", () => {
    const landingPage = CORE_PAGES.find((p) => p.route === "/") as CorePage;
    const moduleByPath = new Map(modules.map((m) => [m.path, m] as const));

    it("the landing flow is one of the audited core pages", () => {
      expect(landingPage).toBeDefined();
      // It composes the hero (owns the <h1>) and the page (owns the <main>).
      expect(landingPage.files).toContain(LANDING_PAGE);
      expect(landingPage.files).toContain(
        "src/components/marketing/landing-hero.tsx",
      );
    });

    it("composes (from its real files on disk) to exactly one <h1> and one <main> landmark", () => {
      const result = auditCorePage(landingPage, moduleByPath);
      expect(result.missingFiles, result.missingFiles.join(", ")).toHaveLength(0);
      expect(result.h1Count).toBe(1);
      expect(result.mainLandmarkCount).toBe(1);
      expect(result.mainCount).toBe(1); // the one <main> IS the landmark
      expect(result.passes, result.problems.join("; ")).toBe(true);
    });
  });

  // ── 4. every landing link agrees with the real routes and section ids ───────
  describe("every landing CTA and footer link agrees with the real routes on disk", () => {
    const routes = realRoutes(modules);

    it("loaded a non-trivial route snapshot including the landing root", () => {
      // So the agreement below means something — not an empty set vacuously passing.
      expect(routes.size).toBeGreaterThan(4);
      expect(routes.has("/")).toBe(true);
    });

    it("every hero CTA (both auth states) points at a real route, with exactly one primary", () => {
      for (const isAuthenticated of [false, true]) {
        const ctas: readonly HeroCta[] = heroCtasFor(isAuthenticated);
        expect(ctas.length).toBeGreaterThan(0);
        const primaries = ctas.filter((c) => c.variant === "primary");
        expect(
          primaries.length,
          `auth=${isAuthenticated} had ${primaries.length} primary CTAs`,
        ).toBe(1);
        for (const cta of ctas) {
          expect(cta.href.startsWith("/"), `${cta.href} is not a route`).toBe(true);
          expect(routes.has(cta.href), `${cta.href} has no page.tsx`).toBe(true);
        }
        // Keys are unique within a state (stable React list keys).
        const keys = ctas.map((c) => c.key);
        expect(new Set(keys).size).toBe(keys.length);
      }
    });

    it("every footer link resolves to a real route or a real in-page section (no dangles)", () => {
      const links: FooterLink[] = FOOTER_COLUMNS.flatMap((col) => [...col.links]);
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        if (link.href.startsWith("#")) {
          const id = link.href.slice(1);
          expect(
            SECTION_IDS.has(id),
            `footer anchor #${id} targets no landing section`,
          ).toBe(true);
        } else {
          expect(
            routes.has(link.href),
            `footer link ${link.href} has no page.tsx`,
          ).toBe(true);
        }
      }
    });

    it("the closing CTA band reuses the SAME heroCtasFor resolver as the hero", () => {
      // Source-level proof that the hero and the closing band share one
      // session-aware CTA source, so they can never present divergent next steps.
      const closing = modules.find(
        (m) => m.path === "src/components/marketing/landing-closing.tsx",
      );
      expect(closing).toBeDefined();
      expect(closing?.src).toContain("heroCtasFor");
      // And the closing band renders the shared FINAL_CTA copy, not its own.
      expect(FINAL_CTA.heading.trim().length).toBeGreaterThan(0);
      expect(closing?.src).toContain("FINAL_CTA");
    });
  });

  // ── 5. the landing jury is the real PERSONAS roster ─────────────────────────
  describe("the landing jury is derived from the real PERSONAS roster (one source of truth)", () => {
    it("jurySummaries mirrors PERSONAS exactly — name, title, lens, in order", () => {
      const summaries = jurySummaries();
      expect(summaries.length).toBe(PERSONAS.length);
      expect(summaries.map((s) => ({ name: s.name, title: s.title, lens: s.lens }))).toEqual(
        PERSONAS.map((p) => ({ name: p.name, title: p.title, lens: p.lens })),
      );
    });

    it("the public jury is the full, non-empty jury and leaks no prompt text", () => {
      const summaries = jurySummaries();
      expect(summaries.length).toBeGreaterThanOrEqual(5);
      // Only the public title + lens are exposed — never persona prompt fields.
      for (const s of summaries) {
        expect(s.title.trim().length).toBeGreaterThan(0);
        expect(s.lens.trim().length).toBeGreaterThan(0);
        expect(Object.keys(s).sort()).toEqual(["lens", "name", "title"]);
      }
    });
  });

  // ── a sanity check tying the hero copy to the single <h1> it becomes ────────
  it("the hero headline that becomes the single landing <h1> is concrete, non-empty copy", () => {
    expect(HERO.headline.trim().length).toBeGreaterThan(0);
    expect(HERO.eyebrow.trim().length).toBeGreaterThan(0);
    expect(HERO.subhead.trim().length).toBeGreaterThan(0);
    expect(HERO.pillars.length).toBeGreaterThan(0);
  });
});
