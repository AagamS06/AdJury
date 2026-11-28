import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CRAFT_JUROR_COUNT, JUROR_COUNT } from "@/lib/ui/copy";
import { PERSONAS } from "@/lib/ai/personas";
import {
  auditCoreDoc,
  findDocJurorCountDrift,
  isCraftSubsetStatement,
  reconcileCoreDocs,
  GUARDED_CORE_DOCS,
  type CoreDoc,
} from "@/lib/marketing/doc-audit";

/**
 * Core-docs accuracy audit (DailyPlan Day 91 — Buffer / final polish).
 *
 * Part 1 runs the audit over the REAL spec docs and proves it is clean — the
 * executable form of "the core docs reflect the shipped product". Part 2 proves
 * the craft-subset-aware juror-count scanner genuinely catches a planted drift
 * AND does not false-positive on the legitimate "N craft jurors" decomposition.
 * Part 3 pins the per-doc currentness behaviour and the composition.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(`${repoRoot}${rel}`, "utf8");

/** Repo-relative paths (files + dirs) that exist, skipping heavy dirs. */
function existingPaths(): Set<string> {
  const skip = new Set(["node_modules", ".git", ".next", "dist", "coverage"]);
  const out = new Set<string>();
  function walk(absDir: string, rel: string): void {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const abs = `${absDir}/${entry.name}`;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      out.add(childRel);
      if (entry.isDirectory()) walk(abs, childRel);
    }
  }
  walk(repoRoot.replace(/\/$/, ""), "");
  return out;
}

/** The real guarded docs, loaded from disk. */
function realDocs(): CoreDoc[] {
  return GUARDED_CORE_DOCS.map((d) => ({
    path: d.path,
    text: read(d.path),
    requireCurrentJuryClaims: d.requireCurrentJuryClaims,
  }));
}

// ── 1. The real core docs reflect the shipped product ───────────────────────────

describe("core-docs audit — the spec docs reflect the shipped product", () => {
  const docs = realDocs();
  const paths = existingPaths();

  it("has a clean reconcile over the real docs", () => {
    const audit = reconcileCoreDocs({ docs, existingPaths: paths });
    const report = audit.findings
      .map((f) => `  ${f.path}:${f.line} [${f.kind}] ${JSON.stringify(f.match)} — ${f.detail}`)
      .join("\n");
    expect(audit.findings, `core-doc drift:\n${report}`).toEqual([]);
    expect(audit.ok).toBe(true);
  });

  it("is non-vacuous — the roster is really six (five craft + the Business Analyst)", () => {
    expect(JUROR_COUNT).toBe(6);
    expect(CRAFT_JUROR_COUNT).toBe(5);
    expect(CRAFT_JUROR_COUNT).toBe(JUROR_COUNT - 1);
    expect(PERSONAS.length).toBe(JUROR_COUNT);
    // Exactly one juror is the insider Business Analyst.
    expect(PERSONAS.filter((p) => p.name === "business_analyst")).toHaveLength(1);
  });

  it("is non-vacuous — the real docs actually make jury-size claims for the scanner to check", () => {
    // Architecture states the full roster ("6 jurors") AND the craft subset
    // ("five craft jurors") — both must be present for the clean result above to
    // mean the allowance really fired, not that nothing matched.
    const arch = docs.find((d) => d.path === "Architecture.md");
    expect(arch).toBeDefined();
    const stmts = [
      ...arch!.text.matchAll(/\b(five|six|\d)\b[\sA-Za-z"'-]{0,24}\bjurors\b/gi),
    ].map((m) => m[0].toLowerCase());
    expect(stmts.some((s) => /craft jurors/.test(s))).toBe(true);
    expect(stmts.some((s) => /\b(6|six)\b/.test(s) && !/craft/.test(s))).toBe(true);
  });

  it("every guarded spec doc is positively current where required", () => {
    for (const d of docs.filter((x) => x.requireCurrentJuryClaims)) {
      const findings = auditCoreDoc(d, existingPaths());
      expect(
        findings.filter((f) => f.kind === "missing-current-claim"),
        `${d.path} should be current`,
      ).toEqual([]);
    }
  });
});

// ── 2. The craft-subset-aware juror-count scanner ───────────────────────────────

describe("core-docs audit — juror-count scanner (craft-subset aware)", () => {
  it("flags a wrong full-jury count and accepts the right one", () => {
    expect(findDocJurorCountDrift("reviewed by five jurors")).toHaveLength(1);
    expect(findDocJurorCountDrift("reviewed by six jurors")).toEqual([]);
    expect(findDocJurorCountDrift("## The Six Jurors")).toEqual([]);
  });

  it("accepts the correct craft-subset claim ('five craft jurors')", () => {
    const f = findDocJurorCountDrift(
      "the five craft jurors plus the Business Analyst",
    );
    expect(f).toEqual([]);
  });

  it("still flags a WRONG craft-subset claim ('six craft jurors' — only five exist)", () => {
    const f = findDocJurorCountDrift("the six craft jurors");
    expect(f).toHaveLength(1);
    expect(f[0].detail).toContain("craft subset is 5");
  });

  it("flags a plain 'five jurors' (not craft) against the full roster", () => {
    const f = findDocJurorCountDrift("just five jurors review the copy");
    expect(f).toHaveLength(1);
    expect(f[0].detail).toContain("real roster is 6");
  });

  it("classifies craft vs full statements correctly", () => {
    expect(isCraftSubsetStatement("five craft jurors")).toBe(true);
    expect(isCraftSubsetStatement("six jurors")).toBe(false);
  });

  it("does not match a bare 'per-juror' or an unrelated count", () => {
    expect(findDocJurorCountDrift("each per-juror score is shown")).toEqual([]);
    expect(findDocJurorCountDrift("instead of six paid providers")).toEqual([]);
  });

  it("respects the craft count being derived from the roster", () => {
    // Pinning the craft allowance to an explicit number proves the default is
    // the real derived one, not a hard-coded 5.
    expect(findDocJurorCountDrift("four craft jurors", 5, 4)).toEqual([]);
    expect(findDocJurorCountDrift("five craft jurors", 5, 4)).toHaveLength(1);
  });
});

// ── 3. Currentness + composition ────────────────────────────────────────────────

describe("core-docs audit — currentness and composition", () => {
  const have = new Set<string>(["PRD.md", "Architecture.md"]);

  it("flags a spec doc that omits the count and the Business Analyst", () => {
    const findings = auditCoreDoc(
      { path: "X.md", text: "AdJury reviews your copy.", requireCurrentJuryClaims: true },
      have,
    );
    const kinds = findings.map((f) => f.kind);
    expect(kinds.filter((k) => k === "missing-current-claim")).toHaveLength(2);
  });

  it("does NOT require current claims when the doc opts out (a historical plan)", () => {
    const findings = auditCoreDoc(
      { path: "Phases.md", text: "The plan ships a review engine.", requireCurrentJuryClaims: false },
      have,
    );
    expect(findings.filter((f) => f.kind === "missing-current-claim")).toEqual([]);
  });

  it("reuses the generic broken-doc-link scanner, tagged with the doc path", () => {
    const findings = auditCoreDoc(
      { path: "PRD.md", text: "see [plan](Nope.md)", requireCurrentJuryClaims: false },
      have,
    );
    const broken = findings.filter((f) => f.kind === "missing-doc");
    expect(broken).toHaveLength(1);
    expect(broken[0].path).toBe("PRD.md");
    expect(broken[0].match).toBe("Nope.md");
  });

  it("accepts a link to an existing doc", () => {
    const findings = auditCoreDoc(
      { path: "PRD.md", text: "see [arch](Architecture.md)", requireCurrentJuryClaims: false },
      have,
    );
    expect(findings.filter((f) => f.kind === "missing-doc")).toEqual([]);
  });

  it("reconcile aggregates findings across docs, sorted by path", () => {
    const docs: CoreDoc[] = [
      { path: "Zed.md", text: "five jurors", requireCurrentJuryClaims: false },
      { path: "Able.md", text: "five jurors", requireCurrentJuryClaims: false },
    ];
    const audit = reconcileCoreDocs({ docs, existingPaths: have });
    expect(audit.ok).toBe(false);
    expect(audit.findings.map((f) => f.path)).toEqual(["Able.md", "Zed.md"]);
  });

  it("GUARDED_CORE_DOCS is the canonical spec-doc set with per-doc currentness", () => {
    const paths = GUARDED_CORE_DOCS.map((d) => d.path);
    expect(paths).toEqual(["PRD.md", "Architecture.md", "Rules.md", "Phases.md"]);
    const current = Object.fromEntries(
      GUARDED_CORE_DOCS.map((d) => [d.path, d.requireCurrentJuryClaims]),
    );
    // The living plan doc opts out of positive currentness; the specs don't.
    expect(current["Phases.md"]).toBe(false);
    expect(current["PRD.md"]).toBe(true);
    expect(current["Architecture.md"]).toBe(true);
    expect(current["Rules.md"]).toBe(true);
  });
});
