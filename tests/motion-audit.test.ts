import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  stripCssComments,
  variantSegments,
  noPreferenceRanges,
  referencesNoPreferenceQuery,
  findUngatedAnimateUtilities,
  findBroadTransitions,
  findUngatedCssAnimations,
  auditModule,
  auditMotion,
  type SourceModule,
} from "@/lib/ui/motion-audit";

/**
 * Motion audit (DailyPlan Day 64 — Micro-interactions).
 *
 * "Transitions/animations (respect `prefers-reduced-motion`).
 *  DoD: subtle, functional motion only."
 *
 * Part 1 runs the audit over the REAL repo source (.ts/.tsx + .css) and proves
 * it is clean — the executable form of the DoD (no ungated animation, no broad
 * transition). Part 2 proves each scanner genuinely catches a planted hazard
 * (otherwise a clean repo proves nothing) and allows the patterns the app
 * actually uses. Part 3 pins comment-stripping + line numbers. Part 4 checks the
 * CSS no-preference range matcher the gating scanner relies on.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/** Recursively collect every .ts/.tsx/.css under src/, path repo-relative. */
function loadSrcModules(): SourceModule[] {
  const out: SourceModule[] = [];
  function walk(absDir: string, rel: string): void {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const abs = `${absDir}/${entry.name}`;
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(abs, childRel);
      } else if (/\.(ts|tsx|css)$/.test(entry.name)) {
        out.push({ path: childRel, src: readFileSync(abs, "utf8") });
      }
    }
  }
  walk(`${repoRoot}src`, "src");
  return out;
}

// ── 1. The real repo has no motion hazards ────────────────────────────────────

describe("motion audit — the app's motion is gated and scoped", () => {
  const modules = loadSrcModules();

  it("finds no motion hazards anywhere under src/", () => {
    const audit = auditMotion(modules);
    const report = audit.findings
      .map((f) => `  ${f.path}:${f.line} [${f.kind}] ${f.match} — ${f.detail}`)
      .join("\n");
    expect(audit.clean, `motion hazards found:\n${report}`).toBe(true);
  });

  it("actually scanned a meaningful number of modules (incl. the CSS)", () => {
    expect(modules.length).toBeGreaterThan(80);
    expect(modules.some((m) => m.path.endsWith(".css"))).toBe(true);
  });

  it("the real motion the app does ship is present and correctly gated", () => {
    // The skeleton pulse and the toast enter are both motion-safe:-gated, so
    // the clean result above isn't vacuous (there IS animation to gate).
    const skeleton = modules.find((m) => m.path.endsWith("skeleton.tsx"));
    const toast = modules.find((m) => m.path.endsWith("ui/toast.tsx"));
    expect(skeleton?.src).toContain("motion-safe:animate-pulse");
    expect(toast?.src).toContain("motion-safe:animate-toast-in");
  });
});

// ── 2. Scanners catch planted hazards and allow the real patterns ─────────────

describe("motion audit — ungated animate scanner", () => {
  const mod = (src: string): SourceModule => ({ path: "src/x.tsx", src });

  it("flags an animate-* utility with no motion-safe gate", () => {
    const found = findUngatedAnimateUtilities(
      mod('<span className="animate-spin animate-pulse" />'),
    );
    expect(found.map((f) => f.match)).toEqual(["animate-spin", "animate-pulse"]);
    expect(found.every((f) => f.kind === "ungated-animate")).toBe(true);
  });

  it("does NOT flag a motion-safe:-gated animation", () => {
    expect(
      findUngatedAnimateUtilities(
        mod('<span className="motion-safe:animate-pulse" />'),
      ),
    ).toEqual([]);
  });

  it("does NOT flag animate-none (disabling animation is always safe)", () => {
    expect(
      findUngatedAnimateUtilities(mod('<span className="animate-none" />')),
    ).toEqual([]);
  });

  it("still flags an animation gated only by a non-motion variant", () => {
    const found = findUngatedAnimateUtilities(
      mod('<span className="hover:animate-bounce" />'),
    );
    expect(found.map((f) => f.match)).toEqual(["hover:animate-bounce"]);
  });

  it("scans .ts class-helper files too, not just .tsx", () => {
    const found = findUngatedAnimateUtilities({
      path: "src/components/ui/toast-classes.ts",
      src: 'export const x = "animate-ping";',
    });
    expect(found.map((f) => f.match)).toEqual(["animate-ping"]);
  });
});

describe("motion audit — broad-transition scanner", () => {
  it("flags a Tailwind transition-all utility", () => {
    const found = findBroadTransitions({
      path: "src/x.tsx",
      src: '<div className="transition-all hover:transition-all" />',
    });
    expect(found.map((f) => f.match)).toEqual([
      "transition-all",
      "hover:transition-all",
    ]);
    expect(found.every((f) => f.kind === "broad-transition")).toBe(true);
  });

  it("does NOT flag a scoped transition (transition-colors)", () => {
    expect(
      findBroadTransitions({
        path: "src/x.tsx",
        src: '<div className="transition-colors transition-transform" />',
      }),
    ).toEqual([]);
  });

  it("flags a CSS `transition: … all …` declaration", () => {
    const found = findBroadTransitions({
      path: "src/app/globals.css",
      src: ".x { transition: all 150ms ease-out; }",
    });
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe("broad-transition");
  });

  it("does NOT flag the reduced-motion reset's transition-duration longhand", () => {
    const reset =
      "@media (prefers-reduced-motion: reduce){*{transition-duration:0.01ms !important;}}";
    expect(
      findBroadTransitions({ path: "src/app/globals.css", src: reset }),
    ).toEqual([]);
  });
});

describe("motion audit — ungated CSS animation scanner", () => {
  it("flags a raw CSS animation assigned outside a no-preference guard", () => {
    const css = ".toast { animation: toast-in 150ms ease-out; }";
    const found = findUngatedCssAnimations({ path: "src/app/globals.css", src: css });
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe("ungated-css-animation");
    expect(found[0].match).toBe("animation");
  });

  it("does NOT flag an animation inside a no-preference media block", () => {
    const css =
      "@media (prefers-reduced-motion: no-preference) { .toast { animation: toast-in 150ms ease-out; } }";
    expect(
      findUngatedCssAnimations({ path: "src/app/globals.css", src: css }),
    ).toEqual([]);
  });

  it("does NOT flag the reduced-motion reset longhands (they neutralise, not assign)", () => {
    const reset = [
      "@media (prefers-reduced-motion: reduce) {",
      "  * {",
      "    animation-duration: 0.01ms !important;",
      "    animation-iteration-count: 1 !important;",
      "    transition-duration: 0.01ms !important;",
      "  }",
      "}",
    ].join("\n");
    expect(
      findUngatedCssAnimations({ path: "src/app/globals.css", src: reset }),
    ).toEqual([]);
  });

  it("flags animation-name assigned outside a guard", () => {
    const css = ".x { animation-name: spin; }";
    const found = findUngatedCssAnimations({ path: "src/app/globals.css", src: css });
    expect(found.map((f) => f.match)).toEqual(["animation-name"]);
  });
});

// ── 3. Comment stripping + line numbers ───────────────────────────────────────

describe("motion audit — comment stripping", () => {
  it("ignores a utility-shaped token in a .tsx comment but reports a real one's line", () => {
    const src = [
      "line one",
      "// animate-spin and transition-all in a comment are not real",
      'className="animate-spin"',
    ].join("\n");
    const found = auditModule({ path: "src/y.tsx", src });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: "ungated-animate",
      line: 3,
      match: "animate-spin",
    });
  });

  it("stripCssComments blanks a /* */ comment but keeps newlines", () => {
    const css = ".a {\n/* animation: x;\n spanning */\n color: red;\n}";
    const stripped = stripCssComments(css);
    expect(stripped).not.toContain("animation: x");
    // Line count preserved so reported line numbers stay accurate.
    expect(stripped.split("\n")).toHaveLength(css.split("\n").length);
  });

  it("does not flag a CSS animation that only appears in a comment", () => {
    const css = ".a {\n  /* animation: toast-in 150ms; (documented, not applied) */\n  color: red;\n}";
    expect(
      findUngatedCssAnimations({ path: "src/app/globals.css", src: css }),
    ).toEqual([]);
  });
});

// ── 4. The no-preference range matcher ────────────────────────────────────────

describe("motion audit — no-preference range matcher + helpers", () => {
  it("brace-matches the no-preference block, incl. nested braces", () => {
    const css =
      "a{}@media (prefers-reduced-motion: no-preference){.x{animation:y 1s}.z{color:red}}b{}";
    const ranges = noPreferenceRanges(css);
    expect(ranges).toHaveLength(1);
    const [start, end] = ranges[0];
    const block = css.slice(start, end);
    expect(block.startsWith("@media")).toBe(true);
    expect(block.endsWith("}")).toBe(true);
    // The whole media block (both nested rules) is inside the range.
    expect(block).toContain(".z{color:red}");
    // Content before/after the block is outside it.
    expect(start).toBeGreaterThan(0);
    expect(end).toBeLessThan(css.length);
  });

  it("referencesNoPreferenceQuery detects the query string", () => {
    expect(
      referencesNoPreferenceQuery(
        "@media (prefers-reduced-motion: no-preference){}",
      ),
    ).toBe(true);
    expect(referencesNoPreferenceQuery(".x{color:red}")).toBe(false);
  });

  it("variantSegments splits a chain and drops empties", () => {
    expect(variantSegments("motion-safe:hover:")).toEqual([
      "motion-safe",
      "hover",
    ]);
    expect(variantSegments("")).toEqual([]);
  });
});
