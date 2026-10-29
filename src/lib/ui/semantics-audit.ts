/**
 * Semantics audit (DailyPlan Day 62 — A11y AA verification).
 *
 * "Contrast + semantics to WCAG AA on core flows.
 *  DoD: AA checks pass on core pages."
 *
 * Day 55 (Accessibility pass 1) built the *contrast* half of this — WCAG maths +
 * a `CONTRAST_CHECKS` inventory + `auditContrast()` in `lib/ui/a11y.ts`. Day 62 is
 * the **verification** day: it adds the *semantics* half and ties both together
 * into one executable "does the app clear WCAG AA?" check, run over the real
 * source — the a11y sibling of the Day-60 `palette-audit` / Day-61
 * `responsive-audit` (pure, node-testable, no Next build, no bundler, no DOM, no
 * credential). "AA passes on core pages" becomes a regression-proof check, not a
 * one-time manual pass.
 *
 * It verifies three layers:
 *
 *  A. ELEMENT-LEVEL DEFECTS (`auditSemantics`, over every module) — source shapes
 *     that fail a WCAG 2.1 AA success criterion wherever they appear:
 *       1. `findPositiveTabindex` — a positive `tabIndex` (WCAG 2.4.3 Focus
 *          Order): it rips an element out of the natural tab sequence. `0` and
 *          `-1` are fine (in-flow / programmatic focus); anything ≥ 1 is a defect.
 *       2. `findImagesWithoutAlt` — an `<img>` / next `<Image>` with no `alt`
 *          (WCAG 1.1.1 Non-text Content). A decorative image still needs
 *          `alt=""`, so a *missing* `alt` is always a defect.
 *       3. `findMainMissingLandmarkId` — a `<main>` that does not carry the shared
 *          `#main-content` landmark id (WCAG 1.3.1 / 2.4.1): the one skip-link
 *          target. This lifts the Day-55 "every `<main>` has the id" source test
 *          into an enforced invariant.
 *
 *  B. DOCUMENT-LANGUAGE (`htmlHasLang`) — the root `<html>` declares a non-empty
 *     `lang` (WCAG 3.1.1 Language of Page), so assistive tech reads the page in
 *     the right language.
 *
 *  C. CORE-PAGE STRUCTURE (`auditCorePageStructure`) — each core flow, as the
 *     files that actually compose its rendered output (its layout chain + page +
 *     the component that owns the heading), resolves to **exactly one `<h1>`**
 *     (WCAG 2.4.6 Headings & Labels / 1.3.1) and **exactly one `<main>` landmark**
 *     carrying the shared id. A page with zero or two `<h1>`s, or no main
 *     landmark, is the most common page-level semantic AA miss, and composition
 *     hides it from any single-file check.
 *
 * `verifyAccessibilityAA` runs all of the above *plus* the Day-55 contrast audit
 * and returns one verdict — the executable form of the Day-62 DoD.
 *
 * Comment/string handling is shared with `palette-audit` (`stripComments`) so a
 * tag- or attribute-shaped token inside a docstring (like the examples above)
 * can't trip a scan, and reported line numbers still match the original file.
 */

import { stripComments } from "./palette-audit";
import type { SourceModule } from "./palette-audit";
import { MAIN_CONTENT_ID, mainContentHref, auditContrast } from "./a11y";
import type { ContrastAudit } from "./a11y";

export type { SourceModule } from "./palette-audit";

// ── Finding model ────────────────────────────────────────────────────────────

export type SemanticsFindingKind =
  | "positive-tabindex"
  | "img-missing-alt"
  | "main-missing-landmark-id";

export interface SemanticsFinding {
  /** Repo-relative path, POSIX separators. */
  path: string;
  /** 1-based line number of the match. */
  line: number;
  kind: SemanticsFindingKind;
  /** The exact offending markup matched (e.g. `<main className=…>`). */
  match: string;
  /** Human-readable reason + the WCAG criterion it violates. */
  detail: string;
}

/** 1-based line number of a character offset within `text`. */
function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

/**
 * A compact rendering of a matched opening tag for a finding's `match` — the
 * first line only, trimmed, so a multi-line tag doesn't flood the report.
 */
function firstLine(fragment: string): string {
  const nl = fragment.indexOf("\n");
  const head = (nl === -1 ? fragment : fragment.slice(0, nl)).trim();
  return head.length > 80 ? `${head.slice(0, 77)}…` : head;
}

// ── A1. Positive tabindex (WCAG 2.4.3 Focus Order) ───────────────────────────

// `tabIndex={N}` (JSX expression) or `tabIndex="N"` / `tabindex="N"` (string).
// The value group captures the integer; a leading `-` or `0` is allowed.
const TABINDEX_RE = /\btabindex\s*=\s*(?:\{\s*(-?\d+)\s*\}|"(-?\d+)"|'(-?\d+)')/gi;

/** Elements pulled out of natural tab order by a positive tabindex. */
export function findPositiveTabindex(mod: SourceModule): SemanticsFinding[] {
  const clean = stripComments(mod.src);
  const out: SemanticsFinding[] = [];
  for (const m of clean.matchAll(TABINDEX_RE)) {
    const raw = m[1] ?? m[2] ?? m[3] ?? "";
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) continue; // 0 / -1 are fine
    out.push({
      path: mod.path,
      line: lineAt(clean, m.index ?? 0),
      kind: "positive-tabindex",
      match: m[0],
      detail: `tabIndex=${value} breaks natural focus order (WCAG 2.4.3); use 0 or -1`,
    });
  }
  return out;
}

// ── A2. Images without alt (WCAG 1.1.1 Non-text Content) ─────────────────────

// An opening <img …> or next <Image …> tag, body captured up to the closing `>`
// of that tag (not crossing into another tag's `<`).
const IMG_TAG_RE = /<(img|Image)\b([^<>]*)>/g;

/** Image elements with no `alt` attribute (decorative images need `alt=""`). */
export function findImagesWithoutAlt(mod: SourceModule): SemanticsFinding[] {
  const clean = stripComments(mod.src);
  const out: SemanticsFinding[] = [];
  for (const m of clean.matchAll(IMG_TAG_RE)) {
    const attrs = m[2] ?? "";
    if (/\balt\s*=/.test(attrs)) continue;
    // Spread props (`<img {...props} />`) may carry alt dynamically; don't flag.
    if (/\{\s*\.\.\./.test(attrs)) continue;
    out.push({
      path: mod.path,
      line: lineAt(clean, m.index ?? 0),
      kind: "img-missing-alt",
      match: firstLine(m[0]),
      detail: `<${m[1]}> has no alt attribute (WCAG 1.1.1); add alt text or alt="" if decorative`,
    });
  }
  return out;
}

// ── A3. Main landmark missing the shared id (WCAG 1.3.1 / 2.4.1) ──────────────

// An opening <main …> tag (self-closing or not), body captured up to `>`.
const MAIN_TAG_RE = /<main\b([^<>]*)>/g;

/** True when a `<main>`'s attribute text carries the shared landmark id. */
function hasLandmarkId(attrs: string): boolean {
  // `id={MAIN_CONTENT_ID}` (the constant) or a literal `id="main-content"`.
  if (/\bid\s*=\s*\{\s*MAIN_CONTENT_ID\s*\}/.test(attrs)) return true;
  const literal = new RegExp(`\\bid\\s*=\\s*["']${MAIN_CONTENT_ID}["']`);
  return literal.test(attrs);
}

/** `<main>` elements that are not the shared skip-link landmark. */
export function findMainMissingLandmarkId(
  mod: SourceModule,
): SemanticsFinding[] {
  const clean = stripComments(mod.src);
  const out: SemanticsFinding[] = [];
  for (const m of clean.matchAll(MAIN_TAG_RE)) {
    if (hasLandmarkId(m[1] ?? "")) continue;
    out.push({
      path: mod.path,
      line: lineAt(clean, m.index ?? 0),
      kind: "main-missing-landmark-id",
      match: firstLine(m[0]),
      detail: `<main> must carry id={MAIN_CONTENT_ID} — the one skip-link target (WCAG 1.3.1/2.4.1)`,
    });
  }
  return out;
}

// ── Element-level aggregate ───────────────────────────────────────────────────

/** Every element-level finding in one module, in source order. */
export function auditModuleSemantics(mod: SourceModule): SemanticsFinding[] {
  return [
    ...findPositiveTabindex(mod),
    ...findImagesWithoutAlt(mod),
    ...findMainMissingLandmarkId(mod),
  ].sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
}

export interface SemanticsAudit {
  /** True when no module has an element-level a11y defect. */
  clean: boolean;
  findings: SemanticsFinding[];
}

/**
 * Scan a set of modules for element-level WCAG-AA semantic defects. These are
 * all JSX concerns (tab order, image alt text, the `<main>` landmark), so only
 * `.tsx` modules are scanned — a `.ts` logic file (this audit included) can
 * carry a tag-shaped token in a string or regex literal without it being real
 * markup, so scanning it would be a false positive.
 */
export function auditSemantics(
  modules: readonly SourceModule[],
): SemanticsAudit {
  const findings = modules
    .filter((m) => m.path.endsWith(".tsx"))
    .flatMap((m) => auditModuleSemantics(m))
    .sort(
      (a, b) =>
        a.path.localeCompare(b.path) ||
        a.line - b.line ||
        a.kind.localeCompare(b.kind),
    );
  return { clean: findings.length === 0, findings };
}

// ── B. Document language (WCAG 3.1.1 Language of Page) ───────────────────────

/**
 * True when the given source (the root layout) renders an `<html>` element with
 * a non-empty `lang` attribute. Accepts a string literal (`lang="en"`) or a JSX
 * expression (`lang={locale}`) — both declare a language; only a missing or
 * empty literal fails.
 */
export function htmlHasLang(src: string): boolean {
  const clean = stripComments(src);
  const m = /<html\b([^<>]*)>/.exec(clean);
  if (!m) return false;
  const attrs = m[1] ?? "";
  const lit = /\blang\s*=\s*["']([^"']*)["']/.exec(attrs);
  if (lit) return lit[1].trim().length > 0;
  return /\blang\s*=\s*\{[^}]+\}/.test(attrs); // dynamic lang expression
}

// ── C. Core-page structure (WCAG 2.4.6 / 1.3.1) ──────────────────────────────

/**
 * A core user-facing page, named with the source files whose JSX composes its
 * rendered output: the layout that provides the `<main>` landmark, the route
 * page, and the component that owns the `<h1>` when the page delegates it. The
 * audit sums `<h1>` / `<main>` across these files, so composition can't hide a
 * missing or duplicated landmark/heading. Paths are repo-relative (POSIX).
 */
export interface CorePage {
  name: string;
  /** The user-facing route this composition renders. */
  route: string;
  /** Source files whose JSX composes the rendered page. */
  files: readonly string[];
}

const AUTH_LAYOUT = "src/app/(auth)/layout.tsx";
const AUTH_UI = "src/components/auth/auth-ui.tsx";
const DASH_LAYOUT = "src/app/(dashboard)/layout.tsx";

/**
 * The core flows a visitor and a signed-in user actually move through — the
 * "core pages" the Day-62 DoD checks. Each lists the files that compose it:
 *  • Landing: `page.tsx` owns `<main>`, `landing-hero.tsx` owns the `<h1>`.
 *  • Auth: `(auth)/layout.tsx` owns `<main>`, `auth-ui.tsx` owns the `<h1>`
 *    (both login and signup render it).
 *  • Dashboard flows: `(dashboard)/layout.tsx` owns `<main>`; each route page
 *    owns its own `<h1>`.
 */
export const CORE_PAGES: readonly CorePage[] = [
  {
    name: "Landing",
    route: "/",
    files: ["src/app/page.tsx", "src/components/marketing/landing-hero.tsx"],
  },
  {
    name: "Log in",
    route: "/login",
    files: [AUTH_LAYOUT, "src/app/(auth)/login/page.tsx", AUTH_UI],
  },
  {
    name: "Sign up",
    route: "/signup",
    files: [AUTH_LAYOUT, "src/app/(auth)/signup/page.tsx", AUTH_UI],
  },
  {
    name: "Dashboard home",
    route: "/dashboard",
    files: [DASH_LAYOUT, "src/app/(dashboard)/dashboard/page.tsx"],
  },
  {
    name: "New review",
    route: "/review",
    files: [DASH_LAYOUT, "src/app/(dashboard)/review/page.tsx"],
  },
  {
    name: "Review detail (scorecard)",
    route: "/review/[id]",
    files: [DASH_LAYOUT, "src/app/(dashboard)/review/[id]/page.tsx"],
  },
  {
    name: "Review history",
    route: "/history",
    files: [DASH_LAYOUT, "src/app/(dashboard)/history/page.tsx"],
  },
  {
    name: "Analytics",
    route: "/analytics",
    files: [DASH_LAYOUT, "src/app/(dashboard)/analytics/page.tsx"],
  },
];

/** Count opening `<h1>` tags in already-comment-stripped source. */
function countH1(clean: string): number {
  return (clean.match(/<h1\b/g) ?? []).length;
}

/** Count `<main>` landmarks carrying the shared id in stripped source. */
function countMainLandmarks(clean: string): number {
  let n = 0;
  for (const m of clean.matchAll(MAIN_TAG_RE)) {
    if (hasLandmarkId(m[1] ?? "")) n += 1;
  }
  return n;
}

/** Count every `<main>` (landmark or not) in stripped source. */
function countAllMains(clean: string): number {
  return (clean.match(MAIN_TAG_RE) ?? []).length;
}

export interface CorePageResult {
  name: string;
  route: string;
  h1Count: number;
  /** `<main>` elements carrying the shared landmark id across the files. */
  mainLandmarkCount: number;
  /** Every `<main>` across the files (to catch an un-identified landmark). */
  mainCount: number;
  /** Source files named by the page that were not found in the module set. */
  missingFiles: string[];
  passes: boolean;
  /** Why it failed, if it did (empty when it passes). */
  problems: string[];
}

/**
 * Verify one core page composes to exactly one `<h1>` and exactly one `<main>`
 * landmark carrying the shared id. A missing composing file is itself a failure
 * (the manifest has drifted from the tree), so the check can never pass vacuously.
 */
export function auditCorePage(
  page: CorePage,
  moduleByPath: ReadonlyMap<string, SourceModule>,
): CorePageResult {
  let h1Count = 0;
  let mainLandmarkCount = 0;
  let mainCount = 0;
  const missingFiles: string[] = [];

  for (const file of page.files) {
    const mod = moduleByPath.get(file);
    if (!mod) {
      missingFiles.push(file);
      continue;
    }
    const clean = stripComments(mod.src);
    h1Count += countH1(clean);
    mainLandmarkCount += countMainLandmarks(clean);
    mainCount += countAllMains(clean);
  }

  const problems: string[] = [];
  if (missingFiles.length > 0) {
    problems.push(`composing file(s) not found: ${missingFiles.join(", ")}`);
  }
  if (h1Count !== 1) {
    problems.push(`expected exactly one <h1>, found ${h1Count} (WCAG 2.4.6)`);
  }
  if (mainLandmarkCount !== 1) {
    problems.push(
      `expected exactly one <main id={MAIN_CONTENT_ID}>, found ${mainLandmarkCount} (WCAG 1.3.1/2.4.1)`,
    );
  }
  if (mainCount !== mainLandmarkCount) {
    problems.push(
      `found ${mainCount} <main> element(s) but ${mainLandmarkCount} carry the landmark id`,
    );
  }

  return {
    name: page.name,
    route: page.route,
    h1Count,
    mainLandmarkCount,
    mainCount,
    missingFiles,
    passes: problems.length === 0,
    problems,
  };
}

export interface CorePageStructureAudit {
  clean: boolean;
  results: CorePageResult[];
  failures: CorePageResult[];
}

/** Verify every core page's heading/landmark structure. */
export function auditCorePageStructure(
  modules: readonly SourceModule[],
  pages: readonly CorePage[] = CORE_PAGES,
): CorePageStructureAudit {
  const moduleByPath = new Map(modules.map((m) => [m.path, m] as const));
  const results = pages.map((p) => auditCorePage(p, moduleByPath));
  const failures = results.filter((r) => !r.passes);
  return { clean: failures.length === 0, results, failures };
}

// ── Combined AA verification (the Day-62 DoD) ─────────────────────────────────

/** The repo-relative path of the root layout that owns `<html lang>`. */
export const ROOT_LAYOUT_PATH = "src/app/layout.tsx";

export interface AccessibilityAAReport {
  /** True only when every layer clears WCAG AA. */
  passes: boolean;
  contrast: ContrastAudit;
  semantics: SemanticsAudit;
  structure: CorePageStructureAudit;
  /** The document declares a page language (WCAG 3.1.1). */
  documentLanguage: boolean;
  /** The single skip link targets the shared landmark (WCAG 2.4.1). */
  skipLinkTargetsLandmark: boolean;
  /** One line per failed layer, for a readable assertion message. */
  problems: string[];
}

/**
 * The executable Day-62 DoD: "contrast + semantics to WCAG AA on core flows."
 * Runs the Day-55 contrast audit, the element-level semantics scan, the
 * core-page structure check, the document-language check, and confirms the
 * skip-link anchor matches the landmark id — and returns a single verdict.
 */
export function verifyAccessibilityAA(input: {
  modules: readonly SourceModule[];
  pages?: readonly CorePage[];
}): AccessibilityAAReport {
  const { modules, pages } = input;
  const contrast = auditContrast();
  const semantics = auditSemantics(modules);
  const structure = auditCorePageStructure(modules, pages);

  const moduleByPath = new Map(modules.map((m) => [m.path, m] as const));
  const rootLayout = moduleByPath.get(ROOT_LAYOUT_PATH);
  const documentLanguage = rootLayout ? htmlHasLang(rootLayout.src) : false;

  const skipLink = modules.find((m) =>
    m.path.endsWith("skip-link.tsx"),
  );
  const skipLinkTargetsLandmark = skipLink
    ? stripComments(skipLink.src).includes(mainContentHref()) ||
      /href=\{\s*mainContentHref\(\)\s*\}/.test(stripComments(skipLink.src))
    : false;

  const problems: string[] = [];
  if (!contrast.passes) {
    problems.push(
      `contrast: ${contrast.failures.length} pairing(s) below AA`,
    );
  }
  if (!semantics.clean) {
    problems.push(`semantics: ${semantics.findings.length} element defect(s)`);
  }
  if (!structure.clean) {
    problems.push(`core-page structure: ${structure.failures.length} page(s) failing`);
  }
  if (!documentLanguage) {
    problems.push("document language (<html lang>) not declared (WCAG 3.1.1)");
  }
  if (!skipLinkTargetsLandmark) {
    problems.push("skip link does not target the #main-content landmark");
  }

  return {
    passes: problems.length === 0,
    contrast,
    semantics,
    structure,
    documentLanguage,
    skipLinkTargetsLandmark,
    problems,
  };
}
