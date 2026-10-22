/**
 * Accessibility core (DailyPlan Day 55 — Accessibility pass 1).
 *
 * Pure, framework-agnostic accessibility logic kept out of the React layer so it
 * is node-testable with no DOM, bundler, or credential — mirroring the project's
 * other pure cores (`lib/ui/nav.ts`, `lib/ui/toast.ts`). Two concerns:
 *
 *  1. **Contrast review** (Design.md §6: body text ≥ 4.5:1, large text ≥ 3:1).
 *     WCAG 2.1 relative-luminance + contrast-ratio maths, an sRGB alpha
 *     compositor so a *tinted* wash (`bg-success/10` over the page) can be
 *     evaluated against the real pixels a user sees, and a canonical inventory
 *     (`CONTRAST_CHECKS`) of every meaningful text/UI colour pairing in the app
 *     with the AA level it must clear. `auditContrast()` proves the whole palette
 *     passes — a regression guard, and the thing the Day 55 "contrast review"
 *     DoD is checking.
 *
 *  2. **Skip link / main landmark** (keyboard nav — WCAG 2.4.1 "Bypass Blocks").
 *     The shared id the single skip link targets and the accessible label, so the
 *     link and every page's `<main>` can't drift apart (Rules.md §7).
 *
 * The hex values here mirror the design tokens in `globals.css` /
 * `tailwind.config.ts` (Design.md §2); a drift test pins them together.
 */

// ---------------------------------------------------------------------------
// WCAG contrast primitives
// ---------------------------------------------------------------------------

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Parse a `#rgb` or `#rrggbb` hex string into 0–255 channels. Throws on a
 * malformed value so a typo in the palette inventory fails loudly in a test
 * rather than silently scoring as black.
 */
export function parseHexColor(hex: string): Rgb {
  const match = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) {
    throw new Error(`Invalid hex colour: ${JSON.stringify(hex)}`);
  }
  let body = match[1];
  if (body.length === 3) {
    body = body
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return {
    r: parseInt(body.slice(0, 2), 16),
    g: parseInt(body.slice(2, 4), 16),
    b: parseInt(body.slice(4, 6), 16),
  };
}

/**
 * Composite a foreground colour at `alpha` (0–1) over an opaque background —
 * the "source-over" blend a browser does for a semi-transparent fill like
 * Tailwind's `bg-success/10`. Done in gamma-encoded sRGB space (the 0–255
 * channels), which is what browsers actually do, so the result matches the
 * on-screen pixels. A fully-opaque fg returns itself; a fully-transparent one
 * returns the background.
 */
export function compositeOver(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  const a = Math.min(1, Math.max(0, alpha));
  const blend = (f: number, b: number) => Math.round(f * a + b * (1 - a));
  return { r: blend(fg.r, bg.r), g: blend(fg.g, bg.g), b: blend(fg.b, bg.b) };
}

/** WCAG 2.1 relative luminance of an sRGB colour (0 = black, 1 = white). */
export function relativeLuminance(c: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
  );
}

/** WCAG contrast ratio between two opaque colours — always ≥ 1 (and ≤ 21). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Text size class that sets the AA threshold (large = ≥ 18.66px bold / 24px). */
export type TextSize = "normal" | "large";

/** WCAG 2.1 AA minimums (Design.md §6). */
export const AA_NORMAL_RATIO = 4.5;
export const AA_LARGE_RATIO = 3;

export function minContrastForSize(size: TextSize): number {
  return size === "large" ? AA_LARGE_RATIO : AA_NORMAL_RATIO;
}

export function meetsContrastAA(ratio: number, size: TextSize): boolean {
  // Round to 2dp first: a value like 4.499 that a designer reads as "4.5" in a
  // report should not fail on a floating-point tail.
  return Math.round(ratio * 100) / 100 >= minContrastForSize(size);
}

// ---------------------------------------------------------------------------
// Design-token palette (mirrors globals.css / tailwind.config.ts — Design.md §2)
// ---------------------------------------------------------------------------

export const PALETTE = {
  navy: "#0A1F44",
  royal: "#1E40AF",
  royalBright: "#2563EB",
  burgundy: "#6B1F2A",
  burgundyBright: "#8B2635",
  ink: "#0B0B0F",
  white: "#FFFFFF",
  surface: "#FFFFFF",
  canvas: "#F7F8FA",
  border: "#E4E7EC",
  muted: "#667085",
  body: "#344054",
  success: "#15803D",
  /** Darker green for text on the success tint — added Day 55 (AA fix). */
  successDeep: "#166534",
  warning: "#B45309",
  warningDeep: "#9A3412",
  danger: "#B91C1C",
} as const;

export type PaletteToken = keyof typeof PALETTE;

// ---------------------------------------------------------------------------
// Contrast inventory
// ---------------------------------------------------------------------------

/**
 * A background is either a solid token or a semi-transparent tint (a token at an
 * alpha) composited over an opaque ground token — modelling Tailwind's
 * `bg-<token>/<alpha>` washes exactly as they render.
 */
export type CheckBackground =
  | { kind: "solid"; token: PaletteToken }
  | { kind: "tint"; token: PaletteToken; alpha: number; ground: PaletteToken };

export interface ContrastCheck {
  id: string;
  description: string;
  fg: PaletteToken;
  bg: CheckBackground;
  size: TextSize;
}

export function resolveBackgroundRgb(bg: CheckBackground): Rgb {
  if (bg.kind === "solid") return parseHexColor(PALETTE[bg.token]);
  return compositeOver(
    parseHexColor(PALETTE[bg.token]),
    bg.alpha,
    parseHexColor(PALETTE[bg.ground]),
  );
}

export interface ContrastResult {
  id: string;
  description: string;
  ratio: number;
  required: number;
  passes: boolean;
}

export function evaluateContrastCheck(check: ContrastCheck): ContrastResult {
  const ratio = contrastRatio(
    parseHexColor(PALETTE[check.fg]),
    resolveBackgroundRgb(check.bg),
  );
  return {
    id: check.id,
    description: check.description,
    ratio: Math.round(ratio * 100) / 100,
    required: minContrastForSize(check.size),
    passes: meetsContrastAA(ratio, check.size),
  };
}

/**
 * Every meaningful foreground/background pairing the UI renders. Tinted chips
 * are checked over **canvas** (the darker of the two grounds they sit on, so the
 * tighter case) at the small size their tier label / severity text uses, which
 * is why they must clear the full 4.5:1 and not the large-text 3:1. Solid pills
 * carry white text; body/secondary text is checked on both grounds it appears on.
 */
export const CONTRAST_CHECKS: ContrastCheck[] = [
  // Text on page/card grounds.
  { id: "body-on-surface", description: "Body text on a white surface", fg: "body", bg: { kind: "solid", token: "surface" }, size: "normal" },
  { id: "body-on-canvas", description: "Body text on the app canvas", fg: "body", bg: { kind: "solid", token: "canvas" }, size: "normal" },
  { id: "muted-on-surface", description: "Secondary/caption text on a white surface", fg: "muted", bg: { kind: "solid", token: "surface" }, size: "normal" },
  { id: "muted-on-canvas", description: "Secondary/caption text on the app canvas", fg: "muted", bg: { kind: "solid", token: "canvas" }, size: "normal" },
  { id: "ink-on-surface", description: "Strong heading text on a white surface", fg: "ink", bg: { kind: "solid", token: "surface" }, size: "normal" },
  { id: "navy-on-surface", description: "Navy heading/brand text on a white surface", fg: "navy", bg: { kind: "solid", token: "surface" }, size: "normal" },
  // Links / interactive text.
  { id: "royal-on-surface", description: "Royal-blue link/action text on a white surface", fg: "royal", bg: { kind: "solid", token: "surface" }, size: "normal" },
  { id: "royal-on-canvas", description: "Royal-blue link/action text on the app canvas", fg: "royal", bg: { kind: "solid", token: "canvas" }, size: "normal" },
  // Solid verdict pills — white text on a brand fill (tone-classes.ts PILL_CLASSES).
  { id: "white-on-royal", description: "White text on a royal fill (7–8 pill)", fg: "white", bg: { kind: "solid", token: "royal" }, size: "normal" },
  { id: "white-on-navy", description: "White text on a navy header/surface", fg: "white", bg: { kind: "solid", token: "navy" }, size: "normal" },
  { id: "white-on-success", description: "White text on a success fill (pass pill)", fg: "white", bg: { kind: "solid", token: "success" }, size: "normal" },
  { id: "white-on-warning", description: "White text on a warning fill (revise/5–6 pill)", fg: "white", bg: { kind: "solid", token: "warning" }, size: "normal" },
  { id: "white-on-warning-deep", description: "White text on a warning-deep fill (3–4 pill)", fg: "white", bg: { kind: "solid", token: "warningDeep" }, size: "normal" },
  { id: "white-on-danger", description: "White text on a danger fill (fail pill)", fg: "white", bg: { kind: "solid", token: "danger" }, size: "normal" },
  { id: "white-on-burgundy", description: "White text on a burgundy fill (compliance flag)", fg: "white", bg: { kind: "solid", token: "burgundy" }, size: "normal" },
  { id: "white-on-muted", description: "White text on a muted fill (neutral pill)", fg: "white", bg: { kind: "solid", token: "muted" }, size: "normal" },
  // Tinted chips/badges — coloured text on a /10 wash over the canvas ground
  // (tone-classes.ts CHIP_CLASSES/BADGE_CLASSES). Small label/severity text → 4.5:1.
  { id: "success-chip-text", description: "Success chip/badge text on a success tint", fg: "successDeep", bg: { kind: "tint", token: "success", alpha: 0.1, ground: "canvas" }, size: "normal" },
  { id: "royal-chip-text", description: "Royal chip/badge text on a royal tint", fg: "royal", bg: { kind: "tint", token: "royal", alpha: 0.1, ground: "canvas" }, size: "normal" },
  { id: "warning-chip-text", description: "Warning chip/badge text on a warning tint", fg: "warningDeep", bg: { kind: "tint", token: "warning", alpha: 0.1, ground: "canvas" }, size: "normal" },
  { id: "warning-deep-chip-text", description: "Warning-deep chip/badge text on a warning-deep tint", fg: "warningDeep", bg: { kind: "tint", token: "warningDeep", alpha: 0.1, ground: "canvas" }, size: "normal" },
  { id: "danger-chip-text", description: "Danger chip/badge text on a danger tint", fg: "danger", bg: { kind: "tint", token: "danger", alpha: 0.1, ground: "canvas" }, size: "normal" },
  { id: "burgundy-chip-text", description: "Burgundy chip/badge text on a burgundy tint", fg: "burgundy", bg: { kind: "tint", token: "burgundy", alpha: 0.1, ground: "canvas" }, size: "normal" },
  { id: "neutral-chip-text", description: "Neutral chip/badge text (muted) on the canvas wash", fg: "muted", bg: { kind: "solid", token: "canvas" }, size: "normal" },
];

export interface ContrastAudit {
  passes: boolean;
  results: ContrastResult[];
  failures: ContrastResult[];
}

/** Evaluate every pairing; `passes` is true only when they all clear AA. */
export function auditContrast(
  checks: ContrastCheck[] = CONTRAST_CHECKS,
): ContrastAudit {
  const results = checks.map(evaluateContrastCheck);
  const failures = results.filter((r) => !r.passes);
  return { passes: failures.length === 0, results, failures };
}

// ---------------------------------------------------------------------------
// Skip link / main landmark (keyboard nav — WCAG 2.4.1 "Bypass Blocks")
// ---------------------------------------------------------------------------

/**
 * The id every page's `<main>` carries and the single skip link targets. One
 * skip link lives in the root layout; whichever page renders owns the one
 * `#main-content` landmark, so the link always lands on the current page's
 * content past the header/nav.
 */
export const MAIN_CONTENT_ID = "main-content";

/** Accessible label / visible text for the skip link. */
export const SKIP_LINK_LABEL = "Skip to main content";

/** The in-page anchor the skip link points at. */
export function mainContentHref(): string {
  return `#${MAIN_CONTENT_ID}`;
}
