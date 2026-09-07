import type { Tone } from "@/lib/reviews/scorecard-view";

/**
 * Tailwind class maps for the semantic tones from `scorecard-view.ts`.
 *
 * Colour lives here (the component layer), not in the pure view module, so the
 * logic stays framework-agnostic and testable. Every tone still ships with a
 * text label at the call site — colour is never the only signal (Design.md §6).
 *
 * Day 10 completes the palette: the distinct `warning-deep` (3–4 score tier)
 * and the `burgundy` compliance-flag family (Design.md §2/§5). All foreground
 * colours are chosen to clear WCAG AA contrast (≥ 4.5:1) — solid tokens carry
 * white text; tinted washes carry the same-hue text on a near-white ground.
 */

/** Filled, high-contrast pill (verdict). White text on a solid brand colour. */
export const PILL_CLASSES: Record<Tone, string> = {
  success: "bg-success text-white",
  royal: "bg-royal text-white",
  warning: "bg-warning text-white",
  "warning-deep": "bg-warning-deep text-white",
  danger: "bg-danger text-white",
  burgundy: "bg-burgundy text-white",
  neutral: "bg-muted text-white",
};

/** Tinted chip (score). Coloured text + subtle ring on a light wash. */
export const CHIP_CLASSES: Record<Tone, string> = {
  success: "bg-success/10 text-success ring-1 ring-success/30",
  royal: "bg-royal/10 text-royal ring-1 ring-royal/30",
  warning: "bg-warning/10 text-warning ring-1 ring-warning/30",
  "warning-deep": "bg-warning-deep/10 text-warning-deep ring-1 ring-warning-deep/30",
  danger: "bg-danger/10 text-danger ring-1 ring-danger/30",
  burgundy: "bg-burgundy/10 text-burgundy ring-1 ring-burgundy/30",
  neutral: "bg-canvas text-muted ring-1 ring-border",
};

/**
 * Small severity badge (issue-severity styling). Same tinted-wash treatment as
 * the score chip but sized for an inline flag; `neutral` (low severity) stays
 * quiet so high/medium read as the emphatic ones.
 */
export const BADGE_CLASSES: Record<Tone, string> = {
  success: "bg-success/10 text-success ring-1 ring-success/25",
  royal: "bg-royal/10 text-royal ring-1 ring-royal/25",
  warning: "bg-warning/10 text-warning ring-1 ring-warning/25",
  "warning-deep": "bg-warning-deep/10 text-warning-deep ring-1 ring-warning-deep/25",
  danger: "bg-danger/10 text-danger ring-1 ring-danger/25",
  burgundy: "bg-burgundy/10 text-burgundy ring-1 ring-burgundy/25",
  neutral: "bg-canvas text-muted ring-1 ring-border",
};

/** Left accent border for an issue row, keyed by the same severity tone. */
export const ISSUE_BORDER_CLASSES: Record<Tone, string> = {
  success: "border-success/40",
  royal: "border-royal/40",
  warning: "border-warning/40",
  "warning-deep": "border-warning-deep/40",
  danger: "border-danger/40",
  burgundy: "border-burgundy/50",
  neutral: "border-border",
};
