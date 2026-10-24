import { describe, it, expect } from "vitest";
import { HERO, heroCtasFor, type HeroCta } from "@/lib/marketing/landing";

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
        // on a page Day 58/59 hasn't built yet).
        expect(cta.href.startsWith("/")).toBe(true);
        expect(REAL_ROUTES.has(cta.href)).toBe(true);
      }
    }
  });
});
