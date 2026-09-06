import type { Tone } from "@/lib/reviews/scorecard-view";

/**
 * Tailwind class maps for the semantic tones from `scorecard-view.ts`.
 *
 * Colour lives here (the component layer), not in the pure view module, so the
 * logic stays framework-agnostic and testable. Every tone still ships with a
 * text label at the call site — colour is never the only signal (Design.md §6).
 */

/** Filled, high-contrast pill (verdict). White text on a solid brand colour. */
export const PILL_CLASSES: Record<Tone, string> = {
  success: "bg-success text-white",
  royal: "bg-royal text-white",
  warning: "bg-warning text-white",
  danger: "bg-danger text-white",
  neutral: "bg-muted text-white",
};

/** Tinted chip (score). Coloured text + subtle ring on a light wash. */
export const CHIP_CLASSES: Record<Tone, string> = {
  success: "bg-success/10 text-success ring-1 ring-success/30",
  royal: "bg-royal/10 text-royal ring-1 ring-royal/30",
  warning: "bg-warning/10 text-warning ring-1 ring-warning/30",
  danger: "bg-danger/10 text-danger ring-1 ring-danger/30",
  neutral: "bg-canvas text-muted ring-1 ring-border",
};
