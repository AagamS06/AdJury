"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import {
  createToast,
  shouldAutoDismiss,
  toastAriaLive,
  toastReducer,
  toastRole,
  toneLabel,
  type Toast,
  type ToastInput,
} from "@/lib/ui/toast";
import {
  TOAST_ACCENT_CLASSES,
  TOAST_BADGE_CLASSES,
} from "@/components/ui/toast-classes";

/**
 * App-wide toast / notification layer (DailyPlan Day 53). `ToastProvider` is
 * mounted once in the root layout so any client surface can raise a notification
 * with `useToast().notify(...)`; the `ToastViewport` it renders stacks live
 * toasts bottom-anchored (centred on mobile, bottom-right on desktop).
 *
 * All the logic — normalising input, dedupe, the cap, and the ARIA role / live
 * mapping — lives in the pure `lib/ui/toast.ts` core; this island only holds the
 * reducer state, the auto-dismiss timers, and the markup.
 *
 * Accessibility (Design.md §6): each toast carries its tone as a **text** badge
 * (never colour alone) and announces itself via `role="alert"` (errors, polite
 * is too quiet for a failure) or `role="status"` (confirmations); hovering or
 * focusing a toast pauses its auto-dismiss so it can be read; the dismiss button
 * has a real accessible name and a visible focus ring.
 */

interface ToastContextValue {
  toasts: Toast[];
  /** Raise a toast; returns its id so a caller can dismiss it early. */
  notify: (input: ToastInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

/** No-op fallback so `useToast()` is safe to call outside a provider (feedback
 * is simply dropped rather than throwing — the calling surface still works). */
const NOOP_TOAST: ToastContextValue = {
  toasts: [],
  notify: () => "",
  dismiss: () => {},
  clear: () => {},
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, dispatch] = useReducer(toastReducer, []);

  const notify = useCallback((input: ToastInput) => {
    const toast = createToast(input);
    dispatch({ type: "add", toast });
    return toast.id;
  }, []);
  const dismiss = useCallback((id: string) => dispatch({ type: "dismiss", id }), []);
  const clear = useCallback(() => dispatch({ type: "clear" }), []);

  const value = useMemo<ToastContextValue>(
    () => ({ toasts, notify, dismiss, clear }),
    [toasts, notify, dismiss, clear],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/** Read the toast API. Returns a safe no-op when no provider is mounted. */
export function useToast(): ToastContextValue {
  return useContext(ToastContext) ?? NOOP_TOAST;
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div
      // The region label lets a screen-reader user jump to notifications; it
      // doesn't swallow focus (pointer-events only re-enabled on each card).
      role="region"
      aria-label="Notifications"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: string) => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // (Re)start the auto-dismiss countdown. Re-entering gives a fresh full window
  // so a toast the user just read/hovered doesn't vanish the instant they leave.
  const startTimer = useCallback(() => {
    clearTimer();
    if (!shouldAutoDismiss(toast)) return;
    timer.current = setTimeout(() => onDismiss(toast.id), toast.durationMs as number);
  }, [toast, onDismiss, clearTimer]);

  useEffect(() => {
    startTimer();
    return clearTimer;
  }, [startTimer, clearTimer]);

  return (
    <div
      role={toastRole(toast.tone)}
      aria-live={toastAriaLive(toast.tone)}
      aria-atomic="true"
      onMouseEnter={clearTimer}
      onMouseLeave={startTimer}
      onFocus={clearTimer}
      onBlur={startTimer}
      className={`toast-enter pointer-events-auto w-full max-w-sm rounded-md border border-l-4 border-border bg-surface p-3 shadow-[0_4px_12px_rgba(11,11,15,.10)] ${TOAST_ACCENT_CLASSES[toast.tone]}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${TOAST_BADGE_CLASSES[toast.tone]}`}
        >
          {toneLabel(toast.tone)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-navy">{toast.title}</p>
          {toast.message && (
            <p className="mt-0.5 text-sm text-body">{toast.message}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          aria-label="Dismiss notification"
          className="-mr-1 -mt-1 shrink-0 rounded-sm p-1 text-lg leading-none text-muted transition-colors hover:text-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
        >
          <span aria-hidden="true">&times;</span>
        </button>
      </div>
    </div>
  );
}
