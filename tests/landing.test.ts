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
