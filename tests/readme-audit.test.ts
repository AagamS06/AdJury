import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JUROR_COUNT } from "@/lib/ui/copy";
import { PERSONAS } from "@/lib/ai/personas";
import {
  findJurorCountDrift,
  findStaleStatus,
  findBrokenDocLinks,
  findUnknownScripts,
  extractLocalDocLinks,
  statesCorrectJurorCount,
  mentionsBusinessAnalyst,
  stripHtmlComments,
  reconcileReadme,
  STALE_STATUS_PATTERNS,
} from "@/lib/marketing/readme-audit";

/**
 * README accuracy audit (DailyPlan Day 82 — Portfolio writeup).
 *
 * "Polish README + architecture summary for portfolio.
 *  DoD: README reflects the shipped product."
 *
 * Part 1 runs the audit over the REAL README + the real shipped product and
 * proves it is clean — the executable form of the DoD. Part 2 proves each
 * scanner genuinely catches a planted drift AND does not false-positive on
 * look-alikes (otherwise the clean repo proves nothing). Part 3 pins the
 * positive currentness checks.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(`${repoRoot}${rel}`, "utf8");

/** Repo-relative paths (files + dirs) that exist, skipping heavy dirs. */
function existingPaths(): Set<string> {
  const skip = new Set([
    "node_modules",
    ".git",
    ".next",
    "dist",
    "coverage",
  ]);
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

function packageScripts(): string[] {
  const pkg = JSON.parse(read("package.json")) as {
    scripts?: Record<string, string>;
  };
  return Object.keys(pkg.scripts ?? {});
}

// ── 1. The real README reflects the shipped product ────────────────────────────

describe("readme audit — the README reflects the shipped product", () => {
  const readme = read("README.md");
  const scripts = packageScripts();
  const paths = existingPaths();

  it("has a clean reconcile over the real repo", () => {
    const audit = reconcileReadme({
      readme,
      availableScripts: scripts,
      existingPaths: paths,
    });
    const report = audit.findings
      .map((f) => `  README.md:${f.line} [${f.kind}] ${JSON.stringify(f.match)} — ${f.detail}`)
      .join("\n");
    expect(audit.findings, `README drift:\n${report}`).toEqual([]);
    expect(audit.ok).toBe(true);
  });

  it("is non-vacuous — the real README gives each scanner material to check", () => {
    // The roster is really six, so the clean result above is a real agreement.
    expect(JUROR_COUNT).toBe(6);
    expect(PERSONAS.length).toBe(JUROR_COUNT);
    // The README actually states a juror count and links to local docs — so a
    // clean juror-count / doc-link result is meaningful, not empty.
    expect(statesCorrectJurorCount(readme)).toBe(true);
    const links = extractLocalDocLinks(readme).map((l) => l.target);
    expect(links).toContain("Architecture.md");
    expect(links.length).toBeGreaterThan(5);
    // And it tells the reader to run real scripts.
    expect(/\bnpm run \w/.test(readme)).toBe(true);
  });

  it("is positively current (names the Business Analyst, states six jurors)", () => {
    expect(mentionsBusinessAnalyst(readme)).toBe(true);
    expect(statesCorrectJurorCount(readme)).toBe(true);
  });
});

// ── 2. Each scanner bites a planted fault, and does not false-positive ──────────

describe("readme audit — juror-count scanner", () => {
  it("flags a wrong count", () => {
    const f = findJurorCountDrift("reviewed by five jurors before you publish", 6);
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe("juror-count");
    expect(f[0].match.toLowerCase()).toContain("five jurors");
  });

  it("flags a wrong count in the 'juror personas' form", () => {
    const f = findJurorCountDrift('five distinct AI "juror" personas', 6);
    expect(f).toHaveLength(1);
  });

  it("accepts the correct count ('six jurors', 'Six Jurors')", () => {
    expect(findJurorCountDrift("the six jurors review your copy", 6)).toEqual([]);
    expect(findJurorCountDrift("## The Six Jurors", 6)).toEqual([]);
  });

  it("does not match a bare 'per-juror' or an unrelated count", () => {
    expect(findJurorCountDrift("each per-juror score is shown", 6)).toEqual([]);
    expect(findJurorCountDrift("without paying for six providers", 6)).toEqual([]);
  });

  it("respects the word boundary — 'sixteen jurors' parses as 16, not 6", () => {
    expect(findJurorCountDrift("sixteen jurors", 16)).toEqual([]);
    expect(findJurorCountDrift("sixteen jurors", 6)).toHaveLength(1);
  });
});

describe("readme audit — stale-status scanner", () => {
  it("flags the pre-build status line", () => {
    const f = findStaleStatus(
      "Status: Documentation-complete; implementation starting. See Memory.",
    );
    expect(f.length).toBeGreaterThanOrEqual(1);
    expect(f.some((x) => x.kind === "stale-status")).toBe(true);
  });

  it("flags 'Week 1 of a 12-week build' but not a late-week status", () => {
    expect(findStaleStatus("Week 1 of a 12-week build")).toHaveLength(1);
    expect(findStaleStatus("Week 12 of the 12-week build")).toEqual([]);
  });

  it("has a curated, non-empty pattern set", () => {
    expect(STALE_STATUS_PATTERNS.length).toBeGreaterThan(0);
  });
});

describe("readme audit — doc-link scanner", () => {
  const have = new Set(["Architecture.md", "docs", "docs/DEPLOYMENT.md"]);

  it("flags a link to a missing file", () => {
    const f = findBrokenDocLinks("see [plan](Nope.md) for details", have);
    expect(f).toHaveLength(1);
    expect(f[0].match).toBe("Nope.md");
  });

  it("accepts a link to an existing file or directory", () => {
    expect(findBrokenDocLinks("[arch](Architecture.md)", have)).toEqual([]);
    expect(findBrokenDocLinks("[runbooks](docs/)", have)).toEqual([]);
    expect(findBrokenDocLinks("[dep](docs/DEPLOYMENT.md)", have)).toEqual([]);
  });

  it("ignores external links and in-page anchors", () => {
    expect(findBrokenDocLinks("[site](https://example.com)", have)).toEqual([]);
    expect(findBrokenDocLinks("[mail](mailto:x@example.com)", have)).toEqual([]);
    expect(findBrokenDocLinks("[sec](#design)", have)).toEqual([]);
  });

  it("strips an anchor from a local target before resolving", () => {
    expect(findBrokenDocLinks("[r](Rules.md#secrets)", new Set(["Rules.md"]))).toEqual([]);
  });
});

describe("readme audit — script scanner", () => {
  const scripts = ["dev", "build", "demo", "test"];

  it("flags an unknown script", () => {
    const f = findUnknownScripts("run `npm run nope` to start", scripts);
    expect(f).toHaveLength(1);
    expect(f[0].match).toBe("npm run nope");
  });

  it("accepts a real script", () => {
    expect(findUnknownScripts("run `npm run demo` for a review", scripts)).toEqual([]);
  });

  it("does not treat 'npm install' / 'npm test' builtins as run-scripts", () => {
    expect(findUnknownScripts("npm install then npm test", scripts)).toEqual([]);
  });

  it("reports each unknown script only once", () => {
    const f = findUnknownScripts("`npm run nope` ... `npm run nope`", scripts);
    expect(f).toHaveLength(1);
  });
});

// ── 3. Currentness + helpers ────────────────────────────────────────────────────

describe("readme audit — currentness and composition", () => {
  it("reconcile flags a README that omits the Business Analyst and the count", () => {
    const audit = reconcileReadme({
      readme: "AdJury reviews your marketing copy with AI.",
      availableScripts: ["dev"],
      existingPaths: new Set<string>(),
    });
    const kinds = audit.findings.map((f) => f.kind);
    expect(kinds).toContain("missing-current-claim");
    expect(audit.checks.mentionsBusinessAnalyst).toBe(false);
    expect(audit.checks.statesCorrectJurorCount).toBe(false);
    expect(audit.ok).toBe(false);
  });

  it("strips HTML comments but leaves URLs intact", () => {
    const out = stripHtmlComments("a <!-- five jurors --> b https://x.io/a");
    expect(out).not.toContain("five jurors");
    expect(out).toContain("https://x.io/a");
  });

  it("does not flag a juror count that only appears inside an HTML comment", () => {
    expect(findJurorCountDrift("<!-- was five jurors -->", 6)).toEqual([]);
  });
});
