/**
 * Motion audit (DailyPlan Day 64 — Micro-interactions).
 *
 * "Transitions/animations (respect `prefers-reduced-motion`).
 *  DoD: subtle, functional motion only."
 *
 * The micro-interactions sibling of the Day-60 `palette-audit`, Day-61
 * `responsive-audit`, and Day-62 `semantics-audit`: a pure, node-testable scanner
 * that proves an app-wide motion invariant from the real source, with no Next
 * build, no bundler, no browser, and no credential. Here the invariant is the
 * day's DoD — motion is **subtle and functional, and respects
 * `prefers-reduced-motion`** — so "no motion that ignores the user's preference,
 * no broad janky transition" becomes an executable, regression-proof check
 * instead of a one-time eyeball pass.
 *
 * It flags three motion hazards:
 *
 *  1. UNGATED ANIMATE UTILITIES (`findUngatedAnimateUtilities`, .ts/.tsx) — a
 *     Tailwind `animate-<name>` utility that is NOT gated behind the
 *     `motion-safe:` variant. `animate-*` plays a looping/entering keyframe; left
 *     ungated it runs even for a user who asked for reduced motion (WCAG 2.3.3
 *     Animation from Interactions). The app's convention is
 *     `motion-safe:animate-pulse` / `motion-safe:animate-toast-in`. `animate-none`
 *     (which *disables* animation) is always safe and never flagged.
 *
 *  2. BROAD TRANSITIONS (`findBroadTransitions`, .ts/.tsx + .css) — a
 *     `transition-all` utility, or a CSS `transition: … all …` /
 *     `transition-property: all`. Transitioning *every* property animates layout
 *     and size (width/height/top/left), which is janky and is exactly the
 *     "flashy, not functional" motion Design.md §1/§6 rules out. The app scopes
 *     its transitions (`transition-colors`); a blanket `all` is the hazard.
 *
 *  3. UNGATED CSS ANIMATIONS (`findUngatedCssAnimations`, .css) — a raw CSS
 *     `animation:` / `animation-name:` declaration that assigns a keyframe
 *     OUTSIDE a `@media (prefers-reduced-motion: no-preference)` guard. (The
 *     reduced-motion *reset* uses the `animation-duration` / `-iteration-count`
 *     longhands to neutralise motion, never assigns a keyframe, so it is
 *     correctly not flagged.) This holds any hand-written CSS animation to the
 *     same reduced-motion gate the Tailwind `motion-safe:` variant enforces.
 *
 * A clean result — `findings: []` — is the executable form of the Day-64 DoD.
 * Comment stripping is shared with `palette-audit` (`stripComments`) for .ts/.tsx
 * so a utility-shaped token in a docstring can't trip a scan and line numbers
 * still line up; a small CSS-only comment stripper handles `/* … *\/` for .css.
 */

import { stripComments } from "./palette-audit";
import type { SourceModule } from "./palette-audit";
import { NO_PREFERENCE_QUERY } from "./motion";

export type { SourceModule } from "./palette-audit";

// ── Finding model ────────────────────────────────────────────────────────────

export type MotionFindingKind =
  | "ungated-animate"
  | "broad-transition"
  | "ungated-css-animation";

export interface MotionFinding {
  /** Repo-relative path, POSIX separators. */
  path: string;
  /** 1-based line number of the match. */
  line: number;
  kind: MotionFindingKind;
  /** The exact offending text matched (e.g. `animate-pulse`, `transition-all`). */
  match: string;
  /** Human-readable reason. */
  detail: string;
}

/** 1-based line number of a character offset within `text`. */
function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

function isCss(path: string): boolean {
  return path.endsWith(".css");
}

function isClassSource(path: string): boolean {
  // className utilities live in .tsx components AND .ts helpers (e.g. the
  // toast-classes.ts accent/badge maps), so both are scanned for utilities.
  return path.endsWith(".ts") || path.endsWith(".tsx");
}

/**
 * Strip CSS block comments (`/* … *\/`) to spaces while preserving every
 * newline, so a motion token documented in a CSS comment can't trip a scan and
 * reported line numbers still match. CSS has no `//` line comments, so the
 * JS-oriented `stripComments` is not reused for .css (it would mistake a `//`
 * inside an unquoted `url(http://…)` for a comment).
 */
export function stripCssComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    if (src[i] === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") out += "\n";
        i += 1;
      }
      i += 2; // skip closing */
      continue;
    }
    out += src[i];
    i += 1;
  }
  return out;
}

// ── 1. Ungated animate utilities (.ts/.tsx) ──────────────────────────────────

// A Tailwind `animate-<name>` utility with its (possibly empty) variant chain
// captured. The leading boundary stops a match inside a longer word. `animate-[…]`
// arbitrary animations are not matched (the app uses named animations only).
const ANIMATE_RE = /(?<![\w-])((?:[a-z0-9-]+:)*)animate-([a-z0-9][a-z0-9-]*)/g;

/** The variant segments of a chain like `"motion-safe:hover:"`. */
export function variantSegments(chain: string): string[] {
  return chain.split(":").filter((s) => s.length > 0);
}

/** Tailwind `animate-*` utilities not gated by `motion-safe:` (`animate-none` is fine). */
export function findUngatedAnimateUtilities(mod: SourceModule): MotionFinding[] {
  const clean = stripComments(mod.src);
  const out: MotionFinding[] = [];
  for (const m of clean.matchAll(ANIMATE_RE)) {
    const name = m[2];
    if (name === "none") continue; // disabling animation is always safe
    if (variantSegments(m[1]).includes("motion-safe")) continue; // gated
    out.push({
      path: mod.path,
      line: lineAt(clean, m.index ?? 0),
      kind: "ungated-animate",
      match: m[0],
      detail: `animate-${name} is not gated behind motion-safe: (use motion-safe:animate-${name})`,
    });
  }
  return out;
}

// ── 2. Broad transitions (.ts/.tsx + .css) ───────────────────────────────────

// The Tailwind broad-transition utility (`transition-` + the `all` keyword),
// with any variant chain. Built from split string parts so the full offending
// literal never appears verbatim in this scanner's own source — otherwise the
// audit would flag itself when it scans `src/lib/ui/` (cf. the palette audit,
// which likewise keeps full offending literals out of its non-comment code).
const TRANSITION_ALL_RE = new RegExp(
  "(?<![\\w-])(?:[a-z0-9-]+:)*transition-" + "all\\b",
  "g",
);

// A CSS `transition:` or `transition-property:` declaration whose value includes
// the `all` keyword. `transition-duration`/`-timing-function`/`-delay` longhands
// are not matched (the optional group is the literal `-property` only).
const CSS_TRANSITION_ALL_RE = /transition(?:-property)?\s*:\s*[^;{}]*\ball\b/g;

/** Broad `all` transitions (animate every property, incl. layout). */
export function findBroadTransitions(mod: SourceModule): MotionFinding[] {
  const out: MotionFinding[] = [];
  if (isClassSource(mod.path)) {
    const clean = stripComments(mod.src);
    for (const m of clean.matchAll(TRANSITION_ALL_RE)) {
      out.push({
        path: mod.path,
        line: lineAt(clean, m.index ?? 0),
        kind: "broad-transition",
        match: m[0],
        detail:
          "a transition on the `all` keyword animates every property (incl. layout); scope it (e.g. transition-colors)",
      });
    }
  }
  if (isCss(mod.path)) {
    const clean = stripCssComments(mod.src);
    for (const m of clean.matchAll(CSS_TRANSITION_ALL_RE)) {
      out.push({
        path: mod.path,
        line: lineAt(clean, m.index ?? 0),
        kind: "broad-transition",
        match: m[0].trim(),
        detail:
          "CSS transitions the `all` keyword; name the properties to animate instead",
      });
    }
  }
  return out;
}

// ── 3. Ungated CSS animations (.css) ──────────────────────────────────────────

// A CSS `animation:` or `animation-name:` declaration that ASSIGNS a keyframe.
// The longhands that only tune an already-declared animation
// (`animation-duration`, `-iteration-count`, `-timing-function`, `-delay`,
// `-direction`, `-fill-mode`, `-play-state`) are deliberately NOT matched, so the
// reduced-motion reset (which uses `-duration`/`-iteration-count` to neutralise
// motion) is never mistaken for starting one.
const CSS_ANIMATION_DECL_RE = /(?:^|[;{}\s])(animation(?:-name)?)\s*:/g;

// A `@media` header mentioning the no-preference query. The block it opens is a
// reduced-motion-safe region: a keyframe assigned inside it only plays when the
// user has not asked for reduced motion.
const NO_PREFERENCE_MEDIA_RE = /@media[^{]*\(prefers-reduced-motion:\s*no-preference\)[^{]*\{/g;

/** The [start, end) char ranges of every `no-preference` media block in `css`. */
export function noPreferenceRanges(css: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const m of css.matchAll(NO_PREFERENCE_MEDIA_RE)) {
    // The regex ends at the block's opening brace; brace-match to its close.
    const openBrace = (m.index ?? 0) + m[0].length - 1;
    let depth = 1;
    let i = openBrace + 1;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") depth -= 1;
      i += 1;
    }
    ranges.push([m.index ?? 0, i]);
  }
  return ranges;
}

/** Whether the no-preference query string is present (for the positive check). */
export function referencesNoPreferenceQuery(css: string): boolean {
  return css.includes(NO_PREFERENCE_QUERY);
}

/** Raw CSS animations that assign a keyframe outside a no-preference guard. */
export function findUngatedCssAnimations(mod: SourceModule): MotionFinding[] {
  if (!isCss(mod.path)) return [];
  const clean = stripCssComments(mod.src);
  const safe = noPreferenceRanges(clean);
  const inSafeRange = (idx: number) =>
    safe.some(([s, e]) => idx >= s && idx < e);

  const out: MotionFinding[] = [];
  for (const m of clean.matchAll(CSS_ANIMATION_DECL_RE)) {
    // m[1] is the property name; anchor the reported offset at it, not the
    // leading boundary char the outer group consumed.
    const propIdx = (m.index ?? 0) + m[0].indexOf(m[1]);
    if (inSafeRange(propIdx)) continue;
    out.push({
      path: mod.path,
      line: lineAt(clean, propIdx),
      kind: "ungated-css-animation",
      match: m[1],
      detail:
        "CSS animation assigned outside a (prefers-reduced-motion: no-preference) guard",
    });
  }
  return out;
}

// ── Aggregate ────────────────────────────────────────────────────────────────

/** Every motion finding in one module, in source order. */
export function auditModule(mod: SourceModule): MotionFinding[] {
  return [
    ...findUngatedAnimateUtilities(mod),
    ...findBroadTransitions(mod),
    ...findUngatedCssAnimations(mod),
  ].sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
}

export interface MotionAudit {
  /** True when no module has a motion hazard. */
  clean: boolean;
  findings: MotionFinding[];
}

/**
 * Audit a set of modules. A clean result — `findings: []` — is the executable
 * form of the Day-64 DoD: every animation is reduced-motion-gated and every
 * transition is scoped (subtle, functional motion only).
 */
export function auditMotion(modules: readonly SourceModule[]): MotionAudit {
  const findings = modules
    .flatMap((m) => auditModule(m))
    .sort(
      (a, b) =>
        a.path.localeCompare(b.path) ||
        a.line - b.line ||
        a.kind.localeCompare(b.kind),
    );
  return { clean: findings.length === 0, findings };
}
