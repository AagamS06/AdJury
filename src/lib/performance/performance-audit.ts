/**
 * Performance audit (DailyPlan Day 67 — Performance pass).
 *
 * "Bundle, image, and query optimizations.
 *  DoD: measurable improvement; no regressions."
 *
 * The performance sibling of the Week 9–10 source-level audits (`palette-audit`,
 * `responsive-audit`, `semantics-audit`, `motion-audit`, `copy-audit`): a pure,
 * node-testable scanner that proves an app-wide performance invariant from the
 * real source — no Next build, no bundler, no credential. It turns "the app is
 * optimized" from a one-time eyeball pass into an executable, regression-proof
 * check over the three dimensions the day names:
 *
 *  1. BUNDLE (`findServerOnlyImportsInClient`) — a Client Component (a module with
 *     a top-of-file `"use client"` directive) must not **value-import** a
 *     server-only module. Pulling the DB layer (`@/lib/db/*`), the AI SDK/client
 *     (`@/lib/ai/*`, `@anthropic-ai/sdk`), a Supabase server/SSR client
 *     (`@supabase/ssr`, `@supabase/supabase-js`, `@/lib/auth/supabase-server`), a
 *     session/provisioning helper, `next/server`, `server-only`, or a Node
 *     built-in into a browser bundle bloats it (or breaks the build). A **type**
 *     import (`import type …`, or an all-`{ type X }` clause) is erased at compile
 *     time and is never flagged. A `"use server"` action module is the sanctioned
 *     client→server seam and is deliberately NOT on the server-only list.
 *
 *  2. IMAGE (`findUnoptimizedImages`) — a raw `<img>` tag in JSX (`.tsx`) ships the
 *     asset unoptimized: no automatic resize, lazy-load, or modern-format
 *     negotiation. Next.js's `next/image` does all three, so a raster/remote image
 *     belongs in `<Image>`. A `data:`-URI `<img>` (inline, nothing to optimize) and
 *     a spread-props `<img {...}>` (source resolved dynamically) are exempt; inline
 *     `<svg>` icons — which the app uses instead of `<img>` — are not `<img>` tags
 *     and are never flagged.
 *
 *  3. QUERY (`findUnboundedListReads`) — in the data-access layer (`src/lib/db/*`),
 *     an **ordered list read** (`.order(…)`) must be bounded by `.limit(…)` (or be
 *     a single-row `.single()`/`.maybeSingle()` read). An ordered read with no
 *     bound can fan out into an unbounded scan/transfer as a tenant's rows grow —
 *     the classic query-performance bug. Every list helper in `queries.ts` already
 *     carries an explicit cap (reviews 50, analytics/roster/invitations
 *     {@link ../db/queries#MAX_TENANT_LIST_SCAN}); this makes that discipline an
 *     enforced invariant.
 *
 * A clean result — `findings: []` — is the executable form of the Day 67 DoD:
 * the client bundle stays free of server-only code, images go through the
 * optimizer, and no tenant list read is unbounded; the test that plants each
 * hazard proves the scanners actually bite, so a clean repo is not vacuous.
 */

import { stripComments } from "@/lib/ui/palette-audit";

// ── Bundle: server-only import surface ─────────────────────────────────────────

/**
 * Internal module path prefixes (after the `@/` → `src/` alias) that are
 * server-only: the DB access layer, the AI SDK/client/orchestrator/personas, and
 * the Supabase-server / session / provisioning helpers. A Client Component that
 * value-imports any of these drags server code into the browser bundle. The list
 * is deliberately conservative (allow-by-omission): a `"use server"` action
 * module (`@/lib/auth/actions`) and the pure helpers a form legitimately shares
 * (`@/lib/validation/*`, `@/lib/reviews/scorecard-view`, …) are absent, so they
 * are never flagged.
 */
export const SERVER_ONLY_IMPORT_PREFIXES: readonly string[] = [
  "@/lib/db/",
  "@/lib/ai/",
  "@/lib/auth/supabase-server",
  "@/lib/auth/session",
  "@/lib/auth/provisioning",
];

/** npm packages that are server-only (clients, SDKs, server-runtime helpers). */
export const SERVER_ONLY_PACKAGES: readonly string[] = [
  "@anthropic-ai/sdk",
  "@supabase/ssr",
  "@supabase/supabase-js",
  "server-only",
  "next/server",
];

/** Node built-in modules (matched with or without the `node:` prefix). */
export const NODE_BUILTINS: readonly string[] = [
  "fs",
  "path",
  "crypto",
  "os",
  "child_process",
  "http",
  "https",
  "net",
  "tls",
  "stream",
  "zlib",
  "dns",
  "url",
  "util",
  "process",
  "buffer",
];

/** True when `specifier` names a server-only package, prefix, or Node built-in. */
export function isServerOnlySpecifier(specifier: string): boolean {
  if (SERVER_ONLY_PACKAGES.includes(specifier)) return true;
  if (SERVER_ONLY_IMPORT_PREFIXES.some((p) => specifier.startsWith(p))) {
    return true;
  }
  const bare = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
  return NODE_BUILTINS.includes(bare);
}

// ── Image: raw <img> tags ──────────────────────────────────────────────────────

// A `data:`-URI source (`src="data:…"` or `src={"data:…"}`) — inline, nothing for
// the optimizer to do, so an `<img>` carrying one is exempt.
const DATA_URI_SRC_RE = /src\s*=\s*(?:["']data:|\{\s*["']?data:)/;
// A spread-props `<img {...x}>` whose source is resolved dynamically — exempt.
const SPREAD_PROPS_RE = /\{\s*\.\.\./;

// ── Finding model ──────────────────────────────────────────────────────────────

export type PerformanceFindingKind =
  | "server-import-in-client"
  | "unoptimized-image"
  | "unbounded-list-read";

export interface PerformanceFinding {
  /** Repo-relative path, POSIX separators. */
  path: string;
  /** 1-based line number of the match. */
  line: number;
  kind: PerformanceFindingKind;
  /** The exact offending text (e.g. the module specifier, the `<img …>` tag). */
  match: string;
  /** Human-readable reason, naming the fix. */
  detail: string;
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
  const end = Math.min(index, text.length);
  for (let i = 0; i < end; i++) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

// ── Client-module detection ────────────────────────────────────────────────────

/**
 * True when `src` opens with a `"use client"` directive — a string literal
 * statement before any import/code (an optional leading block/line comment is
 * tolerated). Mirrors how Next.js recognizes a Client Component.
 */
export function isClientModule(src: string): boolean {
  // Strip a leading comment block, then require the first statement to be the
  // directive. Comments are blanked (not removed) so this stays line-cheap.
  const head = stripComments(src).trimStart();
  return /^["']use client["']\s*;?/.test(head);
}

// ── Import parsing ─────────────────────────────────────────────────────────────

// A static import with a binding clause: `import <clause> from "<spec>"`. The
// clause may span lines (`[\s\S]*?`); it stops at the first ` from "…"`.
const BINDING_IMPORT_RE =
  /\bimport\s+(?:(type)\s+)?([\s\S]*?)\s+from\s*["']([^"']+)["']/g;
// A side-effect import: `import "<spec>"` (loads the module for effect).
const SIDE_EFFECT_IMPORT_RE = /\bimport\s*["']([^"']+)["']/g;

/**
 * True when an import clause is purely type-only — either `import type …` (the
 * `type` keyword before the clause) or a brace clause whose every named specifier
 * is `type X`. Such imports are erased at compile time and carry no bundle cost.
 */
export function isTypeOnlyImport(typeKeyword: string, clause: string): boolean {
  if (typeKeyword) return true;
  const trimmed = clause.trim();
  const braces = trimmed.match(/^\{([\s\S]*)\}$/);
  if (!braces) return false;
  const names = braces[1]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return names.length > 0 && names.every((n) => /^type\s/.test(n));
}

/**
 * Client Components that value-import a server-only module (bundle hazard). Scans
 * only modules carrying a `"use client"` directive; type-only imports are
 * ignored. Non-client modules return no findings.
 */
export function findServerOnlyImportsInClient(
  mod: SourceModule,
): PerformanceFinding[] {
  if (!isClientModule(mod.src)) return [];
  const clean = stripComments(mod.src);
  const out: PerformanceFinding[] = [];

  for (const m of clean.matchAll(BINDING_IMPORT_RE)) {
    const [, typeKeyword, clause, specifier] = m;
    if (isTypeOnlyImport(typeKeyword ?? "", clause ?? "")) continue;
    if (!isServerOnlySpecifier(specifier)) continue;
    out.push({
      path: mod.path,
      line: lineAt(clean, m.index ?? 0),
      kind: "server-import-in-client",
      match: specifier,
      detail:
        `Client Component value-imports server-only module "${specifier}"; ` +
        `keep it on the server (a route/server component/action) or a client-safe helper.`,
    });
  }

  for (const m of clean.matchAll(SIDE_EFFECT_IMPORT_RE)) {
    const specifier = m[1];
    if (!isServerOnlySpecifier(specifier)) continue;
    out.push({
      path: mod.path,
      line: lineAt(clean, m.index ?? 0),
      kind: "server-import-in-client",
      match: specifier,
      detail: `Client Component side-effect-imports server-only module "${specifier}".`,
    });
  }

  return out;
}

/**
 * Raw `<img>` tags in JSX that should use `next/image`. Scans `.tsx` only (JSX
 * lives there; a `<img`-shaped token in a `.ts` string/regex is never JSX). A
 * `data:`-URI source and a spread-props `<img>` are exempt.
 */
export function findUnoptimizedImages(mod: SourceModule): PerformanceFinding[] {
  if (!mod.path.endsWith(".tsx")) return [];
  const clean = stripComments(mod.src);
  const out: PerformanceFinding[] = [];
  const re = /<img\b[^>]*>/g;
  for (const m of clean.matchAll(re)) {
    const tag = m[0];
    if (DATA_URI_SRC_RE.test(tag)) continue;
    if (SPREAD_PROPS_RE.test(tag)) continue;
    out.push({
      path: mod.path,
      line: lineAt(clean, m.index ?? 0),
      kind: "unoptimized-image",
      match: tag,
      detail:
        "Raw <img> ships an unoptimized image; use next/image (<Image>) for " +
        "automatic resize, lazy-load, and modern-format delivery.",
    });
  }
  return out;
}

// ── Query: ordered reads must be bounded ───────────────────────────────────────

/** Path prefix of the data-access layer scanned for unbounded reads. */
export const DB_LAYER_PREFIX = "src/lib/db/";

/**
 * Return the single JS statement surrounding offset `index` in `text`, as a
 * [start, end) span, delimited by the nearest `;` on each side. (Braces are NOT
 * delimiters — a query's options object, `.order("c", { ascending: true })`,
 * carries `{ }` mid-statement.) This isolates one query chain so a `.limit(…)`
 * from a neighbouring statement can't mask a missing one. The caller strips
 * comments first; `;` inside a string is not expected in a PostgREST chain.
 */
function statementSpan(text: string, index: number): [number, number] {
  let start = index;
  while (start > 0 && text[start - 1] !== ";") start -= 1;
  let end = index;
  while (end < text.length && text[end] !== ";") end += 1;
  return [start, end];
}

/**
 * Ordered list reads in the DB layer that are not bounded by `.limit(…)` and are
 * not single-row reads (`.single()`/`.maybeSingle()`). `.order(` is a PostgREST
 * builder method, so it only appears in a Supabase query chain. Scans
 * `src/lib/db/*` only.
 */
export function findUnboundedListReads(mod: SourceModule): PerformanceFinding[] {
  if (!mod.path.startsWith(DB_LAYER_PREFIX)) return [];
  const clean = stripComments(mod.src);
  const out: PerformanceFinding[] = [];
  const re = /\.order\s*\(/g;
  for (const m of clean.matchAll(re)) {
    const idx = m.index ?? 0;
    const [start, end] = statementSpan(clean, idx);
    const statement = clean.slice(start, end);
    const bounded =
      /\.limit\s*\(/.test(statement) ||
      /\.single\s*\(/.test(statement) ||
      /\.maybeSingle\s*\(/.test(statement);
    if (bounded) continue;
    out.push({
      path: mod.path,
      line: lineAt(clean, idx),
      kind: "unbounded-list-read",
      match: statement.trim().slice(0, 120),
      detail:
        "Ordered list read has no .limit(…) bound; cap it (a scan guard) so the " +
        "query can't fan out into an unbounded scan as the tenant's rows grow.",
    });
  }
  return out;
}

// ── Composite ──────────────────────────────────────────────────────────────────

/** Every performance finding in one module, in source order. */
export function auditModule(mod: SourceModule): PerformanceFinding[] {
  return [
    ...findServerOnlyImportsInClient(mod),
    ...findUnoptimizedImages(mod),
    ...findUnboundedListReads(mod),
  ].sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
}

export interface PerformanceAudit {
  /** True when no module has any performance hazard. */
  clean: boolean;
  findings: PerformanceFinding[];
}

/**
 * Audit a set of modules. A clean result — `findings: []` — is the executable
 * form of the Day 67 DoD: no server-only code in a client bundle, no unoptimized
 * image, no unbounded tenant list read.
 */
export function auditPerformance(
  modules: readonly SourceModule[],
): PerformanceAudit {
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
