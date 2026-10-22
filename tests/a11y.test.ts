import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parseHexColor,
  compositeOver,
  relativeLuminance,
  contrastRatio,
  meetsContrastAA,
  minContrastForSize,
  AA_NORMAL_RATIO,
  AA_LARGE_RATIO,
  PALETTE,
  resolveBackgroundRgb,
  evaluateContrastCheck,
  auditContrast,
  CONTRAST_CHECKS,
  MAIN_CONTENT_ID,
  SKIP_LINK_LABEL,
  mainContentHref,
  type Rgb,
} from "@/lib/ui/a11y";

/**
 * Accessibility pass 1 (DailyPlan Day 55). Pins the pure a11y core:
 *
 *  - WCAG contrast maths + sRGB alpha compositing (so a tinted `bg-x/10` wash is
 *    scored against the pixels a user actually sees).
 *  - The whole-palette `auditContrast()` — the executable "contrast review"
 *    (Design.md §6): every text/UI pairing clears AA. Also proves the Day 55 fix
 *    *matters* (the old full-strength success/warning chip text would have
 *    failed; the deepened text passes) and that the inventory reflects the real
 *    committed design tokens (a drift guard reading `tailwind.config.ts`).
 *  - The skip-link / `#main-content` landmark contract (keyboard nav, WCAG
 *    2.4.1): one skip link in the root layout, every page's `<main>` carrying the
 *    shared id — proven by reading the real source so the two can't drift.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(`${repoRoot}${rel}`, "utf8");

const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

describe("hex parsing", () => {
  it("parses #rrggbb and #rgb, with or without the hash", () => {
    expect(parseHexColor("#FFFFFF")).toEqual(WHITE);
    expect(parseHexColor("000000")).toEqual(BLACK);
    expect(parseHexColor("#fff")).toEqual(WHITE);
    expect(parseHexColor("#1E40AF")).toEqual({ r: 30, g: 64, b: 175 });
    // 3-digit expands each nibble.
    expect(parseHexColor("#f00")).toEqual({ r: 255, g: 0, b: 0 });
  });

  it("throws on a malformed value rather than scoring it as black", () => {
    expect(() => parseHexColor("")).toThrow();
    expect(() => parseHexColor("#12")).toThrow();
    expect(() => parseHexColor("#12345")).toThrow();
    expect(() => parseHexColor("#zzzzzz")).toThrow();
    expect(() => parseHexColor("rgb(0,0,0)")).toThrow();
  });
});

describe("relative luminance and contrast ratio (WCAG 2.1)", () => {
  it("anchors luminance at black (0) and white (1)", () => {
    expect(relativeLuminance(BLACK)).toBeCloseTo(0, 5);
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 5);
  });

  it("gives the canonical 21:1 for black on white and 1:1 for identical colours", () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 2);
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 5);
    expect(contrastRatio(BLACK, BLACK)).toBeCloseTo(1, 5);
  });

  it("is symmetric in its arguments", () => {
    const a = parseHexColor(PALETTE.royal);
    const b = parseHexColor(PALETTE.canvas);
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });
});

describe("sRGB alpha compositing", () => {
  it("returns the background at alpha 0 and the foreground at alpha 1", () => {
    const fg = parseHexColor(PALETTE.success);
    const bg = parseHexColor(PALETTE.canvas);
    expect(compositeOver(fg, 0, bg)).toEqual(bg);
    expect(compositeOver(fg, 1, bg)).toEqual(fg);
  });

  it("blends halfway at alpha 0.5", () => {
    expect(compositeOver({ r: 200, g: 100, b: 0 }, 0.5, { r: 0, g: 0, b: 100 })).toEqual({
      r: 100,
      g: 50,
      b: 50,
    });
  });

  it("clamps an out-of-range alpha", () => {
    const fg = { r: 10, g: 20, b: 30 };
    const bg = { r: 200, g: 210, b: 220 };
    expect(compositeOver(fg, -1, bg)).toEqual(bg);
    expect(compositeOver(fg, 5, bg)).toEqual(fg);
  });
});

describe("AA thresholds", () => {
  it("requires 4.5 for normal text and 3 for large text", () => {
    expect(minContrastForSize("normal")).toBe(AA_NORMAL_RATIO);
    expect(minContrastForSize("large")).toBe(AA_LARGE_RATIO);
    expect(AA_NORMAL_RATIO).toBe(4.5);
    expect(AA_LARGE_RATIO).toBe(3);
  });

  it("passes exactly at the threshold and fails just below", () => {
    expect(meetsContrastAA(4.5, "normal")).toBe(true);
    expect(meetsContrastAA(4.49, "normal")).toBe(false);
    expect(meetsContrastAA(3, "large")).toBe(true);
    expect(meetsContrastAA(2.99, "large")).toBe(false);
    // A value whose 2dp rounding lands on the threshold passes (no float tail).
    expect(meetsContrastAA(4.498, "normal")).toBe(true);
  });
});

describe("contrast inventory audit (the executable 'contrast review')", () => {
  it("resolves every check's foreground and background to a real colour", () => {
    for (const check of CONTRAST_CHECKS) {
      expect(PALETTE[check.fg], `unknown fg token ${check.fg}`).toBeTruthy();
      // Resolving the background must not throw (all tokens valid hex).
      expect(() => resolveBackgroundRgb(check.bg)).not.toThrow();
    }
  });

  it("has unique, non-empty check ids", () => {
    const ids = CONTRAST_CHECKS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.trim().length).toBeGreaterThan(0);
  });

  it("passes AA for EVERY pairing in the app palette", () => {
    const audit = auditContrast();
    // A readable failure list if this ever regresses.
    expect(
      audit.failures.map((f) => `${f.id} = ${f.ratio} (needs ${f.required})`),
    ).toEqual([]);
    expect(audit.passes).toBe(true);
    expect(audit.results).toHaveLength(CONTRAST_CHECKS.length);
  });

  it("proves the Day 55 fix matters: deep success/warning chip text passes where full-strength failed", () => {
    // The tint background the chip/badge sits on (bg-<tone>/10 over canvas).
    const successTint = resolveBackgroundRgb({
      kind: "tint",
      token: "success",
      alpha: 0.1,
      ground: "canvas",
    });
    const warningTint = resolveBackgroundRgb({
      kind: "tint",
      token: "warning",
      alpha: 0.1,
      ground: "canvas",
    });

    // Before: full-strength token text fell short of AA for small text.
    expect(
      meetsContrastAA(contrastRatio(parseHexColor(PALETTE.success), successTint), "normal"),
    ).toBe(false);
    expect(
      meetsContrastAA(contrastRatio(parseHexColor(PALETTE.warning), warningTint), "normal"),
    ).toBe(false);

    // After: the deepened same-hue text clears AA.
    expect(
      meetsContrastAA(contrastRatio(parseHexColor(PALETTE.successDeep), successTint), "normal"),
    ).toBe(true);
    expect(
      meetsContrastAA(contrastRatio(parseHexColor(PALETTE.warningDeep), warningTint), "normal"),
    ).toBe(true);
  });

  it("evaluateContrastCheck rounds the ratio to 2dp and reports the required level", () => {
    const result = evaluateContrastCheck({
      id: "demo",
      description: "demo",
      fg: "white",
      bg: { kind: "solid", token: "navy" },
      size: "normal",
    });
    expect(result.required).toBe(4.5);
    expect(result.passes).toBe(true);
    expect(Math.round(result.ratio * 100) / 100).toBe(result.ratio);
  });
});

describe("palette reflects the committed design tokens (drift guard)", () => {
  it("every PALETTE hex appears in tailwind.config.ts", () => {
    const config = read("tailwind.config.ts").toLowerCase();
    for (const [name, hex] of Object.entries(PALETTE)) {
      expect(config.includes(hex.toLowerCase()), `tailwind.config.ts missing ${name} (${hex})`).toBe(true);
    }
  });

  it("the Day 55 success-deep token is defined in globals.css and tailwind config", () => {
    expect(read("src/app/globals.css").toLowerCase()).toContain(PALETTE.successDeep.toLowerCase());
    expect(read("tailwind.config.ts").toLowerCase()).toContain(PALETTE.successDeep.toLowerCase());
  });
});

describe("skip link / main landmark (WCAG 2.4.1 bypass blocks)", () => {
  it("exposes a stable id, label, and anchor href", () => {
    expect(MAIN_CONTENT_ID).toBe("main-content");
    expect(mainContentHref()).toBe("#main-content");
    expect(SKIP_LINK_LABEL.toLowerCase()).toContain("content");
  });

  it("mounts exactly one skip link in the root layout", () => {
    const rootLayout = read("src/app/layout.tsx");
    expect(rootLayout).toContain("SkipLink");
    expect(rootLayout).toContain('from "@/components/ui/skip-link"');
  });

  it("the SkipLink targets the main-content landmark and is a plain in-page anchor", () => {
    const skip = read("src/components/ui/skip-link.tsx");
    expect(skip).toContain("mainContentHref");
    // Hidden until focused (sr-only → focus:not-sr-only), the standard pattern.
    expect(skip).toContain("sr-only");
    expect(skip).toContain("focus:not-sr-only");
  });

  it("every <main> in the app carries the shared MAIN_CONTENT_ID", () => {
    // The pages/layouts that render a <main> landmark.
    const mainFiles = [
      "src/app/page.tsx",
      "src/app/(auth)/layout.tsx",
      "src/app/(dashboard)/layout.tsx",
      "src/app/onboarding/page.tsx",
      "src/app/invite/[token]/page.tsx",
    ];
    for (const rel of mainFiles) {
      const src = read(rel);
      const mains = (src.match(/<main\b/g) ?? []).length;
      const tagged = (src.match(/id=\{MAIN_CONTENT_ID\}/g) ?? []).length;
      expect(mains, `${rel} should render exactly one <main>`).toBe(1);
      expect(tagged, `${rel}'s <main> must carry id={MAIN_CONTENT_ID}`).toBe(1);
      expect(src).toContain('from "@/lib/ui/a11y"');
    }
  });
});
