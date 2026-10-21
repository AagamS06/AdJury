/**
 * Toast / notification system — pure logic core (DailyPlan Day 53).
 *
 * AdJury gives feedback two ways: **inline** messages for field/form validation
 * that belong next to a control (the `FormError`/`FormNotice` primitives), and
 * **toasts** — transient, app-level confirmations and errors for the *outcome*
 * of an action (a review finished, a copy succeeded/failed, a download started).
 * This module owns the toast *logic* so it is unit-testable in the node test env
 * with no DOM, mirroring the project's "pure core + thin client island" pattern
 * (cf. `scorecard-view.ts`, `export-ui.ts`): the client island in
 * `components/ui/toast.tsx` only holds React state and renders.
 *
 * Accessibility (Design.md §6): a toast's meaning is never carried by colour
 * alone. Every tone maps to a text label (`toneLabel`) shown in the card, and to
 * an ARIA role / live-region politeness (`toastRole`, `toastAriaLive`) so a
 * screen reader announces it — errors assertively, confirmations politely.
 */

/** The semantic kinds of notification AdJury raises. */
export type ToastTone = "success" | "error" | "info";

/** What a caller passes to raise a toast. */
export interface ToastInput {
  tone: ToastTone;
  /** Short, bold headline (e.g. "Review complete"). Required. */
  title: string;
  /** Optional supporting line (e.g. "Verdict: Pass · Score 8.2"). */
  message?: string;
  /**
   * Override the auto-dismiss window, in ms. Omit to use the per-tone default;
   * `null` makes the toast sticky (stays until the user dismisses it).
   */
  durationMs?: number | null;
}

/** A live toast in the stack. */
export interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  message?: string;
  /** Auto-dismiss window in ms, or `null` for sticky. */
  durationMs: number | null;
  /** When it was created (ms epoch) — injectable for deterministic tests. */
  createdAt: number;
}

/**
 * How many toasts show at once. Beyond this the oldest is dropped so a burst of
 * notifications can never bury the page or trap focus.
 */
export const MAX_VISIBLE_TOASTS = 4;

/**
 * Default auto-dismiss windows per tone (ms). Errors linger longest because they
 * ask the user to do something (Rules.md §6 — surface a clear, actionable
 * message); confirmations clear quickly so they don't pile up. Any toast can
 * override this, including `null` for sticky.
 */
export const DEFAULT_TOAST_DURATION_MS: Record<ToastTone, number> = {
  success: 5000,
  info: 6000,
  error: 8000,
};

/** The human, colour-independent label for a tone (shown as a badge in the card). */
export function toneLabel(tone: ToastTone): string {
  switch (tone) {
    case "success":
      return "Success";
    case "error":
      return "Error";
    case "info":
      return "Notice";
    default: {
      // Exhaustiveness guard — a new tone must extend every mapping here.
      const exhaustive: never = tone;
      return exhaustive;
    }
  }
}

/**
 * ARIA role for a toast's container. Errors are assertive `alert`s (interrupt);
 * confirmations are polite `status` updates (wait for a pause).
 */
export function toastRole(tone: ToastTone): "alert" | "status" {
  return tone === "error" ? "alert" : "status";
}

/** Live-region politeness matching {@link toastRole}. */
export function toastAriaLive(tone: ToastTone): "assertive" | "polite" {
  return tone === "error" ? "assertive" : "polite";
}

/** Whether a toast should auto-dismiss (finite, positive window) vs stay sticky. */
export function shouldAutoDismiss(toast: Toast): boolean {
  return toast.durationMs !== null && toast.durationMs > 0;
}

/** Options for {@link createToast} — injectable id/clock keep tests deterministic. */
export interface CreateToastOptions {
  id?: () => string;
  now?: () => number;
}

let idCounter = 0;

/** Default id source: monotonic counter + base-36 timestamp, unique per session. */
export function defaultToastId(): string {
  idCounter += 1;
  return `toast-${idCounter}-${Date.now().toString(36)}`;
}

/**
 * Normalise a {@link ToastInput} into a {@link Toast}: trim text, fall back to
 * the tone label if the title is blank (a toast must always carry a word), drop
 * an empty message, and resolve the auto-dismiss window.
 */
export function createToast(input: ToastInput, opts: CreateToastOptions = {}): Toast {
  const makeId = opts.id ?? defaultToastId;
  const clock = opts.now ?? Date.now;

  const title = input.title.trim() || toneLabel(input.tone);
  const trimmedMessage = input.message?.trim();
  const durationMs =
    input.durationMs === undefined
      ? DEFAULT_TOAST_DURATION_MS[input.tone]
      : input.durationMs;

  return {
    id: makeId(),
    tone: input.tone,
    title,
    message: trimmedMessage ? trimmedMessage : undefined,
    durationMs,
    createdAt: clock(),
  };
}

/**
 * Dedupe key for a toast — identical tone + title + message collapse into one so
 * a user mashing "Copy" doesn't stack five "Copied" toasts.
 */
export function dedupeKey(toast: Toast): string {
  return `${toast.tone}\u0000${toast.title}\u0000${toast.message ?? ""}`;
}

/** Reducer actions for the toast stack. */
export type ToastAction =
  | { type: "add"; toast: Toast }
  | { type: "dismiss"; id: string }
  | { type: "clear" };

/**
 * Pure reducer for the toast stack. `add` refreshes an identical toast in place
 * (dedupe) and caps the stack at {@link MAX_VISIBLE_TOASTS}, dropping the oldest;
 * `dismiss` removes one by id; `clear` empties the stack.
 */
export function toastReducer(state: Toast[], action: ToastAction): Toast[] {
  switch (action.type) {
    case "add": {
      const key = dedupeKey(action.toast);
      const withoutDuplicate = state.filter((t) => dedupeKey(t) !== key);
      const next = [...withoutDuplicate, action.toast];
      return next.length > MAX_VISIBLE_TOASTS
        ? next.slice(next.length - MAX_VISIBLE_TOASTS)
        : next;
    }
    case "dismiss":
      return state.filter((t) => t.id !== action.id);
    case "clear":
      return [];
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
