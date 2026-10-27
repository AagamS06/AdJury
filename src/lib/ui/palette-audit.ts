/**
 * Palette audit (DailyPlan Day 60 — Full visual pass).
 *
 * "Apply Design.md tokens consistently across the app.
 *  DoD: consistent look; no off-palette colors."
 *
 * The visual-pass sibling of the Week-7 audits (`secrets-audit`, `rls-audit`,
 * `authz-audit`): a pure, node-testable scanner that proves an app-wide
 * invariant from the real source, with no Next build, no bundler, and no
 * credential. Here the invariant is Design.md §2's palette — every colour the
 * UI paints comes from a named design token, never an off-palette literal — so
 * "no off-palette colors" becomes an executable, regression-proof check instead
 * of a one-time eyeball pass.
 *
 * It flags four kinds of off-palette colour in the component/app source:
 *
 *  1. DEFAULT TAILWIND SCALES (`findDefaultScaleColors`) — a colour utility built
 *     on one of Tailwind's stock families (`bg-slate-500`, `text-blue-600`,
 *     `border-gray-200`, …). None of these are in `tailwind.config.ts`; reaching
 *     for one is the most common way an off-palette colour creeps in.
 *
 *  2. THE BARE `black` KEYWORD (`findBareKeywordColors`) — `text-black` / `bg-black`
 *     paint true `#000`, but Design.md's black is the `ink` token (`#0B0B0F`).
 *     `white` is a real Design.md token (White, `#FFFFFF`) and is allowed; black
 *     is not.
 *
 *  3. ARBITRARY COLOUR VALUES (`findArbitraryColorValues`) — a Tailwind arbitrary
 *     value whose contents are a colour literal (`bg-[#1e40af]`,
 *     `text-[rgb(10,20,30)]`, `shadow-[0_1px_2px_rgba(0,0,0,.1)]`). A non-colour
 *     arbitrary value (`z-[100]`, `w-[72ch]`, `grid-cols-[1fr_auto]`) is fine and
 *     is NOT flagged — elevation now lives in the `shadow-card` / `shadow-elevated`
 *     tokens (Design.md §4), so a raw `rgba(…)` shadow is off-palette too.
 *
 *  4. RAW HEX LITERALS (`findRawHexLiterals`) — a `#rgb` / `#rrggbb` (/ `#rgba` /
 *     `#rrggbbaa`) literal anywhere in a scanned file's code (comments stripped),
 *     e.g. a hardcoded colour in an inline `style` or a string constant. The two
 *     files that legitimately define the palette in hex — the a11y contrast
 *     source (`lib/ui/a11y.ts`) and the PDF renderer that needs raw colours
 *     (`lib/reviews/pdf-export.ts`) — plus this module, are exempt
 *     (`PALETTE_SOURCE_FILES`); everywhere else, colour must come from a token.
 *
 * The allowed token names (`ALLOWED_COLOR_TOKENS`) mirror the colour keys in
 * `tailwind.config.ts` (Design.md §2); a drift test pins the two together so a
 * token added to the config is reflected here and a typo'd token name is still
 * caught as off-palette.
 */

// ── Allowed tokens ───────────────────────────────────────────────────────────

/**
 * The design-token colour names a utility may use — the colour keys declared in
 * `tailwind.config.ts`, expanded to the utility spellings Tailwind generates for
 * a nested scale (`royal` → `royal`, `royal-bright`). Mirrors Design.md §2.
 */
export const DESIGN_TOKEN_COLORS: readonly string[] = [
  "navy",
  "royal",
  "royal-bright",
  "burgundy",
  "burgundy-bright",
  "ink",
  "surface",
  "canvas",
  "border",
  "muted",
  "body",
  "success",
  "success-deep",
  "warning",
  "warning-deep",
  "danger",
];

/**
 * Tailwind keyword colours that carry no hue of their own and are always safe:
 * `white` is the Design.md White token (`#FFFFFF`), and `transparent` / `current`
 * / `inherit` resolve to no fixed colour. `black` is deliberately absent — it is
 * off-palette (use the `ink` token).
 */
export const SAFE_KEYWORD_COLORS: readonly string[] = [
  "white",
  "transparent",
  "current",
  "inherit",
];

/** Every colour token a utility is allowed to reference. */
export const ALLOWED_COLOR_TOKENS: ReadonlySet<string> = new Set([
  ...DESIGN_TOKEN_COLORS,
  ...SAFE_KEYWORD_COLORS,
]);

/**
 * Tailwind's stock colour families (the default palette). The app ships none of
 * these in its config, so any utility built on one is off-palette by definition.
 */
export const DEFAULT_TAILWIND_SCALES: readonly string[] = [
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
];

/**
 * Utility prefixes that take a colour. Used to anchor the scans so a non-colour
 * utility that happens to share a word (`border-2`, `text-sm`, `from-0%`) is not
 * mistaken for a colour. `border-l` / `ring-offset` style compound prefixes are
 * covered because the regexes allow an optional `-<side>` segment.
 */
export const COLOR_UTILITY_PREFIXES: readonly string[] = [
  "bg",
  "text",
  "border",
  "ring",
  "ring-offset",
  "divide",
  "outline",
  "fill",
  "stroke",
  "from",
  "to",
  "via",
  "placeholder",
  "caret",
  "accent",
  "decoration",
  "shadow",
];

/**
 * Files that legitimately contain raw palette hex (they ARE the palette source)
 * and are exempt from the raw-hex scan. Repo-relative, POSIX separators.
 */
export const PALETTE_SOURCE_FILES: readonly string[] = [
  "src/lib/ui/a11y.ts",
  "src/lib/reviews/pdf-export.ts",
  "src/lib/ui/palette-audit.ts",
];

// ── Comment stripping (preserves line numbers) ───────────────────────────────

/**
 * Replace the contents of line and block comments with spaces while preserving
 * every newline, so a colour-shaped token in a comment (e.g. a hex documented in
 * a docstring) can't trip a scan, yet reported line numbers still match the
 * original file. String and template literals are tracked so a `//` inside a URL
 * string (`"https://…"`) is not mistaken for a comment.
 */
export function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  // Current string/template delimiter, or null when not inside one.
  let quote: string | null = null;

  while (i < n) {
    const ch = src[i];
    const next = i + 1 < n ? src[i + 1] : "";

    if (quote) {
      if (ch === "\\") {
        // Keep an escape pair intact (newlines preserved as-is regardless).
        out += ch + (next || "");
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === "/" && next === "/") {
      // Line comment: blank to end of line, keep the newline.
      i += 2;
      while (i < n && src[i] !== "\n") i += 1;
      continue;
    }

    if (ch === "/" && next === "*") {
      // Block comment: blank its body but keep each newline it spanned.
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") out += "\n";
        i += 1;
      }
      i += 2; // skip the closing */
      continue;
    }

    out += ch;
    i += 1;
  }
  return out;
}

// ── Finding model ────────────────────────────────────────────────────────────

export type PaletteFindingKind =
  | "default-scale"
  | "bare-black"
  | "arbitrary-color"
  | "raw-hex";

export interface PaletteFinding {
  /** Repo-relative path, POSIX separators. */
  path: string;
  /** 1-based line number of the match. */
  line: number;
  kind: PaletteFindingKind;
  /** The exact off-palette text matched (e.g. `bg-slate-500`, `#1e40af`). */
  match: string;
}

/** A source file to scan. */
export interface SourceModule {
  /** Repo-relative path, POSIX separators. */
  path: string;
  src: string;
}

/** 1-based line number of a character offset within `text`. */
function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

const PREFIX_ALT = COLOR_UTILITY_PREFIXES.slice()
  // Longest first so `ring-offset` is tried before `ring`.
  .sort((a, b) => b.length - a.length)
  .join("|");

const SCALE_ALT = DEFAULT_TAILWIND_SCALES.join("|");

// A colour utility on a default Tailwind scale: an optional variant chain
// (`hover:`, `focus-visible:`, `dark:`, …), an optional side segment
// (`border-l`), the family, and a numeric shade. An optional `/NN` opacity tail
// is allowed but not captured.
const DEFAULT_SCALE_RE = new RegExp(
  `(?:[a-z0-9-]+:)*(?:${PREFIX_ALT})(?:-[trblxyse])?-(?:${SCALE_ALT})-\\d{1,3}(?:/\\d{1,3})?`,
  "g",
);

// The bare `black` keyword used as a colour (`text-black`, `focus:bg-black/50`).
const BARE_BLACK_RE = new RegExp(
  `(?:[a-z0-9-]+:)*(?:${PREFIX_ALT})(?:-[trblxyse])?-black(?:/\\d{1,3})?\\b`,
  "g",
);

// An arbitrary value `prefix-[...]`; the body is inspected for a colour literal.
const ARBITRARY_VALUE_RE = new RegExp(
  `(?:[a-z0-9-]+:)*(?:${PREFIX_ALT})(?:-[trblxyse])?-\\[([^\\]]*)\\]`,
  "g",
);

// A colour literal inside an arbitrary value (hex / rgb / hsl, any case). No
// word boundary before the function names: Tailwind arbitrary values join tokens
// with underscores (`0_1px_2px_rgba(…)`), so `rgba` is often preceded by `_`.
const COLOR_LITERAL_RE = /#[0-9a-fA-F]{3,8}\b|(?:rgb|rgba|hsl|hsla)\(/;

// A standalone hex colour literal in code (3/4/6/8 digits).
const RAW_HEX_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;

/** Off-palette utilities built on a default Tailwind colour scale. */
export function findDefaultScaleColors(mod: SourceModule): PaletteFinding[] {
  const clean = stripComments(mod.src);
  const out: PaletteFinding[] = [];
  for (const m of clean.matchAll(DEFAULT_SCALE_RE)) {
    out.push({
      path: mod.path,
      line: lineAt(clean, m.index ?? 0),
      kind: "default-scale",
      match: m[0],
    });
  }
  return out;
}

/** Colour utilities using the bare `black` keyword (should be `ink`). */
export function findBareKeywordColors(mod: SourceModule): PaletteFinding[] {
  const clean = stripComments(mod.src);
  const out: PaletteFinding[] = [];
  for (const m of clean.matchAll(BARE_BLACK_RE)) {
    out.push({
      path: mod.path,
      line: lineAt(clean, m.index ?? 0),
      kind: "bare-black",
      match: m[0],
    });
  }
  return out;
}

/** Arbitrary-value utilities whose contents are a colour literal. */
export function findArbitraryColorValues(mod: SourceModule): PaletteFinding[] {
  const clean = stripComments(mod.src);
  const out: PaletteFinding[] = [];
  for (const m of clean.matchAll(ARBITRARY_VALUE_RE)) {
    const body = m[1];
    if (COLOR_LITERAL_RE.test(body)) {
      out.push({
        path: mod.path,
        line: lineAt(clean, m.index ?? 0),
        kind: "arbitrary-color",
        match: m[0],
      });
    }
  }
  return out;
}

/**
 * Raw hex colour literals in code (comments stripped). Skipped for the palette
 * source files, which legitimately define the tokens in hex. Hex that is part of
 * an arbitrary-value utility is reported by `findArbitraryColorValues`; to avoid
 * double-reporting the same offset, such matches are left to that scan.
 */
export function findRawHexLiterals(mod: SourceModule): PaletteFinding[] {
  if (PALETTE_SOURCE_FILES.includes(mod.path)) return [];
  const clean = stripComments(mod.src);

  // Offsets already covered by an arbitrary-value colour match, so a
  // `shadow-[…#fff…]` is reported once (as `arbitrary-color`), not twice.
  const covered: Array<[number, number]> = [];
  for (const m of clean.matchAll(ARBITRARY_VALUE_RE)) {
    const start = m.index ?? 0;
    covered.push([start, start + m[0].length]);
  }
  const isCovered = (idx: number) =>
    covered.some(([s, e]) => idx >= s && idx < e);

  const out: PaletteFinding[] = [];
  for (const m of clean.matchAll(RAW_HEX_RE)) {
    const idx = m.index ?? 0;
    if (isCovered(idx)) continue;
    out.push({
      path: mod.path,
      line: lineAt(clean, idx),
      kind: "raw-hex",
      match: m[0],
    });
  }
  return out;
}

/** Every off-palette finding in one module, in source order. */
export function auditModule(mod: SourceModule): PaletteFinding[] {
  return [
    ...findDefaultScaleColors(mod),
    ...findBareKeywordColors(mod),
    ...findArbitraryColorValues(mod),
    ...findRawHexLiterals(mod),
  ].sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
}

export interface PaletteAudit {
  /** True when no module has any off-palette colour. */
  clean: boolean;
  findings: PaletteFinding[];
}

/**
 * Audit a set of modules. A clean result — `findings: []` — is the executable
 * form of the Day 60 DoD: every colour in the app comes from a Design.md token.
 */
export function auditPalette(modules: readonly SourceModule[]): PaletteAudit {
  const findings = modules
    .flatMap((m) => auditModule(m))
    .sort(
      (a, b) =>
        a.path.localeCompare(b.path) ||
        a.line - b.line ||
        a.kind.localeCompare(b.kind),
    );
  return { clean: findings.length === 0, findings };
}
