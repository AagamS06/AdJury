/**
 * Core-docs accuracy audit (DailyPlan Day 91 — Buffer / final polish).
 *
 * The final-polish sibling of the Day-82 README audit (`readme-audit.ts`) and
 * the app's other "pure core + static audit + reconcile drift guard" passes
 * (`palette-audit` Day 60, `copy-audit` Day 65, `seo-metadata` Day 80): a pure,
 * node-testable scanner that proves the project's **canonical spec docs** still
 * match the shipped product, with no Next build, no DOM, and no credential.
 *
 * It exists because of a real drift it was written to catch. Day 82 built the
 * juror-count drift guard but applied it only to the README; the canonical
 * onboarding / spec docs — PRD.md, Architecture.md, Rules.md, Phases.md — still
 * carried pre-Day-23b "five jurors" claims (the Business Analyst, Day 23b, makes
 * the jury six): the PRD's goals/metrics/output-contract, the Architecture flow
 * diagram/steps/folder-tree (which also contradicted itself — "fan-out 5 calls"
 * next to "call the model 6×"), the Rules end-to-end test line, and the Phases
 * plan. The `copy-audit` juror-count guard only scans `src/` chrome and the
 * Day-82 guard only the README, so these spec docs slipped through — this audit
 * closes that gap so no shipped doc disagrees with the six-juror roster.
 *
 * It reuses the single juror-count statement definition from `readme-audit.ts`
 * (one regex, not a second drifting copy — Rules.md §7) and adds one thing the
 * README never needed: an **honest allowance for the craft-subset decomposition**.
 * Prose legitimately says "the five craft jurors plus the Business Analyst"
 * (5 craft + 1 insider = 6); that is correct, not drift. So a "N craft jurors"
 * claim is checked against {@link CRAFT_JUROR_COUNT} while a plain "N jurors"
 * claim is checked against {@link JUROR_COUNT} — "six craft jurors" would still
 * be flagged (there are only five), keeping the allowance a guard, not a hole.
 *
 * Per document it proves:
 *
 *  1. JUROR COUNT (`findDocJurorCountDrift`) — every jury-size statement equals
 *     the real roster (full jury, or craft subset when the claim says "craft").
 *  2. DOC LINKS RESOLVE (`findBrokenDocLinks`, reused) — every relative markdown
 *     link to a local file/dir resolves against what exists on disk.
 *  3. CURRENTNESS (opt-in per doc) — a spec doc must positively state the real
 *     jury size at least once and name the Business Analyst the old copy omitted.
 *
 * A clean {@link reconcileCoreDocs} over the real docs is the executable form of
 * "the core docs reflect the shipped product".
 *
 * NOTE on this file's own examples: every illustrative "wrong" phrase lives in a
 * comment, never in runtime source, so the Day-65 `copy-audit` (which scans
 * comment-stripped `src/`) never flags this module.
 */

import {
  BUSINESS_ANALYST_PERSONA,
  CRAFT_JUROR_COUNT,
  JUROR_COUNT,
  numberWord,
} from "@/lib/ui/copy";
import {
  findBrokenDocLinks,
  jurorCountStatements,
  lineAt,
  mentionsBusinessAnalyst,
  statesCorrectJurorCount,
  stripHtmlComments,
  type ReadmeFinding,
} from "./readme-audit";

// ── Finding model ────────────────────────────────────────────────────────────

export type CoreDocFindingKind =
  | "juror-count"
  | "missing-doc"
  | "missing-current-claim";

export interface CoreDocFinding {
  /** Repo-relative path of the document the finding is in. */
  path: string;
  /** 1-based line number of the match (0 for a whole-document check). */
  line: number;
  kind: CoreDocFindingKind;
  /** The exact offending (or missing) text. */
  match: string;
  /** One line on what's wrong / what to do. */
  detail: string;
}

// ── 1. Juror-count drift (craft-subset aware) ───────────────────────────────────

/**
 * Does this matched statement talk about the *craft* subset of the jury rather
 * than the whole jury? A "craft juror" claim ("the five craft jurors") decomposes
 * the roster honestly and is measured against {@link CRAFT_JUROR_COUNT}.
 */
export function isCraftSubsetStatement(match: string): boolean {
  return /\bcraft\b/i.test(match);
}

/**
 * Statements of the jury size in `md` that disagree with the real roster. A
 * plain "N jurors" claim is checked against `expectedFull` ({@link JUROR_COUNT});
 * a "N craft jurors" claim against `expectedCraft` ({@link CRAFT_JUROR_COUNT}).
 */
export function findDocJurorCountDrift(
  md: string,
  expectedFull: number = JUROR_COUNT,
  expectedCraft: number = CRAFT_JUROR_COUNT,
): Omit<CoreDocFinding, "path">[] {
  const out: Omit<CoreDocFinding, "path">[] = [];
  for (const s of jurorCountStatements(md)) {
    const craft = isCraftSubsetStatement(s.match);
    const expected = craft ? expectedCraft : expectedFull;
    if (s.stated === expected) continue;
    out.push({
      line: lineAt(md, s.index),
      kind: "juror-count",
      match: s.match,
      detail: craft
        ? `states ${s.stated} craft jurors; the craft subset is ${expectedCraft} (${numberWord(
            expectedCraft,
          )}) — ${JUROR_COUNT} total with the Business Analyst`
        : `states ${s.stated} jurors; the real roster is ${expectedFull} (${numberWord(
            expectedFull,
          )})`,
    });
  }
  return out;
}

// ── Composition ────────────────────────────────────────────────────────────────

export interface CoreDoc {
  /** Repo-relative path, e.g. "PRD.md". Used in findings. */
  path: string;
  /** The document text. */
  text: string;
  /**
   * When true, the doc must also be *positively current*: it must state the real
   * jury size at least once and name the Business Analyst. Set for the canonical
   * product-spec docs (PRD, Architecture, Rules); left off for a historical plan
   * doc (Phases) where a forward-looking narrative need not restate the roster.
   */
  requireCurrentJuryClaims: boolean;
}

export interface CoreDocsAuditInput {
  docs: readonly CoreDoc[];
  /** Repo-relative paths (files + dirs) that exist on disk, for link checks. */
  existingPaths: Iterable<string>;
  /** The real roster size; defaults to {@link JUROR_COUNT}. */
  expectedJurorCount?: number;
  /** The real craft-subset size; defaults to {@link CRAFT_JUROR_COUNT}. */
  expectedCraftCount?: number;
}

export interface CoreDocsAudit {
  /** True when every core doc reflects the shipped product (no findings). */
  ok: boolean;
  findings: CoreDocFinding[];
}

/** Audit one core doc; returns its findings tagged with the doc's path. */
export function auditCoreDoc(
  doc: CoreDoc,
  existingPaths: Iterable<string>,
  expectedJurorCount: number = JUROR_COUNT,
  expectedCraftCount: number = CRAFT_JUROR_COUNT,
): CoreDocFinding[] {
  const findings: CoreDocFinding[] = [];

  for (const f of findDocJurorCountDrift(
    doc.text,
    expectedJurorCount,
    expectedCraftCount,
  )) {
    findings.push({ ...f, path: doc.path });
  }

  // Reuse the README audit's generic link scanner; re-tag its ReadmeFinding.
  for (const f of findBrokenDocLinks(doc.text, existingPaths) as ReadmeFinding[]) {
    findings.push({
      path: doc.path,
      line: f.line,
      kind: "missing-doc",
      match: f.match,
      detail: f.detail,
    });
  }

  if (doc.requireCurrentJuryClaims) {
    if (!statesCorrectJurorCount(doc.text, expectedJurorCount)) {
      findings.push({
        path: doc.path,
        line: 0,
        kind: "missing-current-claim",
        match: "juror count",
        detail: `never states the real jury size (${expectedJurorCount} / ${numberWord(
          expectedJurorCount,
        )}) in a recognized form`,
      });
    }
    if (!mentionsBusinessAnalyst(doc.text)) {
      findings.push({
        path: doc.path,
        line: 0,
        kind: "missing-current-claim",
        match: BUSINESS_ANALYST_PERSONA,
        detail: "never names the Business Analyst juror (the sixth juror, Day 23b)",
      });
    }
  }

  return findings.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
}

/**
 * Audit every core doc against the shipped product. A clean result — `ok: true`,
 * `findings: []` — is the executable form of "the core spec docs reflect the
 * shipped product": no juror-count drift (full or craft-subset), every local doc
 * link resolves, and each spec doc is positively current.
 */
export function reconcileCoreDocs(input: CoreDocsAuditInput): CoreDocsAudit {
  const expectedFull = input.expectedJurorCount ?? JUROR_COUNT;
  const expectedCraft = input.expectedCraftCount ?? CRAFT_JUROR_COUNT;
  const findings: CoreDocFinding[] = [];
  for (const doc of input.docs) {
    findings.push(
      ...auditCoreDoc(doc, input.existingPaths, expectedFull, expectedCraft),
    );
  }
  findings.sort(
    (a, b) =>
      a.path.localeCompare(b.path) || a.line - b.line || a.kind.localeCompare(b.kind),
  );
  return { ok: findings.length === 0, findings };
}

/**
 * The canonical spec-doc set this audit guards, with per-doc currentness. PRD,
 * Architecture and Rules describe the current product/conventions and must be
 * positively current; Phases is the historical week-by-week plan, so it is held
 * only to "no juror-count drift" and working links.
 */
export const GUARDED_CORE_DOCS: readonly {
  path: string;
  requireCurrentJuryClaims: boolean;
}[] = [
  { path: "PRD.md", requireCurrentJuryClaims: true },
  { path: "Architecture.md", requireCurrentJuryClaims: true },
  { path: "Rules.md", requireCurrentJuryClaims: true },
  { path: "Phases.md", requireCurrentJuryClaims: false },
];
