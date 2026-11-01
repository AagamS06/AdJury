import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  MOTION_DURATIONS,
  MAX_SUBTLE_DURATION_MS,
  durationMs,
  MOTION_EASING,
  TOAST_ENTER,
  toastAnimationValue,
  REDUCED_MOTION_QUERY,
  NO_PREFERENCE_QUERY,
  prefersReducedMotion,
  type MediaQueryMatcher,
} from "@/lib/ui/motion";

/**
 * Motion tokens (DailyPlan Day 64 — Micro-interactions).
 *
 * "Transitions/animations (respect `prefers-reduced-motion`).
 *  DoD: subtle, functional motion only."
 *
 * Part 1 pins the token values and the SSR-safe `prefersReducedMotion` helper.
 * Part 2 reconciles the tokens against the REAL `tailwind.config.ts`,
 * `globals.css`, and the toast component — a drift guard so a duration or the
 * toast animation can't diverge between `motion.ts` and the compiled CSS (the
 * motion sibling of the palette-token drift test). Part 3 pins the two
 * reduced-motion invariants the day's DoD turns on: the global CSS reset exists,
 * and the toast animation is `motion-safe:`-gated.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(`${repoRoot}${rel}`, "utf8");

// ── 1. Token values + the reduced-motion helper ──────────────────────────────

describe("motion tokens — values are subtle and well-formed", () => {
  it("durations are few, ordered, and under the subtle ceiling", () => {
    expect(MOTION_DURATIONS.fast).toBeLessThan(MOTION_DURATIONS.base);
    expect(MOTION_DURATIONS.base).toBeLessThan(MOTION_DURATIONS.slow);
    for (const ms of Object.values(MOTION_DURATIONS)) {
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(MAX_SUBTLE_DURATION_MS);
    }
    // `base` matches Tailwind's default transition duration, so existing
    // transition-colors hovers are on-token.
    expect(MOTION_DURATIONS.base).toBe(150);
  });

  it("durationMs renders a token as its CSS value", () => {
    expect(durationMs("fast")).toBe("100ms");
    expect(durationMs("base")).toBe("150ms");
    expect(durationMs("slow")).toBe("250ms");
  });

  it("there is one plain-keyword easing", () => {
    expect(MOTION_EASING.standard).toBe("ease-out");
  });

  it("the toast enter token composes into the expected animation value", () => {
    expect(TOAST_ENTER.name).toBe("toast-in");
    expect(TOAST_ENTER.durationMs).toBe(MOTION_DURATIONS.base);
    expect(TOAST_ENTER.easing).toBe(MOTION_EASING.standard);
    expect(toastAnimationValue()).toBe("toast-in 150ms ease-out");
  });

  it("the media-query constants are the standard spellings", () => {
    expect(REDUCED_MOTION_QUERY).toBe("(prefers-reduced-motion: reduce)");
    expect(NO_PREFERENCE_QUERY).toBe("(prefers-reduced-motion: no-preference)");
  });
});

describe("prefersReducedMotion — SSR-safe, injectable, fails safe", () => {
  const matcherFor = (matches: boolean): MediaQueryMatcher => (q) => {
    expect(q).toBe(REDUCED_MOTION_QUERY); // reads the reduce query, not no-preference
    return { matches };
  };

  it("returns true only when the injected matcher matches the reduce query", () => {
    expect(prefersReducedMotion(matcherFor(true))).toBe(true);
    expect(prefersReducedMotion(matcherFor(false))).toBe(false);
  });

  it("returns false (motion allowed) when there is no window/matchMedia (SSR)", () => {
    // The node test env has no `window`, so the default path takes the SSR branch.
    expect(prefersReducedMotion()).toBe(false);
  });

  it("fails safe (false) if the matcher throws", () => {
    const throwing: MediaQueryMatcher = () => {
      throw new Error("matchMedia unavailable");
    };
    expect(prefersReducedMotion(throwing)).toBe(false);
  });
});

// ── 2. Drift guard: tokens reconcile with the real config/CSS/component ───────

describe("motion tokens — reconcile with tailwind.config.ts", () => {
  const config = read("/tailwind.config.ts");

  it("declares each duration token with its exact value", () => {
    expect(config).toMatch(/transitionDuration\s*:/);
    expect(config).toContain(`fast: "${MOTION_DURATIONS.fast}ms"`);
    expect(config).toContain(`base: "${MOTION_DURATIONS.base}ms"`);
    expect(config).toContain(`slow: "${MOTION_DURATIONS.slow}ms"`);
  });

  it("registers the toast-in keyframe + animation from the token", () => {
    expect(config).toMatch(/keyframes\s*:/);
    expect(config).toContain(`"${TOAST_ENTER.name}"`);
    expect(config).toContain(`translateY(${TOAST_ENTER.fromTranslateY})`);
    // The animation value matches the composed token string.
    expect(config).toContain(`"${toastAnimationValue()}"`);
  });
});

// ── 3. Reduced-motion invariants (the DoD) ────────────────────────────────────

describe("motion — reduced motion is respected app-wide", () => {
  it("globals.css ships the global reduced-motion reset", () => {
    const css = read("/src/app/globals.css");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    // The reset collapses both transitions and animations.
    expect(css).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(css).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
  });

  it("globals.css no longer hand-writes the migrated toast keyframe", () => {
    const css = read("/src/app/globals.css");
    // The keyframe + its media block moved to the Tailwind config.
    expect(css).not.toMatch(/@keyframes\s+toast-in/);
    expect(css).not.toContain(".toast-enter");
  });

  it("the toast enter animation is gated behind motion-safe:", () => {
    const toast = read("/src/components/ui/toast.tsx");
    expect(toast).toContain(`motion-safe:animate-${TOAST_ENTER.name}`);
    // The old ungated class is gone.
    expect(toast).not.toMatch(/(?<![-])\btoast-enter\b/);
  });
});
