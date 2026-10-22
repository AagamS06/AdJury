import type { ToastTone } from "@/lib/ui/toast";

/**
 * Tailwind class maps for the notification tones from `lib/ui/toast.ts`
 * (DailyPlan Day 53), kept in a framework-agnostic `.ts` module so the mapping
 * is unit-testable in the node env — the same split as `tone-classes.ts` for the
 * scorecard. Colour lives here (the component layer); every tone still ships a
 * text label at the call site, so meaning is never carried by colour alone
 * (Design.md §6). Foreground colours are the same-hue text on a near-white wash
 * used across the app, chosen to clear WCAG AA contrast (≥ 4.5:1) — the success
 * badge uses the deeper `text-success-deep` (Day 55 contrast fix; full-strength
 * `text-success` on its own `/10` wash fell short of 4.5:1).
 */

/** The tone badge: coloured text on a light wash with a subtle ring. */
export const TOAST_BADGE_CLASSES: Record<ToastTone, string> = {
  success: "bg-success/10 text-success-deep ring-1 ring-success/30",
  error: "bg-danger/10 text-danger ring-1 ring-danger/30",
  info: "bg-royal/10 text-royal ring-1 ring-royal/30",
};

/** Left accent border on the toast card, keyed by tone (a quick visual scan cue). */
export const TOAST_ACCENT_CLASSES: Record<ToastTone, string> = {
  success: "border-l-success",
  error: "border-l-danger",
  info: "border-l-royal",
};
