/**
 * Copy audit (DailyPlan Day 65 — Copywriting pass).
 *
 * "UI text, error messages, empty states in the brand voice.
 *  DoD: consistent, professional copy."
 *
 * A pure, node-testable scanner — the copywriting-pass sibling of the Day-60
 * `palette-audit` / Day-61 `responsive-audit` / Day-62 `semantics-audit` — that
 * proves three voice invariants (Design.md §7) over the real source with no Next
 * build, no DOM, and no credential:
 *
 *  1. TERMINOLOGY (`findTermDrift`) — every term in {@link TERM_RULES} is spelled
 *     its one canonical way; a non-canonical prose variant (e.g. "sign in" for
 *     the login action) is flagged. The variant regexes match only the prose
 *     form (a separator between words), so a code identifier (`signInAction`),
 *     a route (`/login`), or a className is never a false positive.
 *
 *  2. NO EMOJI IN CHROME (`findEmoji`) — Design.md §7 forbids emoji in the
 *     product chrome; any pictographic emoji in a scanned file is flagged.
 *     Typographic marks that are not emoji (the `→` arrow used in docstrings,
 *     en/em dashes, …) are deliberately NOT in the scanned ranges, so legitimate
 *     punctuation is never caught.
 *
 *  3. JUROR COUNT (`findJurorCountDrift`) — any chrome statement of how many
 *     jurors AdJury runs ("five jurors", "six AI juror personas") must equal the
 *     real roster size, {@link JUROR_COUNT} (= `PERSONAS.length`). This caught
 *     the Day-69 friction: the submit flow said "five jurors" while the
 *     scorecard rendered six. The scan keys only on a number adjacent to
 *     "juror(s)", so "six expert lenses" or a bare "per-juror" never matches,
 *     and — like the others — it runs on comment-stripped source, so an accurate
 *     internal note ("the five craft jurors, then the Business Analyst") in a
 *     docstring is never flagged.
 *
 * Both scanners strip comments first (reusing the palette audit's
 * comment-stripper, Rules.md §7) so a word or symbol in a docstring can't trip a
 * scan while reported line numbers still match the original file. The lexicon's
 * own source files are exempt from the term scan — they necessarily contain the
 * banned forms as rule data (`COPY_SOURCE_FILES`, mirroring the palette audit's
 * `PALETTE_SOURCE_FILES`).
 *
 * A clean result over the repo is the executable form of the Day-65 DoD.
 */

import { stripComments, type SourceModule } from "@/lib/ui/palette-audit";
import {
  JUROR_COUNT,
  NUMBER_WORDS,
  TERM_RULES,
  numberWord,
  type TermRule,
} from "@/lib/ui/copy";

export type { SourceModule };

/**
 * Files that define the lexicon and therefore legitimately contain the banned
 * prose variants as rule data / documentation. Exempt from the term scan.
 * Repo-relative, POSIX separators.
 */
export const COPY_SOURCE_FILES: readonly string[] = [
  "src/lib/ui/copy.ts",
  "src/lib/ui/copy-audit.ts",
];

// ── Finding model ────────────────────────────────────────────────────────────

export type CopyFindingKind = "term" | "emoji" | "juror-count";

export interface CopyFinding {
  /** Repo-relative path, POSIX separators. */
  path: string;
  /** 1-based line number of the match. */
  line: number;
  kind: CopyFindingKind;
  /** The exact offending text matched (e.g. `sign in`, an emoji glyph). */
  match: string;
  /** For a term finding: the rule id. */
  ruleId?: string;
  /** For a term finding: the canonical spelling to use instead. */
  canonical?: string;
}

/** 1-based line number of a character offset within `text`. */
function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

/** A global-flagged clone of a rule variant (preserving its case flag). */
function globalize(re: RegExp): RegExp {
  const flags = re.flags.includes("g") ? re.flags : re.flags + "g";
  return new RegExp(re.source, flags);
}

/**
 * Pictographic emoji: the emoticon/symbol/pictograph/transport blocks, dingbats,
 * misc symbols, the emoji variation selector, and regional-indicator (flag)
 * letters. Typographic marks (arrows, en/em dash, ellipsis) are intentionally
 * excluded so ordinary punctuation is never flagged as an emoji.
 */
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/gu;

// The emoticon/pictograph/transport/flags blocks, misc symbols, dingbats, and
// the emoji variation selector — the glyphs people actually type (🤖, ✅, 🎉).
// The arrows block (which holds the `→` used in code docstrings) is deliberately
// NOT scanned, so ordinary typographic punctuation is never flagged; the scan
// also runs on COMMENT-STRIPPED source as a second line of defence.

// ── Scanners ─────────────────────────────────────────────────────────────────

/**
 * Non-canonical prose terms (Design.md §7 terminology). Skipped for the lexicon
 * source files, which hold the banned forms as rule data.
 */
export function findTermDrift(
  mod: SourceModule,
  rules: readonly TermRule[] = TERM_RULES,
): CopyFinding[] {
  if (COPY_SOURCE_FILES.includes(mod.path)) return [];
  const clean = stripComments(mod.src);
  const out: CopyFinding[] = [];
  for (const rule of rules) {
    for (const variant of rule.variants) {
      const re = globalize(variant);
      for (const m of clean.matchAll(re)) {
        out.push({
          path: mod.path,
          line: lineAt(clean, m.index ?? 0),
          kind: "term",
          match: m[0],
          ruleId: rule.id,
          canonical: rule.canonical,
        });
      }
    }
  }
  return out;
}

/** Pictographic emoji in the product chrome (Design.md §7). */
export function findEmoji(mod: SourceModule): CopyFinding[] {
  const clean = stripComments(mod.src);
  const out: CopyFinding[] = [];
  for (const m of clean.matchAll(EMOJI_RE)) {
    out.push({
      path: mod.path,
      line: lineAt(clean, m.index ?? 0),
      kind: "emoji",
      match: m[0],
    });
  }
  return out;
}

/** A spelled cardinal (1–12) or a 1–3 digit figure, as a capturing alternation. */
const COUNT_TOKEN =
  "(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\\d{1,3})";

/**
 * Chrome ways to state the jury size, both keyed on a number quantifying jurors:
 *
 *  - PLURAL head ("five jurors", "six expert jurors") — the number is directly
 *    followed by the **plural** "jurors", optionally through one adjective. The
 *    plural is what makes it a count of the jury; the singular adjectival use
 *    ("one juror weight", "per-juror") is deliberately NOT matched.
 *  - "juror personas" head ("six AI juror personas") — the number counts the
 *    personas, through up to two qualifier words.
 *
 * Neither matches "six expert lenses" (no "juror") nor a bare "per-juror".
 */
const JUROR_COUNT_PATTERNS: readonly RegExp[] = [
  new RegExp(`\\b${COUNT_TOKEN}(?:\\s+[A-Za-z]+)?\\s+jurors\\b`, "giu"),
  new RegExp(`\\b${COUNT_TOKEN}(?:\\s+[A-Za-z]+){0,2}\\s+juror\\s+personas?\\b`, "giu"),
];

/** Parse a matched count token ("five" or "5") to its integer, or `null`. */
function parseCount(token: string): number | null {
  const lower = token.toLowerCase();
  if (/^\d+$/.test(lower)) return Number.parseInt(lower, 10);
  const i = NUMBER_WORDS.indexOf(lower);
  return i >= 0 ? i : null;
}

/**
 * Chrome statements of the jury size that disagree with the real roster
 * ({@link JUROR_COUNT}). Skipped for the lexicon source files, which hold the
 * drifted phrase as documentation. Runs on comment-stripped source, so an
 * accurate internal note in a docstring is never flagged.
 */
export function findJurorCountDrift(
  mod: SourceModule,
  expected: number = JUROR_COUNT,
): CopyFinding[] {
  if (COPY_SOURCE_FILES.includes(mod.path)) return [];
  const clean = stripComments(mod.src);
  const out: CopyFinding[] = [];
  const seen = new Set<number>();
  for (const re of JUROR_COUNT_PATTERNS) {
    for (const m of clean.matchAll(re)) {
      const stated = parseCount(m[1]);
      if (stated === null || stated === expected) continue;
      const at = m.index ?? 0;
      if (seen.has(at)) continue; // both patterns overlapping the same text
      seen.add(at);
      out.push({
        path: mod.path,
        line: lineAt(clean, at),
        kind: "juror-count",
        match: m[0],
        ruleId: "juror-count",
        canonical: `${numberWord(expected)} jurors`,
      });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

/** Every copy finding in one module, in source order. */
export function auditModule(mod: SourceModule): CopyFinding[] {
  return [
    ...findTermDrift(mod),
    ...findEmoji(mod),
    ...findJurorCountDrift(mod),
  ].sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
}

export interface CopyAudit {
  /** True when no module has any copy finding. */
  clean: boolean;
  findings: CopyFinding[];
}

/**
 * Audit a set of modules. A clean result — `findings: []` — is the executable
 * form of the Day-65 DoD: the UI's terminology is consistent and the chrome is
 * emoji-free.
 */
export function auditCopy(modules: readonly SourceModule[]): CopyAudit {
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
