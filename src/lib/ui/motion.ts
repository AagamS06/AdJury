/**
 * Motion tokens (DailyPlan Day 64 — Micro-interactions).
 *
 * "Transitions/animations (respect `prefers-reduced-motion`).
 *  DoD: subtle, functional motion only."
 *
 * The single source of truth for the app's motion vocabulary, the micro-
 * interactions sibling of the Day-60 colour tokens and Day-61/62 audits. Before
 * this, motion was defined ad-hoc — a hand-written `160ms ease-out` keyframe in
 * `globals.css` for the toast, Tailwind's implicit default duration for every
 * `transition-colors` hover — with nothing naming what "subtle" means or keeping
 * the values consistent. This module names a small, deliberately restrained set
 * of durations and one easing (Design.md §6: "keep animation minimal and
 * functional"), and provides the one runtime helper client code needs to branch
 * on the user's reduced-motion preference.
 *
 * Pure and node-testable — no DOM, no React, no Next. The Tailwind config and
 * `globals.css` are reconciled against these values by a drift test
 * (`tests/motion.test.ts`), exactly as the palette tokens are pinned to the
 * config, so a duration can't silently diverge between here and the compiled CSS.
 */

// ── Durations ────────────────────────────────────────────────────────────────

/**
 * The canonical motion durations, in milliseconds. Deliberately few and short —
 * everything is a micro-interaction (a hover colour shift, a toast sliding in),
 * never a showy transition. `base` matches Tailwind's own default transition
 * duration (150ms), so the many `transition-colors` hovers already in the app
 * are on-token without changing.
 */
export const MOTION_DURATIONS = {
  /** Snappy feedback — small hover/press affordances. */
  fast: 100,
  /** The default for colour/opacity transitions and the toast enter. */
  base: 150,
  /** The longest a *subtle* motion should take (larger surfaces easing in). */
  slow: 250,
} as const;

export type MotionDurationToken = keyof typeof MOTION_DURATIONS;

/**
 * The ceiling for a motion that still reads as "subtle" (Design.md §6). Anything
 * slower than this is an animation the user notices *as* an animation, which the
 * day's DoD rules out; `slow` sits comfortably under it.
 */
export const MAX_SUBTLE_DURATION_MS = 300;

/** A duration token as its CSS value, e.g. `durationMs("base") → "150ms"`. */
export function durationMs(token: MotionDurationToken): string {
  return `${MOTION_DURATIONS[token]}ms`;
}

// ── Easing ───────────────────────────────────────────────────────────────────

/**
 * The one easing the app uses. `ease-out` decelerates into rest — the natural
 * curve for an element arriving (a toast sliding up, a panel fading in) — and is
 * a plain CSS keyword so the Tailwind `animation` value and any hand-written CSS
 * agree with no bespoke cubic-bezier to keep in sync.
 */
export const MOTION_EASING = {
  standard: "ease-out",
} as const;

export type MotionEasingToken = keyof typeof MOTION_EASING;

// ── The toast enter animation (tokenised) ────────────────────────────────────

/**
 * The toast enter animation, as a token rather than a magic string. It is
 * registered in `tailwind.config.ts` as the `toast-in` keyframe + `animate-toast-in`
 * utility, applied via Tailwind's `motion-safe:` variant so it only plays when
 * the user has NOT asked for reduced motion. The values here pin that config.
 */
export const TOAST_ENTER = {
  /** The keyframe / animation name registered in the Tailwind config. */
  name: "toast-in",
  durationMs: MOTION_DURATIONS.base,
  easing: MOTION_EASING.standard,
  /** `from` offset: the toast starts 8px below its resting position, invisible. */
  fromTranslateY: "8px",
} as const;

/** The full CSS `animation` shorthand value for the toast, from the token. */
export function toastAnimationValue(): string {
  return `${TOAST_ENTER.name} ${TOAST_ENTER.durationMs}ms ${TOAST_ENTER.easing}`;
}

// ── Reduced-motion preference ─────────────────────────────────────────────────

/** The media query that is true when the user has asked for reduced motion. */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * The media query Tailwind's `motion-safe:` variant compiles to — true when the
 * user has expressed NO preference against motion. CSS animations/transitions
 * that move an element are gated behind this so they are stilled by default for
 * anyone who prefers reduced motion.
 */
export const NO_PREFERENCE_QUERY = "(prefers-reduced-motion: no-preference)";

/** A minimal `window.matchMedia`-shaped function, for injection in tests. */
export type MediaQueryMatcher = (query: string) => { matches: boolean };

/**
 * Whether the current environment prefers reduced motion. SSR-safe and
 * defensively wrapped: with no `matcher` it reads `window.matchMedia` when
 * available and otherwise returns `false` (on the server, or where `matchMedia`
 * is absent, assume motion is allowed — the CSS layer still gates the actual
 * animations, so this only governs JS-driven motion). A `matcher` can be
 * injected to make the branch testable in the node test env.
 *
 * Returning `false` is the safe default: it never *forces* motion on a user who
 * asked for less (the `motion-safe:` CSS gating and the global reduced-motion
 * reset handle CSS motion regardless); it only means JS won't *skip* an effect
 * it can't confirm the preference for.
 */
export function prefersReducedMotion(matcher?: MediaQueryMatcher): boolean {
  const mm: MediaQueryMatcher | null =
    matcher ??
    (typeof window !== "undefined" &&
    typeof window.matchMedia === "function"
      ? (q: string) => window.matchMedia(q)
      : null);
  if (!mm) return false;
  try {
    return mm(REDUCED_MOTION_QUERY).matches === true;
  } catch {
    return false;
  }
}
