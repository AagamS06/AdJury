import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DESIGN_TOKEN_COLORS,
  SAFE_KEYWORD_COLORS,
  ALLOWED_COLOR_TOKENS,
  DEFAULT_TAILWIND_SCALES,
  COLOR_UTILITY_PREFIXES,
  PALETTE_SOURCE_FILES,
  stripComments,
  findDefaultScaleColors,
  findBareKeywordColors,
  findArbitraryColorValues,
  findRawHexLiterals,
  auditModule,
  auditPalette,
  type SourceModule,
} from "@/lib/ui/palette-audit";

/**
 * Palette audit (DailyPlan Day 60 — Full visual pass).
 *
 * "Apply Design.md tokens consistently across the app.
 *  DoD: consistent look; no off-palette colors."
 *
 * Part 1 runs the audit over the REAL repo source and proves it is clean — the
 * executable form of the DoD. Part 2 proves each scanner genuinely catches a
 * planted off-palette colour (otherwise a clean repo proves nothing). Part 3 is
 * the drift guard: the allowed token names match `tailwind.config.ts`, and the
 * Day-60 elevation tokens (`shadow-card` / `shadow-elevated`, Design.md §4) are
 * defined and used in place of the old arbitrary `rgba(…)` shadows.
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

// ── 1. The real repo is palette-clean ────────────────────────────────────────

describe("palette audit — the app uses only Design.md tokens", () => {
  const modules = loadSrcModules();

  it("finds no off-palette colours anywhere under src/", () => {
    const audit = auditPalette(modules);
    const report = audit.findings
      .map((f) => `  ${f.path}:${f.line} [${f.kind}] ${f.match}`)
      .join("\n");
    expect(audit.clean, `off-palette colours found:\n${report}`).toBe(true);
  });

  it("actually scanned a meaningful number of modules", () => {
    // Guards against a silently-empty walk making the clean result vacuous.
    expect(modules.length).toBeGreaterThan(80);
  });
});

// ── 2. The scanners catch planted violations ─────────────────────────────────

describe("palette audit — scanners catch off-palette colour", () => {
  const mod = (src: string): SourceModule => ({ path: "src/x.tsx", src });

  it("flags a default Tailwind scale colour", () => {
    const found = findDefaultScaleColors(
      mod('<div className="bg-slate-500 text-blue-600 border-gray-200" />'),
    );
    expect(found.map((f) => f.match)).toEqual([
      "bg-slate-500",
      "text-blue-600",
      "border-gray-200",
    ]);
    expect(found.every((f) => f.kind === "default-scale")).toBe(true);
  });

  it("flags a scale colour behind a variant chain and side segment", () => {
    const found = findDefaultScaleColors(
      mod('<div className="hover:focus-visible:bg-red-500/40 border-l-green-700" />'),
    );
    expect(found.map((f) => f.match)).toEqual([
      "hover:focus-visible:bg-red-500/40",
      "border-l-green-700",
    ]);
  });

  it("flags the bare black keyword but allows white", () => {
    const found = findBareKeywordColors(
      mod('<div className="text-black bg-white focus:bg-black/50" />'),
    );
    expect(found.map((f) => f.match)).toEqual(["text-black", "focus:bg-black/50"]);
  });

  it("flags an arbitrary colour value but not a non-colour arbitrary value", () => {
    const found = findArbitraryColorValues(
      mod(
        '<div className="bg-[#1e40af] text-[rgb(10,20,30)] shadow-[0_1px_2px_rgba(0,0,0,.1)] z-[100] w-[72ch]" />',
      ),
    );
    expect(found.map((f) => f.match)).toEqual([
      "bg-[#1e40af]",
      "text-[rgb(10,20,30)]",
      "shadow-[0_1px_2px_rgba(0,0,0,.1)]",
    ]);
    // z-[100] and w-[72ch] carry no colour → not flagged.
  });

  it("flags a raw hex literal in code", () => {
    const found = findRawHexLiterals(
      mod('const brand = "#0A1F44"; const c = "#fff";'),
    );
    expect(found.map((f) => f.match)).toEqual(["#0A1F44", "#fff"]);
    expect(found.every((f) => f.kind === "raw-hex")).toBe(true);
  });

  it("does not double-report a hex inside an arbitrary-value utility", () => {
    const src = '<div className="shadow-[0_0_0_#abcabc]" />';
    const raw = findRawHexLiterals(mod(src));
    const arb = findArbitraryColorValues(mod(src));
    expect(raw).toEqual([]); // covered by the arbitrary-colour scan instead
    expect(arb).toHaveLength(1);
  });

  it("exempts the palette source files from the raw-hex scan", () => {
    for (const path of PALETTE_SOURCE_FILES) {
      const found = findRawHexLiterals({ path, src: 'const x = "#0A1F44";' });
      expect(found, `${path} should be exempt`).toEqual([]);
    }
    // A non-exempt file with the same content IS flagged.
    expect(
      findRawHexLiterals({ path: "src/components/x.tsx", src: 'const x = "#0A1F44";' }),
    ).toHaveLength(1);
  });

  it("auditModule reports a planted violation with its real line number", () => {
    const src = ["line one", "line two", 'className="bg-slate-50"', "line four"].join(
      "\n",
    );
    const found = auditModule({ path: "src/y.tsx", src });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "default-scale", line: 3, match: "bg-slate-50" });
  });
});

// ── 3. Comment stripping (no false positives, line numbers preserved) ─────────

describe("stripComments", () => {
  it("blanks a colour-shaped token in a line comment but keeps the line count", () => {
    const src = ["const a = 1; // bg-slate-500 and #ff0000", "const b = 2;"].join("\n");
    const clean = stripComments(src);
    expect(findDefaultScaleColors({ path: "src/x.ts", src })).toEqual([]);
    expect(findRawHexLiterals({ path: "src/x.ts", src })).toEqual([]);
    expect(clean.split("\n")).toHaveLength(2);
  });

  it("blanks a block comment but preserves the newlines it spanned", () => {
    const src = ["before", "/* #abcdef", "bg-red-500 */", "text-black"].join("\n");
    const clean = stripComments(src);
    expect(clean.split("\n")).toHaveLength(4);
    // The real violation on the last line is still found, at line 4.
    const found = findBareKeywordColors({ path: "src/x.tsx", src });
    expect(found).toEqual([
      expect.objectContaining({ match: "text-black", line: 4 }),
    ]);
  });

  it("does not treat a // inside a string literal as a comment", () => {
    const src = 'const url = "https://example.com/#abc"; const real = "#abcdef";';
    // The URL fragment #abc is only 3 hex-ish chars but contains no real colour
    // intent; the real "#abcdef" string literal is still scanned (not a comment).
    const found = findRawHexLiterals({ path: "src/x.ts", src });
    expect(found.map((f) => f.match)).toContain("#abcdef");
  });
});

// ── 4. Drift guard vs tailwind.config.ts + Day-60 elevation tokens ────────────

describe("palette audit stays in sync with the design tokens", () => {
  const config = read("tailwind.config.ts");

  it("every design-token colour is declared as a colour key in the config", () => {
    // Base names (strip the `-bright`/`-deep` scale suffixes) must each appear as
    // a `key:` in the config's colours block.
    const bases = new Set(
      DESIGN_TOKEN_COLORS.map((t) => t.replace(/-(bright|deep)$/, "")),
    );
    for (const base of bases) {
      const key = new RegExp(`\\b${base}:\\s*[{"']`);
      expect(key.test(config), `tailwind.config.ts missing colour key '${base}'`).toBe(
        true,
      );
    }
  });

  it("black is off-palette (not an allowed token) but white is allowed", () => {
    expect(ALLOWED_COLOR_TOKENS.has("white")).toBe(true);
    expect(ALLOWED_COLOR_TOKENS.has("black")).toBe(false);
    expect(SAFE_KEYWORD_COLORS).not.toContain("black");
  });

  it("the config declares no default Tailwind scale as a custom token", () => {
    // None of DEFAULT_TAILWIND_SCALES should be shadowed into the palette (that
    // would make an off-palette family suddenly 'valid').
    for (const scale of DEFAULT_TAILWIND_SCALES) {
      expect(ALLOWED_COLOR_TOKENS.has(scale), `${scale} must stay off-palette`).toBe(
        false,
      );
    }
  });

  it("defines the Day-60 elevation tokens (Design.md §4)", () => {
    expect(/boxShadow:\s*{/.test(config)).toBe(true);
    expect(/card:\s*["']0 1px 2px rgba\(11,11,15,\.06\)["']/.test(config)).toBe(true);
    expect(/elevated:\s*["']0 4px 12px rgba\(11,11,15,\.10\)["']/.test(config)).toBe(
      true,
    );
  });

  it("the app uses the elevation tokens, not arbitrary rgba shadows", () => {
    const modules = loadSrcModules();
    const usesCard = modules.some((m) => /\bshadow-card\b/.test(m.src));
    const usesElevated = modules.some((m) => /\bshadow-elevated\b/.test(m.src));
    expect(usesCard, "shadow-card should be in use").toBe(true);
    expect(usesElevated, "shadow-elevated should be in use").toBe(true);
    // No leftover arbitrary rgba shadow anywhere (the palette-audit module itself
    // documents the old pattern in prose, so it is exempt from this raw scan).
    const arbitraryShadow = modules.filter(
      (m) =>
        !PALETTE_SOURCE_FILES.includes(m.path) && /shadow-\[[^\]]*rgba/.test(m.src),
    );
    expect(arbitraryShadow.map((m) => m.path)).toEqual([]);
  });
});

// ── 5. Constants are well-formed ─────────────────────────────────────────────

describe("palette audit constants", () => {
  it("prefixes and scales are non-empty and lower-case", () => {
    expect(COLOR_UTILITY_PREFIXES.length).toBeGreaterThan(5);
    expect(DEFAULT_TAILWIND_SCALES.length).toBeGreaterThan(15);
    for (const p of [...COLOR_UTILITY_PREFIXES, ...DEFAULT_TAILWIND_SCALES]) {
      expect(p).toMatch(/^[a-z-]+$/);
    }
  });

  it("allowed tokens are the design tokens plus the safe keywords", () => {
    expect(ALLOWED_COLOR_TOKENS.size).toBe(
      DESIGN_TOKEN_COLORS.length + SAFE_KEYWORD_COLORS.length,
    );
  });
});
