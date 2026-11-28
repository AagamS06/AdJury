/**
 * README accuracy audit (DailyPlan Day 82 — Portfolio writeup).
 *
 * "Polish README + architecture summary for portfolio.
 *  DoD: README reflects the shipped product."
 *
 * The portfolio-pass sibling of the app's other "pure core + static audit +
 * reconcile drift guard" passes (`palette-audit` Day 60, `copy-audit` Day 65,
 * `seo-metadata` Day 80): a pure, node-testable scanner that proves the public
 * README's factual claims still match the shipped product, with no Next build,
 * no DOM, and no credential.
 *
 * It exists because of a real drift it was written to catch: at Day 82 the
 * README still advertised "five" jurors (the Business Analyst, Day 23b, makes
 * the jury six) and a status of "Week 1 ... implementation starting", while the
 * product is v1 feature-complete. The `copy-audit` juror-count guard only scans
 * `src/` chrome, so a markdown doc like the README slipped through — this audit
 * closes that gap for the README specifically.
 *
 * It proves five invariants over the README text + the real shipped product as
 * ground truth:
 *
 *  1. JUROR COUNT (`findJurorCountDrift`) — any statement of how many jurors
 *     AdJury runs must equal the real roster size ({@link JUROR_COUNT} =
 *     `PERSONAS.length`). Keyed on a number adjacent to "jurors" / "juror
 *     personas", so a bare "per-juror" or "six providers" never matches.
 *
 *  2. NO STALE STATUS (`findStaleStatus`) — the README must not carry a
 *     development-status phrase that asserts the product is not yet built (the
 *     curated {@link STALE_STATUS_PATTERNS}); these contradict a shipped v1.
 *
 *  3. DOC LINKS RESOLVE (`findBrokenDocLinks`) — every relative markdown link to
 *     a local file/dir must resolve against the set of paths that actually
 *     exist on disk. External (`http(s)://`, `mailto:`) and pure `#anchor`
 *     links are not checked.
 *
 *  4. SCRIPTS EXIST (`findUnknownScripts`) — every `npm run <name>` the README
 *     tells a reader to run must be a real script in package.json. The builtins
 *     (`npm install`, `npm test`) are not `run` scripts and are not checked.
 *
 *  5. CURRENTNESS (in `reconcileReadme`) — beyond "not wrong", the README must
 *     be positively current: it must state the correct juror count at least
 *     once in a recognized form, and must name the Business Analyst juror that
 *     the old copy omitted.
 *
 * A clean {@link reconcileReadme} over the real README is the executable form of
 * the Day-82 DoD.
 *
 * NOTE on the scanners' own examples: every illustrative "wrong" phrase in this
 * file lives in a comment, never in runtime source, so the Day-65 `copy-audit`
 * (which scans comment-stripped `src/`) never flags this module.
 */

import { JUROR_COUNT, NUMBER_WORDS, numberWord } from "@/lib/ui/copy";

// ── Finding model ────────────────────────────────────────────────────────────

export type ReadmeFindingKind =
  | "juror-count"
  | "stale-status"
  | "missing-doc"
  | "unknown-script"
  | "missing-current-claim";

export interface ReadmeFinding {
  /** 1-based line number of the match (0 for a whole-document check). */
  line: number;
  kind: ReadmeFindingKind;
  /** The exact offending (or missing) text. */
  match: string;
  /** One line on what's wrong / what to do. */
  detail: string;
}

/** 1-based line number of a character offset within `text`. */
export function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

/**
 * Strip HTML comments (`<!-- ... -->`) only — the one comment form markdown
 * uses. Unlike the JS comment-stripper the code audits use, this leaves `//`
 * untouched so URLs (`https://…`) survive. Replaces comment bodies with
 * same-length blanks (newlines preserved) so reported line numbers still match.
 */
export function stripHtmlComments(md: string): string {
  return md.replace(/<!--[\s\S]*?-->/g, (m) =>
    m.replace(/[^\n]/g, " "),
  );
}

// ── 1. Juror-count drift ──────────────────────────────────────────────────────

/** A spelled cardinal (0–20) or a 1–3 digit figure, as a capturing group. */
const COUNT_TOKEN =
  "(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|\\d{1,3})";

/**
 * Up to 24 chars of words / spaces / quotes / hyphens may sit between the count
 * and the juror noun (e.g. `six distinct AI "juror" personas`). Bounded so a
 * count and a juror noun in unrelated clauses never pair up.
 */
const GAP = "[\\s\"'A-Za-z-]{0,24}";

/**
 * Two ways the README states the jury size, both keyed on a number quantifying
 * jurors: a plural head ("six jurors", "Six Jurors") or a "juror persona(s)"
 * head ("six … juror personas"). The word boundary after the count stops
 * "sixteen" matching as "six"; neither pattern matches a bare "per-juror".
 */
const JUROR_COUNT_PATTERNS: readonly RegExp[] = [
  new RegExp(`\\b${COUNT_TOKEN}\\b${GAP}\\bjurors\\b`, "giu"),
  new RegExp(`\\b${COUNT_TOKEN}\\b${GAP}\\bjuror\\b["'\\s]+personas?\\b`, "giu"),
];

/** Parse a matched count token ("six" or "6") to its integer, or `null`. */
function parseCount(token: string): number | null {
  const lower = token.toLowerCase();
  if (/^\d+$/.test(lower)) return Number.parseInt(lower, 10);
  const i = NUMBER_WORDS.indexOf(lower);
  return i >= 0 ? i : null;
}

/** A single recognized juror-count statement in a markdown document. */
export interface JurorCountStatement {
  /** Character offset of the match within the (original) document. */
  index: number;
  /** The integer the statement asserts (e.g. 6 for "six jurors"). */
  stated: number;
  /** The exact matched text, e.g. "five craft jurors". */
  match: string;
}

/**
 * All recognized juror-count statements in `md`, HTML comments ignored. This is
 * the single definition of "a statement of how many jurors AdJury runs" — the
 * README audit and the core-docs audit (`doc-audit.ts`) both read it, so there
 * is one regex to keep honest, not two drifting copies (Rules.md §7).
 */
export function jurorCountStatements(md: string): JurorCountStatement[] {
  const clean = stripHtmlComments(md);
  const out: { index: number; stated: number; match: string }[] = [];
  const seen = new Set<number>();
  for (const re of JUROR_COUNT_PATTERNS) {
    for (const m of clean.matchAll(re)) {
      const stated = parseCount(m[1]);
      if (stated === null) continue;
      const at = m.index ?? 0;
      if (seen.has(at)) continue; // both patterns overlapping the same text
      seen.add(at);
      out.push({ index: at, stated, match: m[0] });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * README statements of the jury size that disagree with the real roster
 * ({@link JUROR_COUNT}).
 */
export function findJurorCountDrift(
  md: string,
  expected: number = JUROR_COUNT,
): ReadmeFinding[] {
  return jurorCountStatements(md)
    .filter((s) => s.stated !== expected)
    .map((s) => ({
      line: lineAt(md, s.index),
      kind: "juror-count" as const,
      match: s.match,
      detail: `states ${s.stated} jurors; the real roster is ${expected} (${numberWord(
        expected,
      )})`,
    }));
}

// ── 2. Stale development status ────────────────────────────────────────────────

/**
 * Phrases that assert the product is not yet built — stale once v1 ships. Kept
 * curated (not a broad word-list) so the guard is a genuine regression check,
 * not a false-positive generator. These are the exact claims the pre-Day-82
 * README carried.
 *
 * Deliberately NOT matched: an accurate "Week 12 of the 12-week build" (the
 * current launch-prep status), because it names a late week, not week one.
 */
export const STALE_STATUS_PATTERNS: readonly { re: RegExp; detail: string }[] = [
  {
    re: /implementation starting/i,
    detail: "'implementation starting' — the implementation is done; state the shipped status.",
  },
  {
    re: /\bWeek 1 of a 12-week build\b/i,
    detail: "'Week 1 of a 12-week build' — stale; the build is in its final week.",
  },
  {
    re: /scaffold is being built/i,
    detail: "'scaffold is being built' — the app is built, not being scaffolded.",
  },
  {
    re: /being built in Phase 1/i,
    detail: "'being built in Phase 1' — Phase 1 shipped long ago.",
  },
  {
    re: /Documentation-complete; implementation starting/i,
    detail: "stale pre-build status line.",
  },
];

/** Stale development-status phrases present in the README. */
export function findStaleStatus(md: string): ReadmeFinding[] {
  const clean = stripHtmlComments(md);
  const out: ReadmeFinding[] = [];
  for (const { re, detail } of STALE_STATUS_PATTERNS) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    for (const m of clean.matchAll(g)) {
      out.push({
        line: lineAt(md, m.index ?? 0),
        kind: "stale-status",
        match: m[0],
        detail,
      });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

// ── 3. Local doc links resolve ─────────────────────────────────────────────────

/** A markdown link target that points at a local file or directory. */
export interface DocLink {
  index: number;
  /** The link target as written, anchor stripped, trailing slash kept. */
  target: string;
}

const MD_LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;

/** Is this link target a local relative path (not external / not an anchor)? */
function isLocalTarget(target: string): boolean {
  if (target === "") return false;
  if (target.startsWith("#")) return false; // in-page anchor
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return false; // has a scheme (http:, mailto:, …)
  if (target.startsWith("//")) return false; // protocol-relative
  return true;
}

/** Every local-file markdown link target in the README. */
export function extractLocalDocLinks(md: string): DocLink[] {
  const clean = stripHtmlComments(md);
  const out: DocLink[] = [];
  for (const m of clean.matchAll(MD_LINK_RE)) {
    const raw = m[1].trim().split(/\s+/)[0]; // drop any "(url \"title\")" title
    const noAnchor = raw.split("#")[0];
    if (!isLocalTarget(noAnchor)) continue;
    out.push({ index: m.index ?? 0, target: noAnchor });
  }
  return out;
}

/** Normalize a path for membership tests: POSIX, no leading `./`, no trailing `/`. */
function normalizePath(p: string): string {
  let out = p.replace(/\\/g, "/");
  if (out.startsWith("./")) out = out.slice(2);
  if (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
  return out;
}

/**
 * README links to local files/dirs that don't exist. `existingPaths` is the set
 * of repo-relative paths (files and directories) that are present on disk.
 */
export function findBrokenDocLinks(
  md: string,
  existingPaths: Iterable<string>,
): ReadmeFinding[] {
  const have = new Set<string>();
  for (const p of existingPaths) have.add(normalizePath(p));
  const out: ReadmeFinding[] = [];
  for (const link of extractLocalDocLinks(md)) {
    if (have.has(normalizePath(link.target))) continue;
    out.push({
      line: lineAt(md, link.index),
      kind: "missing-doc",
      match: link.target,
      detail: `links to '${link.target}', which is not present in the repo`,
    });
  }
  return out;
}

// ── 4. npm scripts exist ───────────────────────────────────────────────────────

const NPM_RUN_RE = /\bnpm run ([a-z][a-z0-9:_-]*)/gi;

/** `npm run <name>` invocations in the README whose script does not exist. */
export function findUnknownScripts(
  md: string,
  availableScripts: Iterable<string>,
): ReadmeFinding[] {
  const have = new Set<string>(availableScripts);
  const clean = stripHtmlComments(md);
  const out: ReadmeFinding[] = [];
  const seen = new Set<string>();
  for (const m of clean.matchAll(NPM_RUN_RE)) {
    const name = m[1];
    if (have.has(name) || seen.has(name)) continue;
    seen.add(name);
    out.push({
      line: lineAt(md, m.index ?? 0),
      kind: "unknown-script",
      match: `npm run ${name}`,
      detail: `references script '${name}', which is not defined in package.json`,
    });
  }
  return out;
}

// ── 5. Currentness (positive claims) ───────────────────────────────────────────

/** Does the README state the correct juror count at least once? */
export function statesCorrectJurorCount(
  md: string,
  expected: number = JUROR_COUNT,
): boolean {
  return jurorCountStatements(md).some((s) => s.stated === expected);
}

/** Does the README name the Business Analyst juror (the sixth, Day 23b)? */
export function mentionsBusinessAnalyst(md: string): boolean {
  return /business analyst/i.test(stripHtmlComments(md));
}

// ── Composition ────────────────────────────────────────────────────────────────

export interface ReadmeAuditInput {
  /** The README.md text. */
  readme: string;
  /** The real roster size; defaults to {@link JUROR_COUNT}. */
  expectedJurorCount?: number;
  /** package.json `scripts` keys. */
  availableScripts: Iterable<string>;
  /** Repo-relative paths (files + dirs) that exist on disk. */
  existingPaths: Iterable<string>;
}

export interface ReadmeAudit {
  /** True when the README reflects the shipped product (no findings). */
  ok: boolean;
  findings: ReadmeFinding[];
  /** The positive currentness checks, for reporting. */
  checks: {
    statesCorrectJurorCount: boolean;
    mentionsBusinessAnalyst: boolean;
  };
}

/**
 * Audit the README against the shipped product. A clean result — `ok: true`,
 * `findings: []` — is the executable form of the Day-82 DoD ("README reflects
 * the shipped product"): no count/status drift, every doc link and script
 * resolves, and the copy is positively current (states the real jury size and
 * names the Business Analyst).
 */
export function reconcileReadme(input: ReadmeAuditInput): ReadmeAudit {
  const expected = input.expectedJurorCount ?? JUROR_COUNT;
  const findings: ReadmeFinding[] = [
    ...findJurorCountDrift(input.readme, expected),
    ...findStaleStatus(input.readme),
    ...findBrokenDocLinks(input.readme, input.existingPaths),
    ...findUnknownScripts(input.readme, input.availableScripts),
  ];

  const checks = {
    statesCorrectJurorCount: statesCorrectJurorCount(input.readme, expected),
    mentionsBusinessAnalyst: mentionsBusinessAnalyst(input.readme),
  };
  if (!checks.statesCorrectJurorCount) {
    findings.push({
      line: 0,
      kind: "missing-current-claim",
      match: "juror count",
      detail: `the README never states the real jury size (${expected} / ${numberWord(
        expected,
      )}) in a recognized form`,
    });
  }
  if (!checks.mentionsBusinessAnalyst) {
    findings.push({
      line: 0,
      kind: "missing-current-claim",
      match: "Business Analyst",
      detail: "the README never names the Business Analyst juror (the sixth juror, Day 23b)",
    });
  }

  findings.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
  return { ok: findings.length === 0, findings, checks };
}
