import { describe, it, expect } from "vitest";
import {
  createToast,
  dedupeKey,
  DEFAULT_TOAST_DURATION_MS,
  MAX_VISIBLE_TOASTS,
  shouldAutoDismiss,
  toastAriaLive,
  toastReducer,
  toastRole,
  toneLabel,
  type Toast,
  type ToastTone,
} from "@/lib/ui/toast";
import {
  TOAST_ACCENT_CLASSES,
  TOAST_BADGE_CLASSES,
} from "@/components/ui/toast-classes";

/**
 * Toast / notification system (DailyPlan Day 53) — the logic that drives the
 * app-wide feedback layer. The component is a thin island; everything decidable
 * without a DOM is pinned here: input normalisation, dedupe, the visible-count
 * cap, and the accessibility mapping (every tone → a text label + an ARIA role /
 * live-region politeness, so a notification is never colour-only, Design.md §6).
 */

const ALL_TONES: ToastTone[] = ["success", "error", "info"];

/** Deterministic toast factory for reducer tests (no clock/id injection noise). */
function toast(overrides: Partial<Toast> = {}): Toast {
  return {
    id: "t-1",
    tone: "info",
    title: "Hello",
    message: undefined,
    durationMs: 5000,
    createdAt: 0,
    ...overrides,
  };
}

describe("createToast — normalisation", () => {
  it("assigns id + createdAt from the injected sources (deterministic)", () => {
    const t = createToast(
      { tone: "success", title: "Saved" },
      { id: () => "fixed-id", now: () => 123 },
    );
    expect(t.id).toBe("fixed-id");
    expect(t.createdAt).toBe(123);
    expect(t.tone).toBe("success");
    expect(t.title).toBe("Saved");
  });

  it("trims the title and drops a blank/whitespace message", () => {
    const t = createToast(
      { tone: "info", title: "  Heads up  ", message: "   " },
      { id: () => "x", now: () => 0 },
    );
    expect(t.title).toBe("Heads up");
    expect(t.message).toBeUndefined();
  });

  it("keeps a real (trimmed) message", () => {
    const t = createToast(
      { tone: "info", title: "Done", message: "  all five jurors replied " },
      { id: () => "x", now: () => 0 },
    );
    expect(t.message).toBe("all five jurors replied");
  });

  it("falls back to the tone label when the title is empty (always carries a word)", () => {
    for (const tone of ALL_TONES) {
      const t = createToast({ tone, title: "   " }, { id: () => "x", now: () => 0 });
      expect(t.title).toBe(toneLabel(tone));
      expect(t.title.trim().length).toBeGreaterThan(0);
    }
  });

  it("uses the per-tone default duration, and honours an explicit override incl. sticky null", () => {
    for (const tone of ALL_TONES) {
      const def = createToast({ tone, title: "t" }, { id: () => "x", now: () => 0 });
      expect(def.durationMs).toBe(DEFAULT_TOAST_DURATION_MS[tone]);
    }
    const sticky = createToast(
      { tone: "error", title: "t", durationMs: null },
      { id: () => "x", now: () => 0 },
    );
    expect(sticky.durationMs).toBeNull();

    const custom = createToast(
      { tone: "success", title: "t", durationMs: 1200 },
      { id: () => "x", now: () => 0 },
    );
    expect(custom.durationMs).toBe(1200);
  });

  it("gives every tone a positive default window (errors linger longest)", () => {
    for (const tone of ALL_TONES) {
      expect(DEFAULT_TOAST_DURATION_MS[tone]).toBeGreaterThan(0);
    }
    expect(DEFAULT_TOAST_DURATION_MS.error).toBeGreaterThanOrEqual(
      DEFAULT_TOAST_DURATION_MS.success,
    );
  });
});

describe("shouldAutoDismiss", () => {
  it("is true for a finite positive window, false for sticky (null) or zero", () => {
    expect(shouldAutoDismiss(toast({ durationMs: 5000 }))).toBe(true);
    expect(shouldAutoDismiss(toast({ durationMs: null }))).toBe(false);
    expect(shouldAutoDismiss(toast({ durationMs: 0 }))).toBe(false);
  });
});

describe("toastReducer — add / dismiss / clear", () => {
  it("appends new toasts in order", () => {
    let state: Toast[] = [];
    state = toastReducer(state, { type: "add", toast: toast({ id: "a" }) });
    state = toastReducer(state, { type: "add", toast: toast({ id: "b", title: "Second" }) });
    expect(state.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("dedupes an identical toast (same tone+title+message), refreshing it to the end", () => {
    let state: Toast[] = [];
    state = toastReducer(state, { type: "add", toast: toast({ id: "a", title: "Copied" }) });
    state = toastReducer(state, { type: "add", toast: toast({ id: "b", title: "Other" }) });
    // Re-raise the identical "Copied" toast — it should not stack.
    state = toastReducer(state, { type: "add", toast: toast({ id: "c", title: "Copied" }) });
    expect(state).toHaveLength(2);
    // The refreshed copy (new id "c") sits at the end; the stale "a" is gone.
    expect(state.map((t) => t.id)).toEqual(["b", "c"]);
  });

  it("treats a differing message as a distinct toast (not a dupe)", () => {
    let state: Toast[] = [];
    state = toastReducer(state, { type: "add", toast: toast({ id: "a", title: "Saved", message: "name" }) });
    state = toastReducer(state, { type: "add", toast: toast({ id: "b", title: "Saved", message: "email" }) });
    expect(state).toHaveLength(2);
  });

  it(`caps the stack at ${MAX_VISIBLE_TOASTS}, dropping the oldest`, () => {
    let state: Toast[] = [];
    for (let i = 0; i < MAX_VISIBLE_TOASTS + 3; i++) {
      state = toastReducer(state, {
        type: "add",
        toast: toast({ id: `t-${i}`, title: `Toast ${i}` }),
      });
    }
    expect(state).toHaveLength(MAX_VISIBLE_TOASTS);
    // Oldest (t-0..t-2) dropped; the most recent MAX_VISIBLE_TOASTS remain.
    expect(state[0].id).toBe("t-3");
    expect(state[state.length - 1].id).toBe(`t-${MAX_VISIBLE_TOASTS + 2}`);
  });

  it("dismiss removes exactly the matching id and leaves the rest", () => {
    let state = [toast({ id: "a" }), toast({ id: "b" }), toast({ id: "c" })];
    state = toastReducer(state, { type: "dismiss", id: "b" });
    expect(state.map((t) => t.id)).toEqual(["a", "c"]);
    // Dismissing an unknown id is a no-op.
    state = toastReducer(state, { type: "dismiss", id: "zzz" });
    expect(state.map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("clear empties the stack", () => {
    const state = toastReducer([toast({ id: "a" }), toast({ id: "b" })], { type: "clear" });
    expect(state).toEqual([]);
  });

  it("never mutates the input state (returns a new array)", () => {
    const before = [toast({ id: "a" })];
    const after = toastReducer(before, { type: "add", toast: toast({ id: "b" }) });
    expect(before).toHaveLength(1);
    expect(after).not.toBe(before);
  });
});

describe("dedupeKey", () => {
  it("collapses identical tone+title+message and separates any difference", () => {
    const base = toast({ tone: "success", title: "Saved", message: "ok" });
    expect(dedupeKey(base)).toBe(dedupeKey(toast({ tone: "success", title: "Saved", message: "ok", id: "other" })));
    expect(dedupeKey(base)).not.toBe(dedupeKey(toast({ tone: "error", title: "Saved", message: "ok" })));
    expect(dedupeKey(base)).not.toBe(dedupeKey(toast({ tone: "success", title: "Saved", message: undefined })));
  });
});

describe("accessibility: a notification is never colour-only (Design.md §6)", () => {
  it("gives every tone a non-empty, distinct text label", () => {
    const labels = ALL_TONES.map(toneLabel);
    for (const label of labels) {
      expect(label.trim().length).toBeGreaterThan(0);
    }
    expect(new Set(labels).size).toBe(ALL_TONES.length);
  });

  it("announces errors assertively (alert) and everything else politely (status)", () => {
    expect(toastRole("error")).toBe("alert");
    expect(toastAriaLive("error")).toBe("assertive");
    for (const tone of ["success", "info"] as const) {
      expect(toastRole(tone)).toBe("status");
      expect(toastAriaLive(tone)).toBe("polite");
    }
  });

  it("maps every tone to a real (non-empty) badge + accent class — no style-less signal", () => {
    for (const tone of ALL_TONES) {
      expect(TOAST_BADGE_CLASSES[tone]?.trim().length).toBeGreaterThan(0);
      expect(TOAST_ACCENT_CLASSES[tone]?.trim().length).toBeGreaterThan(0);
    }
    // No stray keys beyond the known tones in either map.
    expect(Object.keys(TOAST_BADGE_CLASSES).sort()).toEqual([...ALL_TONES].sort());
    expect(Object.keys(TOAST_ACCENT_CLASSES).sort()).toEqual([...ALL_TONES].sort());
  });
});
