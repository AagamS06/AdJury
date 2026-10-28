import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  MOBILE_SAFE_WIDTH_PX,
  REM_IN_PX,
  RESPONSIVE_BREAKPOINTS,
  absoluteWidthPx,
  variantSegments,
  hasResponsiveBreakpoint,
  findFixedOverflowWidths,
  findNonResponsiveGrids,
  auditModule,
  auditResponsive,
  type SourceModule,
} from "@/lib/ui/responsive-audit";

/**
 * Responsive audit (DailyPlan Day 61 — Responsive pass).
 *
 * "Mobile/tablet/desktop layouts.
 *  DoD: no horizontal overflow; usable at all widths."
 *
 * Part 1 runs the audit over the REAL repo source and proves it is clean — the
 * executable form of the DoD (nothing forces horizontal overflow at phone
 * width). Part 2 proves each scanner genuinely catches a planted overflow hazard
 * (otherwise a clean repo proves nothing) and ignores the responsive patterns
 * the app actually uses. Part 3 locks in the Day-61 content-wrapping fix: the
 * free-form user/model text containers wrap long unbreakable tokens
 * (`break-words`) so a pasted URL or 40-char email can't push the page wide.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(`${repoRoot}${rel}`, "utf8");

/** Recursively collect every .ts/.tsx under src/, path repo-relative (POSIX). */
function loadSrcModules(): SourceModule[] {
  const out: SourceModule[] = [];
  function walk(absDir: string, rel: string): void {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const abs = `${absDir}/${entry.name}`;
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(abs, childRel);
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        out.push({ path: childRel, src: readFileSync(abs, "utf8") });
      }
    }
  }
  walk(`${repoRoot}src`, "src");
  return out;
}

// ── 1. The real repo is overflow-safe ────────────────────────────────────────

describe("responsive audit — no layout forces horizontal overflow on a phone", () => {
  const modules = loadSrcModules();

  it("finds no overflow hazards anywhere under src/", () => {
    const audit = auditResponsive(modules);
    const report = audit.findings
      .map((f) => `  ${f.path}:${f.line} [${f.kind}] ${f.match} — ${f.detail}`)
      .join("\n");
    expect(audit.clean, `responsive overflow hazards found:\n${report}`).toBe(
      true,
    );
  });

  it("actually scanned a meaningful number of modules", () => {
    // Guards against a silently-empty walk making the clean result vacuous.
    expect(modules.length).toBeGreaterThan(80);
  });
});

// ── 2. The scanners catch hazards and allow the responsive patterns ───────────

describe("responsive audit — fixed-width scanner", () => {
  const mod = (src: string): SourceModule => ({ path: "src/x.tsx", src });

  it("flags a px width wider than the mobile safe width", () => {
    const found = findFixedOverflowWidths(
      mod('<div className="w-[640px] min-w-[480px] basis-[400px]" />'),
    );
    expect(found.map((f) => f.match)).toEqual([
      "w-[640px]",
      "min-w-[480px]",
      "basis-[400px]",
    ]);
    expect(found.every((f) => f.kind === "fixed-overflow-width")).toBe(true);
  });

  it("flags a rem width that resolves past the threshold", () => {
    // 24rem = 384px > 360.
    const found = findFixedOverflowWidths(mod('<div className="w-[24rem]" />'));
    expect(found.map((f) => f.match)).toEqual(["w-[24rem]"]);
    expect(found[0].detail).toContain("384px");
  });

  it("does NOT flag a max-width (a cap only ever shrinks the box)", () => {
    expect(
      findFixedOverflowWidths(mod('<div className="max-w-[1200px]" />')),
    ).toEqual([]);
  });

  it("does NOT flag relative/viewport/content widths or small fixed widths", () => {
    const found = findFixedOverflowWidths(
      mod(
        '<div className="w-[100%] w-[50vw] w-[72ch] w-[200px] min-w-[360px] basis-[calc(50%-1rem)]" />',
      ),
    );
    // 200px and exactly 360px are within the safe width; the rest are relative.
    expect(found).toEqual([]);
  });

  it("flags a fixed width behind a variant chain", () => {
    const found = findFixedOverflowWidths(
      mod('<div className="lg:w-[800px]" />'),
    );
    expect(found.map((f) => f.match)).toEqual(["lg:w-[800px]"]);
  });
});

describe("responsive audit — multi-column grid scanner", () => {
  const mod = (src: string): SourceModule => ({ path: "src/x.tsx", src });

  it("flags a bare multi-column grid with no breakpoint", () => {
    const found = findNonResponsiveGrids(
      mod('<div className="grid grid-cols-2" />'),
    );
    expect(found.map((f) => f.match)).toEqual(["grid-cols-2"]);
    expect(found[0].kind).toBe("non-responsive-grid");
    expect(found[0].detail).toContain("sm:grid-cols-2");
  });

  it("flags a multi-column grid gated only by a non-breakpoint variant", () => {
    const found = findNonResponsiveGrids(
      mod('<div className="hover:grid-cols-3" />'),
    );
    expect(found.map((f) => f.match)).toEqual(["hover:grid-cols-3"]);
  });

  it("does NOT flag the app's responsive-gated grids", () => {
    const found = findNonResponsiveGrids(
      mod(
        '<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" />',
      ),
    );
    expect(found).toEqual([]);
  });

  it("does NOT flag a single-column grid", () => {
    expect(
      findNonResponsiveGrids(mod('<div className="grid grid-cols-1" />')),
    ).toEqual([]);
  });
});

describe("responsive audit — comment stripping + line numbers", () => {
  it("ignores a class-shaped token in a comment but reports a real one's line", () => {
    const src = [
      "line one",
      "// grid-cols-2 and w-[640px] in a comment are not real",
      'className="grid-cols-2"',
    ].join("\n");
    const found = auditModule({ path: "src/y.tsx", src });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: "non-responsive-grid",
      line: 3,
      match: "grid-cols-2",
    });
  });
});

// ── 3. The Day-61 content-wrapping fix is in place ────────────────────────────

describe("responsive audit — free-form content wraps long tokens", () => {
  // The containers that render verbatim user/model strings (summaries, issue
  // excerpts/explanations, suggested rewrites, the before/after diff) must carry
  // `break-words` so a pasted URL or other unbreakable token wraps instead of
  // widening the page. These are the overflow vectors a layout scan can't see.
  it("the juror card wraps its summary, excerpt and explanation", () => {
    const src = read("/src/components/review/juror-card.tsx");
    // Every <p> that prints juror.summary / issue.excerpt / issue.explanation
    // should be break-words; count them to be sure none was missed.
    const breakParas = src.match(/className="[^"]*\bbreak-words\b[^"]*"/g) ?? [];
    expect(breakParas.length).toBeGreaterThanOrEqual(3);
  });

  it("the rewrite panel wraps the rewrite and the before/after diff text", () => {
    const src = read("/src/components/review/rewrite-panel.tsx");
    const breakParas = src.match(/className="[^"]*\bbreak-words\b[^"]*"/g) ?? [];
    // The rewrite line + the diff block + both plain-compare blocks.
    expect(breakParas.length).toBeGreaterThanOrEqual(4);
    // The preformatted diff/plain views keep their newlines AND break long words.
    expect(src).toContain("whitespace-pre-wrap break-words");
  });
});

// ── 4. Constants are well-formed ──────────────────────────────────────────────

describe("responsive audit — helpers and constants", () => {
  it("absoluteWidthPx resolves px/rem and rejects relative units", () => {
    expect(absoluteWidthPx("480px")).toBe(480);
    expect(absoluteWidthPx("24rem")).toBe(24 * REM_IN_PX);
    expect(absoluteWidthPx("50%")).toBeNull();
    expect(absoluteWidthPx("100vw")).toBeNull();
    expect(absoluteWidthPx("auto")).toBeNull();
    expect(absoluteWidthPx("calc(100%-2rem)")).toBeNull();
  });

  it("variantSegments splits a chain and hasResponsiveBreakpoint detects one", () => {
    expect(variantSegments("lg:hover:")).toEqual(["lg", "hover"]);
    expect(variantSegments("")).toEqual([]);
    expect(hasResponsiveBreakpoint("sm:")).toBe(true);
    expect(hasResponsiveBreakpoint("2xl:focus:")).toBe(true);
    expect(hasResponsiveBreakpoint("hover:")).toBe(false);
    expect(hasResponsiveBreakpoint("")).toBe(false);
  });

  it("the thresholds and breakpoints are sane", () => {
    expect(MOBILE_SAFE_WIDTH_PX).toBeGreaterThanOrEqual(320);
    expect(REM_IN_PX).toBe(16);
    expect(RESPONSIVE_BREAKPOINTS).toContain("sm");
    expect(RESPONSIVE_BREAKPOINTS).toContain("2xl");
    for (const bp of RESPONSIVE_BREAKPOINTS) {
      expect(bp).toMatch(/^[a-z0-9]+$/);
    }
  });
});
