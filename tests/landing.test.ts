import { describe, it, expect } from "vitest";
import {
  HERO,
  heroCtasFor,
  FEATURES,
  FEATURES_INTRO,
  JURY_INTRO,
  jurySummaries,
  HOW_IT_WORKS,
  HOW_IT_WORKS_INTRO,
  LANDING_SECTION_IDS,
  SOCIAL_PROOF_INTRO,
  PROOF_POINTS,
  TESTIMONIAL_PLACEHOLDER,
  FINAL_CTA,
  FOOTER_TAGLINE,
  FOOTER_COLUMNS,
  footerCopyright,
  type HeroCta,
  type SectionIntro,
} from "@/lib/marketing/landing";
import { PERSONAS } from "@/lib/ai/personas";

/**
 * Landing hero content + CTA logic (DailyPlan Day 57). The React hero
 * (`components/marketing/landing-hero.tsx`) only renders these values, so the
 * marketing copy's invariants and the session-aware CTA routing are proved here
 * — mirroring the pure-core test pattern used for nav / dashboard-view.
 *
 * Day 57 DoD: the hero communicates *what AdJury does* and *for whom*.
 */

/** Routes that actually exist under `src/app` — a CTA must never dangle. */
const REAL_ROUTES = new Set(["/signup", "/login", "/dashboard", "/review"]);

function expectExactlyOnePrimary(ctas: readonly HeroCta[]) {
  const primaries = ctas.filter((c) => c.variant === "primary");
  expect(primaries).toHaveLength(1);
}

describe("HERO content", () => {
  it("has non-empty copy in every slot", () => {
    expect(HERO.eyebrow.trim().length).toBeGreaterThan(0);
    expect(HERO.headline.trim().length).toBeGreaterThan(0);
    expect(HERO.subhead.trim().length).toBeGreaterThan(0);
    expect(HERO.audience.trim().length).toBeGreaterThan(0);
  });

  it("says what AdJury does: QA/review layer that scores and rewrites", () => {
    const what = `${HERO.headline} ${HERO.subhead}`.toLowerCase();
    // The headline names the core mechanic (jurors reviewing before publish)…
    expect(HERO.headline.toLowerCase()).toContain("review");
    expect(HERO.headline.toLowerCase()).toContain("publish");
    // …and the value proposition promises scores + rewrites, not generation.
    expect(what).toContain("score");
    expect(what).toContain("rewrite");
  });

  it("says who it is for (marketing teams)", () => {
    expect(HERO.audience.toLowerCase()).toContain("marketing");
  });

  it("does NOT position AdJury as a content generator (Rules.md §1 / PRD §3)", () => {
    // It's a QA/review layer — the hero must not promise to write ads for you.
    const copy =
      `${HERO.eyebrow} ${HERO.headline} ${HERO.subhead}`.toLowerCase();
    expect(copy).not.toContain("generate your");
    expect(copy).not.toContain("write your ads");
  });

  it("presents exactly three value pillars with unique keys and full copy", () => {
    expect(HERO.pillars).toHaveLength(3);
    const keys = HERO.pillars.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const pillar of HERO.pillars) {
      expect(pillar.title.trim().length).toBeGreaterThan(0);
      expect(pillar.body.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("heroCtasFor", () => {
  it("points a signed-out visitor at sign-up (primary) with log-in secondary", () => {
    const ctas = heroCtasFor(false);
    expectExactlyOnePrimary(ctas);
    const primary = ctas.find((c) => c.variant === "primary")!;
    expect(primary.href).toBe("/signup");
    expect(ctas.some((c) => c.href === "/login")).toBe(true);
  });

  it("points a signed-in user back into the product (dashboard primary)", () => {
    const ctas = heroCtasFor(true);
    expectExactlyOnePrimary(ctas);
    const primary = ctas.find((c) => c.variant === "primary")!;
    expect(primary.href).toBe("/dashboard");
    expect(ctas.some((c) => c.href === "/review")).toBe(true);
  });

  it("returns well-formed CTAs that never dangle, in both auth states", () => {
    for (const isAuth of [false, true]) {
      const ctas = heroCtasFor(isAuth);
      expect(ctas.length).toBeGreaterThanOrEqual(2);

      const keys = ctas.map((c) => c.key);
      expect(new Set(keys).size).toBe(keys.length);

      for (const cta of ctas) {
        expect(cta.label.trim().length).toBeGreaterThan(0);
        // Every destination is an existing in-app route (no forward-dependency
        // on a page Day 59 hasn't built yet).
        expect(cta.href.startsWith("/")).toBe(true);
        expect(REAL_ROUTES.has(cta.href)).toBe(true);
      }
    }
  });
});

/**
 * Landing body content (DailyPlan Day 58): the features, the jury, and the
 * how-it-works steps. The React body (`components/marketing/landing-body.tsx`)
 * only renders these values, so their invariants — full copy, unique keys, the
 * jury matching the real `PERSONAS` roster, and ordered steps — are proved here.
 *
 * Day 58 DoD: the sections explain the product clearly.
 */
function expectWellFormedIntro(intro: SectionIntro) {
  expect(intro.key.trim().length).toBeGreaterThan(0);
  expect(intro.eyebrow.trim().length).toBeGreaterThan(0);
  expect(intro.heading.trim().length).toBeGreaterThan(0);
  expect(intro.intro.trim().length).toBeGreaterThan(0);
}

describe("landing body — section intros", () => {
  it("every section has full heading + intro copy and a unique key", () => {
    const intros = [FEATURES_INTRO, JURY_INTRO, HOW_IT_WORKS_INTRO];
    for (const intro of intros) expectWellFormedIntro(intro);
    const keys = intros.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("landing body — FEATURES", () => {
  it("lists several capabilities, each with full copy and a unique key", () => {
    expect(FEATURES.length).toBeGreaterThanOrEqual(3);
    const keys = FEATURES.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const feature of FEATURES) {
      expect(feature.title.trim().length).toBeGreaterThan(0);
      expect(feature.body.trim().length).toBeGreaterThan(0);
    }
  });

  it("names the core mechanics: six jurors, grounding, and rewrites", () => {
    const copy = FEATURES.map((f) => `${f.title} ${f.body}`)
      .join(" ")
      .toLowerCase();
    expect(copy).toContain("juror");
    expect(copy).toContain("rewrite");
    // Grounded in the company's own brand/business, not a generic rubric.
    expect(copy).toMatch(/brand|business/);
  });

  it("stays a QA layer — never promises to generate ads for you", () => {
    const copy = FEATURES.map((f) => `${f.title} ${f.body}`)
      .join(" ")
      .toLowerCase();
    expect(copy).not.toContain("generate your");
    expect(copy).not.toContain("write your ads");
  });
});

describe("landing body — the jury", () => {
  it("renders exactly the real PERSONAS roster, in order (no drift)", () => {
    const jurors = jurySummaries();
    expect(jurors).toHaveLength(PERSONAS.length);
    jurors.forEach((juror, i) => {
      expect(juror.name).toBe(PERSONAS[i].name);
      expect(juror.title).toBe(PERSONAS[i].title);
      expect(juror.lens).toBe(PERSONAS[i].lens);
    });
  });

  it("exposes only the public title + lens — never the system prompt", () => {
    const jurors = jurySummaries();
    for (const juror of jurors) {
      expect(juror.title.trim().length).toBeGreaterThan(0);
      expect(juror.lens.trim().length).toBeGreaterThan(0);
      // The marketing summary must not leak prompt text.
      expect(Object.keys(juror)).toEqual(["name", "title", "lens"]);
    }
  });
});

describe("landing body — how it works", () => {
  it("is a short, ordered flow with full copy and unique keys", () => {
    expect(HOW_IT_WORKS.length).toBeGreaterThanOrEqual(3);
    const keys = HOW_IT_WORKS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const step of HOW_IT_WORKS) {
      expect(step.title.trim().length).toBeGreaterThan(0);
      expect(step.body.trim().length).toBeGreaterThan(0);
    }
  });

  it("numbers steps 1..N consecutively in array order", () => {
    HOW_IT_WORKS.forEach((step, i) => {
      expect(step.step).toBe(i + 1);
    });
  });

  it("describes submit → review → decide, with the human in control", () => {
    const copy = HOW_IT_WORKS.map((s) => `${s.title} ${s.body}`)
      .join(" ")
      .toLowerCase();
    expect(copy).toMatch(/submit|paste|upload/);
    expect(copy).toContain("review");
    // The product never auto-publishes — the human decides what ships.
    expect(copy).toMatch(/decide|you ship|what ships|nothing publishes/);
  });
});

/**
 * Landing closing content (DailyPlan Day 59): the social-proof placeholder, the
 * session-aware final CTA, and the footer. The closing/footer components
 * (`components/marketing/landing-closing.tsx`, `landing-footer.tsx`) only render
 * these values, so the invariants — honest (non-fabricated) social proof, a
 * single primary CTA reusing the hero logic, and footer links that never dangle
 * — are proved here.
 *
 * Day 59 DoD: the landing page is complete top-to-bottom.
 */
describe("landing closing — social proof (placeholder)", () => {
  it("has a well-formed section intro", () => {
    expectWellFormedIntro(SOCIAL_PROOF_INTRO);
  });

  it("lists product-grounded proof points with full copy and unique keys", () => {
    expect(PROOF_POINTS.length).toBeGreaterThanOrEqual(3);
    const keys = PROOF_POINTS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const point of PROOF_POINTS) {
      expect(point.title.trim().length).toBeGreaterThan(0);
      expect(point.body.trim().length).toBeGreaterThan(0);
    }
  });

  it("names the real trust signals: grounding and human-in-control", () => {
    const copy = PROOF_POINTS.map((p) => `${p.title} ${p.body}`)
      .join(" ")
      .toLowerCase();
    expect(copy).toMatch(/brand|business|market/);
    expect(copy).toMatch(/control|you decide|never publishes/);
  });

  it("keeps the testimonial slot an explicit, honest placeholder (no fakes)", () => {
    // The placeholder must say, in plain words, that stories aren't shown until
    // real — so the page never passes off a fabricated quote as social proof.
    expect(TESTIMONIAL_PLACEHOLDER.label.trim().length).toBeGreaterThan(0);
    expect(TESTIMONIAL_PLACEHOLDER.body.toLowerCase()).toMatch(/real|until/);
  });
});

describe("landing closing — final CTA", () => {
  it("has full heading + subhead copy", () => {
    expect(FINAL_CTA.eyebrow.trim().length).toBeGreaterThan(0);
    expect(FINAL_CTA.heading.trim().length).toBeGreaterThan(0);
    expect(FINAL_CTA.subhead.trim().length).toBeGreaterThan(0);
  });

  it("reuses the session-aware hero CTA logic (exactly one primary)", () => {
    for (const isAuth of [false, true]) {
      const ctas = heroCtasFor(isAuth);
      expectExactlyOnePrimary(ctas);
      for (const cta of ctas) {
        expect(REAL_ROUTES.has(cta.href)).toBe(true);
      }
    }
  });
});

describe("landing closing — footer", () => {
  it("has a tagline and a sensible, parameterised copyright line", () => {
    expect(FOOTER_TAGLINE.trim().length).toBeGreaterThan(0);
    expect(footerCopyright(2026)).toContain("2026");
    expect(footerCopyright(2026)).toContain("AdJury");
    // Year is a parameter, not hard-coded — next year's copyright is correct.
    expect(footerCopyright(2030)).toContain("2030");
  });

  it("groups links into columns with full copy and unique keys", () => {
    expect(FOOTER_COLUMNS.length).toBeGreaterThanOrEqual(1);
    const colKeys = FOOTER_COLUMNS.map((c) => c.key);
    expect(new Set(colKeys).size).toBe(colKeys.length);

    const allLinkKeys = FOOTER_COLUMNS.flatMap((c) => c.links.map((l) => l.key));
    expect(new Set(allLinkKeys).size).toBe(allLinkKeys.length);

    for (const column of FOOTER_COLUMNS) {
      expect(column.title.trim().length).toBeGreaterThan(0);
      expect(column.links.length).toBeGreaterThan(0);
      for (const link of column.links) {
        expect(link.label.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("never dangles: every link is a real route or a real in-page anchor", () => {
    const anchorTargets = new Set(
      Object.values(LANDING_SECTION_IDS).map((id) => `#${id}`),
    );
    for (const column of FOOTER_COLUMNS) {
      for (const link of column.links) {
        if (link.href.startsWith("#")) {
          // Anchors must point at a real body section id (shared source).
          expect(anchorTargets.has(link.href)).toBe(true);
        } else {
          expect(link.href.startsWith("/")).toBe(true);
          expect(REAL_ROUTES.has(link.href)).toBe(true);
        }
      }
    }
  });

  it("omits legal pages that don't exist yet (no 404 links)", () => {
    const hrefs = FOOTER_COLUMNS.flatMap((c) => c.links.map((l) => l.href));
    expect(hrefs).not.toContain("/privacy");
    expect(hrefs).not.toContain("/terms");
  });
});
