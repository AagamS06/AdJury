/**
 * Responsive audit (DailyPlan Day 61 — Responsive pass).
 *
 * "Mobile/tablet/desktop layouts.
 *  DoD: no horizontal overflow; usable at all widths."
 *
 * The responsive sibling of the Day-60 `palette-audit` (and the Week-7
 * `secrets-audit` / `rls-audit` / `authz-audit`): a pure, node-testable scanner
 * that proves an app-wide layout invariant from the real source, with no Next
 * build, no bundler, no browser, and no credential. Here the invariant is that
 * the UI cannot force **horizontal overflow on a phone** — so "usable at all
 * widths / no horizontal overflow" becomes an executable, regression-proof check
 * instead of a one-time eyeball-at-a-few-breakpoints pass.
 *
 * It flags two layout shapes that overflow the narrowest common viewport:
 *
 *  1. FIXED OVERFLOW WIDTHS (`findFixedOverflowWidths`) — a `w-[…]` / `min-w-[…]`
 *     / `basis-[…]` utility pinned to an absolute length (`px`/`rem`) wider than
 *     the mobile safe width (`MOBILE_SAFE_WIDTH_PX`). A box that is, say,
 *     `w-[640px]` simply cannot fit a 360-px phone, so it pushes the page wider
 *     and a horizontal scrollbar appears. Caps (`max-w-[…]`) are NOT flagged —
 *     a max only ever shrinks the box — and relative/viewport/content units
 *     (`%`, `vw`, `ch`, `fr`, `auto`, `calc(…)`) are responsive by nature, so
 *     they are left alone. Only absolute `px`/`rem` lengths on a *minimum* or
 *     *fixed* width are the hazard.
 *
 *  2. NON-RESPONSIVE MULTI-COLUMN GRIDS (`findNonResponsiveGrids`) — a
 *     `grid-cols-N` (N ≥ 2) that is NOT gated behind a responsive breakpoint
 *     variant (`sm:` / `md:` / `lg:` / `xl:` / `2xl:`). Tailwind's grid default
 *     is a single column, so the app's convention is `grid … sm:grid-cols-2`
 *     (one column on a phone, two from `sm` up). A bare `grid-cols-2` — or one
 *     gated only by a non-breakpoint variant like `hover:` — renders multiple
 *     columns at every width, cramming content on a phone and risking overflow.
 *     An arbitrary-variant breakpoint (`min-[400px]:`) is uncommon and not
 *     recognised here; the app uses the standard breakpoints only.
 *
 * A clean result — `findings: []` — is the executable form of the Day-61 DoD:
 * nothing in the component/app source forces horizontal overflow at phone width.
 *
 * Comment stripping is shared with `palette-audit` (`stripComments`) so a
 * class-shaped token inside a docstring (like the examples above) can't trip a
 * scan, and reported line numbers still match the original file.
 */

import { stripComments } from "./palette-audit";
import type { SourceModule } from "./palette-audit";

export type { SourceModule } from "./palette-audit";

// ── Thresholds & breakpoints ─────────────────────────────────────────────────

/**
 * The narrowest viewport the app must stay usable at (Design.md §6 "usable at
 * all widths"). 360 CSS px covers the common small-phone floor (iPhone SE is
 * 375; small Androids report 360); an absolute width above this cannot be
 * guaranteed to fit once the page's own gutters are subtracted, so it is the
 * line past which a fixed `px`/`rem` width is treated as an overflow hazard.
 */
export const MOBILE_SAFE_WIDTH_PX = 360;

/** 1rem in CSS px, for converting `rem` widths to the px threshold. */
export const REM_IN_PX = 16;

/**
 * Tailwind's responsive breakpoint variant names. A multi-column grid gated by
 * one of these is single-column below that breakpoint (phone-safe); gated by
 * none, it is multi-column at every width.
 */
export const RESPONSIVE_BREAKPOINTS: readonly string[] = [
  "sm",
  "md",
  "lg",
  "xl",
  "2xl",
];

// ── Finding model ────────────────────────────────────────────────────────────

export type ResponsiveFindingKind = "fixed-overflow-width" | "non-responsive-grid";

export interface ResponsiveFinding {
  /** Repo-relative path, POSIX separators. */
  path: string;
  /** 1-based line number of the match. */
  line: number;
  kind: ResponsiveFindingKind;
  /** The exact offending utility matched (e.g. `w-[640px]`, `grid-cols-2`). */
  match: string;
  /** Human-readable reason, e.g. the resolved px width or the missing gate. */
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

// ── 1. Fixed overflow widths ─────────────────────────────────────────────────

// A width-ish arbitrary-value utility: a class boundary, an optional variant
// chain, the property (`w` / `min-w` / `basis` — `max-w` is deliberately
// excluded), and the bracket body. `max-w` never overflows (it only caps). The
// leading `(?<![\w-])` is the class boundary that stops the bare-`w` alternative
// from matching the `w` inside `max-w` / `min-w`-style longer utilities.
const FIXED_WIDTH_RE =
  /(?<![\w-])(?:[a-z0-9-]+:)*(min-w|basis|w)-\[([^\]]*)\]/g;

// An absolute length the browser cannot shrink: a number plus `px` or `rem`.
const ABSOLUTE_LENGTH_RE = /^(\d+(?:\.\d+)?)(px|rem)$/;

/**
 * Resolve an arbitrary width value to CSS px when (and only when) it is an
 * absolute `px`/`rem` length; returns `null` for relative/viewport/content units
 * and anything non-numeric (those are responsive and never flagged).
 */
export function absoluteWidthPx(value: string): number | null {
  const m = ABSOLUTE_LENGTH_RE.exec(value.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === "rem" ? n * REM_IN_PX : n;
}

/** Fixed/min widths wider than the mobile safe width (overflow hazards). */
export function findFixedOverflowWidths(mod: SourceModule): ResponsiveFinding[] {
  const clean = stripComments(mod.src);
  const out: ResponsiveFinding[] = [];
  for (const m of clean.matchAll(FIXED_WIDTH_RE)) {
    const px = absoluteWidthPx(m[2]);
    if (px === null || px <= MOBILE_SAFE_WIDTH_PX) continue;
    out.push({
      path: mod.path,
      line: lineAt(clean, m.index ?? 0),
      kind: "fixed-overflow-width",
      match: m[0],
      detail: `${px}px exceeds the ${MOBILE_SAFE_WIDTH_PX}px mobile safe width`,
    });
  }
  return out;
}

// ── 2. Non-responsive multi-column grids ─────────────────────────────────────

// A numeric `grid-cols-N` with its full (possibly empty) variant chain captured.
const GRID_COLS_RE = /((?:[a-z0-9-]+:)*)grid-cols-(\d+)/g;

/** The variant segments of a chain like `"lg:hover:"` → `["lg", "hover"]`. */
export function variantSegments(chain: string): string[] {
  return chain.split(":").filter((s) => s.length > 0);
}

/** True when a variant chain contains at least one responsive breakpoint. */
export function hasResponsiveBreakpoint(chain: string): boolean {
  const segs = variantSegments(chain);
  return segs.some((s) => RESPONSIVE_BREAKPOINTS.includes(s));
}

/** Multi-column (`grid-cols-N`, N ≥ 2) grids not gated by a breakpoint. */
export function findNonResponsiveGrids(mod: SourceModule): ResponsiveFinding[] {
  const clean = stripComments(mod.src);
  const out: ResponsiveFinding[] = [];
  for (const m of clean.matchAll(GRID_COLS_RE)) {
    const cols = Number(m[2]);
    if (cols < 2) continue; // one column is always phone-safe
    if (hasResponsiveBreakpoint(m[1])) continue; // gated → single-col on phones
    out.push({
      path: mod.path,
      line: lineAt(clean, m.index ?? 0),
      kind: "non-responsive-grid",
      match: m[0],
      detail: `${cols}-column grid with no responsive breakpoint (use e.g. sm:grid-cols-${cols})`,
    });
  }
  return out;
}

// ── Aggregate ────────────────────────────────────────────────────────────────

/** Every responsive finding in one module, in source order. */
export function auditModule(mod: SourceModule): ResponsiveFinding[] {
  return [
    ...findFixedOverflowWidths(mod),
    ...findNonResponsiveGrids(mod),
  ].sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
}

export interface ResponsiveAudit {
  /** True when no module forces horizontal overflow at phone width. */
  clean: boolean;
  findings: ResponsiveFinding[];
}

/**
 * Audit a set of modules. A clean result — `findings: []` — is the executable
 * form of the Day-61 DoD: no layout forces horizontal overflow at phone width.
 */
export function auditResponsive(
  modules: readonly SourceModule[],
): ResponsiveAudit {
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
