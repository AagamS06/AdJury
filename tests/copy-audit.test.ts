import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AUTH_ACTION_LABELS,
  JUROR_COUNT,
  JUROR_COUNT_WORD,
  NUMBER_WORDS,
  TERM_RULES,
  numberWord,
  type TermRule,
} from "@/lib/ui/copy";
import {
  COPY_SOURCE_FILES,
  findTermDrift,
  findEmoji,
  findJurorCountDrift,
  auditModule,
  auditCopy,
  type SourceModule,
} from "@/lib/ui/copy-audit";
import { PERSONAS } from "@/lib/ai/personas";

/**
 * Copy audit (DailyPlan Day 65 — Copywriting pass).
 *
 * "UI text, error messages, empty states in the brand voice.
 *  DoD: consistent, professional copy."
 *
 * Part 1 runs the audit over the REAL repo source and proves it is clean — the
 * executable form of the DoD. Part 2 proves each scanner genuinely catches a
 * planted drift AND that it does not false-positive on code identifiers,
 * routes, classNames, or comments (otherwise the clean repo proves nothing).
 * Part 3 pins the lexicon integrity, and Part 4 pins this pass's actual fixes.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

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

const read = (rel: string) => readFileSync(`${repoRoot}${rel}`, "utf8");

// ── 1. The real repo is copy-clean ───────────────────────────────────────────

describe("copy audit — the app's terminology is consistent and chrome emoji-free", () => {
  const modules = loadSrcModules();

  it("finds no copy drift anywhere under src/", () => {
    const audit = auditCopy(modules);
    const report = audit.findings
      .map(
        (f) =>
          `  ${f.path}:${f.line} [${f.kind}] ${JSON.stringify(f.match)}` +
          (f.canonical ? ` → ${JSON.stringify(f.canonical)}` : ""),
      )
      .join("\n");
    expect(audit.clean, `copy drift found:\n${report}`).toBe(true);
  });

  it("actually scanned a meaningful number of modules", () => {
    // Guards against a silently-empty walk making the clean result vacuous.
    expect(modules.length).toBeGreaterThan(50);
  });

  it("scanned the files that previously carried the drift this pass fixed", () => {
    const paths = new Set(modules.map((m) => m.path));
    expect(paths.has("src/app/(dashboard)/account/page.tsx")).toBe(true);
    expect(paths.has("src/lib/reviews/export-ui.ts")).toBe(true);
    expect(paths.has("src/lib/company/accept-invitation.ts")).toBe(true);
  });
});

// ── 2. The scanners actually work (catch + don't false-positive) ─────────────

const mod = (src: string, path = "src/app/example.tsx"): SourceModule => ({
  path,
  src,
});

describe("copy audit — term-drift scanner", () => {
  it("flags the prose 'sign in' / 'sign-in' for the login action", () => {
    const f1 = findTermDrift(mod(`<p>Please sign in to continue.</p>`));
    expect(f1).toHaveLength(1);
    expect(f1[0]).toMatchObject({
      kind: "term",
      ruleId: "auth-log-in",
      canonical: AUTH_ACTION_LABELS.logIn,
    });

    const f2 = findTermDrift(mod(`<p>Update your sign-in details.</p>`));
    expect(f2).toHaveLength(1);
    expect(f2[0].ruleId).toBe("auth-log-in");
  });

  it("does NOT flag the code identifier `signInAction` or the `/login` route", () => {
    const src = [
      `import { signInAction } from "@/lib/auth/actions";`,
      `const href = "/login";`,
      `export function SignInButton() { return signInAction; }`,
    ].join("\n");
    expect(findTermDrift(mod(src))).toEqual([]);
  });

  it("does NOT flag 'sign in' sitting inside a comment", () => {
    const src = [
      `// Where an unauthenticated user is sent to sign in.`,
      `/** A docstring mentioning sign-in details. */`,
      `const label = "Log in";`,
    ].join("\n");
    expect(findTermDrift(mod(src))).toEqual([]);
  });

  it("does NOT flag the allowed sibling terms 'sign up' / 'sign out'", () => {
    const src = `<p>Sign up for an account, then sign out when done.</p>`;
    expect(findTermDrift(mod(src))).toEqual([]);
  });

  it("flags the 'e-mail' spelling but not 'email'", () => {
    expect(findTermDrift(mod(`<p>Enter your e-mail address.</p>`))).toHaveLength(
      1,
    );
    expect(findTermDrift(mod(`<p>Enter your email address.</p>`))).toEqual([]);
  });

  it("flags mis-cased brand names but not 'AdJury' or the lowercase filename form", () => {
    expect(findTermDrift(mod(`<p>Welcome to Adjury.</p>`))[0]?.ruleId).toBe(
      "brand-name",
    );
    expect(findTermDrift(mod(`<p>Welcome to ADJURY.</p>`))).toHaveLength(1);
    expect(findTermDrift(mod(`<p>Welcome to AdJury.</p>`))).toEqual([]);
    // Export filenames use a deliberate all-lowercase slug — not flagged.
    expect(
      findTermDrift(mod(`const name = "adjury-review-history.csv";`)),
    ).toEqual([]);
  });

  it("reports the correct 1-based line number", () => {
    const src = ["line one", "line two", "please sign in here"].join("\n");
    expect(findTermDrift(mod(src))[0].line).toBe(3);
  });

  it("exempts the lexicon's own source files from the term scan", () => {
    const banned = `const x = "please sign in";`;
    for (const p of COPY_SOURCE_FILES) {
      expect(findTermDrift(mod(banned, p))).toEqual([]);
    }
    // ...but the same content in any other file IS flagged.
    expect(findTermDrift(mod(banned, "src/app/other.tsx"))).toHaveLength(1);
  });

  it("accepts a custom rule set", () => {
    const rules: TermRule[] = [
      { id: "x", canonical: "widget", variants: [/\bwodget\b/i], note: "" },
    ];
    const f = findTermDrift(mod(`<p>A wodget.</p>`), rules);
    expect(f).toHaveLength(1);
    expect(f[0].ruleId).toBe("x");
  });
});

describe("copy audit — emoji scanner", () => {
  it("flags a pictographic emoji in the chrome", () => {
    const robot = findEmoji(mod(`<p>All done \u{1F916}</p>`));
    expect(robot).toHaveLength(1);
    expect(robot[0].kind).toBe("emoji");

    const check = findEmoji(mod(`<span>✅ Passed</span>`));
    expect(check).toHaveLength(1);
  });

  it("does NOT flag the '→' arrow or an em dash used as typography", () => {
    expect(findEmoji(mod(`<p>Submit → review — done.</p>`))).toEqual(
      [],
    );
  });

  it("does NOT flag an emoji that appears only inside a comment", () => {
    expect(findEmoji(mod(`// celebrate \u{1F389}\nconst x = 1;`))).toEqual([]);
  });

  it("reports the correct line for an emoji", () => {
    const src = ["one", "two \u{1F389}", "three"].join("\n");
    expect(findEmoji(mod(src))[0].line).toBe(2);
  });
});

describe("copy audit — juror-count scanner", () => {
  it("flags a jury-size claim that disagrees with the roster", () => {
    // The roster is six; "five jurors" is stale drift.
    const f = findJurorCountDrift(mod(`<p>The five jurors review your copy.</p>`));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      kind: "juror-count",
      ruleId: "juror-count",
      match: "five jurors",
      canonical: `${numberWord(JUROR_COUNT)} jurors`,
    });
  });

  it("does NOT flag the correct count, in either plural or 'juror personas' form", () => {
    const correct = numberWord(JUROR_COUNT); // "six"
    expect(findJurorCountDrift(mod(`<p>The ${correct} jurors review it.</p>`))).toEqual([]);
    expect(
      findJurorCountDrift(mod(`<p>${correct} expert jurors weigh in.</p>`)),
    ).toEqual([]);
    expect(
      findJurorCountDrift(mod(`<p>${correct} AI juror personas review it.</p>`)),
    ).toEqual([]);
  });

  it("catches the 'N AI juror personas' shape through a qualifier word", () => {
    const f = findJurorCountDrift(
      mod(`description: "Five AI juror personas review your content."`),
    );
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe("juror-count");
  });

  it("catches the digit form '5 jurors'", () => {
    expect(findJurorCountDrift(mod(`<p>Run all 5 jurors.</p>`))).toHaveLength(1);
  });

  it("does NOT flag the singular adjectival 'juror' (not a jury-size claim)", () => {
    // "one juror weight" counts weights, not the jury; "per-juror" has no number.
    expect(
      findJurorCountDrift(mod(`<p>At least one juror weight must be positive.</p>`)),
    ).toEqual([]);
    expect(findJurorCountDrift(mod(`<p>A per-juror breakdown.</p>`))).toEqual([]);
    expect(findJurorCountDrift(mod(`<p>One juror's score.</p>`))).toEqual([]);
  });

  it("does NOT flag a count attached to a different noun ('six expert lenses')", () => {
    expect(
      findJurorCountDrift(mod(`<p>Six jurors, six expert lenses.</p>`)),
    ).toEqual([]); // "Six jurors" is correct; "six expert lenses" isn't a juror claim
    expect(findJurorCountDrift(mod(`<p>Five expert lenses.</p>`))).toEqual([]);
  });

  it("does NOT flag a stale count sitting inside a comment", () => {
    const src = [
      `// Historically the five jurors ran the fan-out.`,
      `/** Weighted mean of the five juror scores. */`,
      `const label = "the six jurors";`,
    ].join("\n");
    expect(findJurorCountDrift(mod(src))).toEqual([]);
  });

  it("honours an explicit expected count", () => {
    // With five expected, "five jurors" is clean and "six jurors" drifts.
    expect(findJurorCountDrift(mod(`<p>five jurors</p>`), 5)).toEqual([]);
    expect(findJurorCountDrift(mod(`<p>six jurors</p>`), 5)).toHaveLength(1);
  });

  it("reports the correct 1-based line number", () => {
    const src = ["line one", "line two", "the five jurors"].join("\n");
    expect(findJurorCountDrift(mod(src))[0].line).toBe(3);
  });

  it("exempts the lexicon's own source files (which document the drifted phrase)", () => {
    const banned = `const x = "the five jurors";`;
    for (const p of COPY_SOURCE_FILES) {
      expect(findJurorCountDrift(mod(banned, p))).toEqual([]);
    }
    expect(findJurorCountDrift(mod(banned, "src/app/other.tsx"))).toHaveLength(1);
  });
});

describe("copy audit — module aggregation", () => {
  it("merges both scanners' findings in source order", () => {
    const src = [
      `<p>Welcome to Adjury \u{1F389}</p>`, // line 1: brand + emoji
      `<p>Please sign in.</p>`, // line 2: term
    ].join("\n");
    const findings = auditModule(mod(src));
    expect(findings.map((f) => f.line)).toEqual([1, 1, 2]);
    expect(findings.map((f) => f.kind)).toEqual(["emoji", "term", "term"]);
  });

  it("auditCopy reports clean for an all-clean module set", () => {
    const audit = auditCopy([
      mod(`<p>Log in to AdJury to continue.</p>`),
      mod(`<p>Sign up for a free review.</p>`),
    ]);
    expect(audit).toEqual({ clean: true, findings: [] });
  });
});

// ── 3. Lexicon integrity ─────────────────────────────────────────────────────

describe("copy lexicon integrity", () => {
  it("every rule has a canonical spelling and at least one variant RegExp", () => {
    for (const rule of TERM_RULES) {
      expect(rule.canonical.length).toBeGreaterThan(0);
      expect(rule.variants.length).toBeGreaterThan(0);
      for (const v of rule.variants) expect(v).toBeInstanceOf(RegExp);
      expect(rule.note.length).toBeGreaterThan(0);
    }
  });

  it("rule ids are unique and kebab-case", () => {
    const ids = TERM_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("no rule flags its own canonical spelling (variants target only drift)", () => {
    for (const rule of TERM_RULES) {
      for (const v of rule.variants) {
        const re = new RegExp(v.source, v.flags.replace("g", ""));
        expect(
          re.test(rule.canonical),
          `${rule.id}: variant ${v} matches canonical "${rule.canonical}"`,
        ).toBe(false);
      }
    }
  });

  it("exposes the three canonical auth-action labels", () => {
    expect(AUTH_ACTION_LABELS).toEqual({
      logIn: "Log in",
      signUp: "Sign up",
      signOut: "Sign out",
    });
  });

  it("derives JUROR_COUNT from the real roster, not a hard-coded literal", () => {
    expect(JUROR_COUNT).toBe(PERSONAS.length);
    expect(JUROR_COUNT).toBeGreaterThan(1); // count claims are plural prose
    expect(JUROR_COUNT_WORD).toBe(numberWord(JUROR_COUNT));
  });

  it("numberWord spells small cardinals and falls back to the figure", () => {
    expect(numberWord(0)).toBe("zero");
    expect(numberWord(6)).toBe("six");
    expect(numberWord(NUMBER_WORDS.length)).toBe(String(NUMBER_WORDS.length));
    expect(numberWord(99)).toBe("99");
    expect(numberWord(-1)).toBe("-1");
  });
});

// ── 4. This pass's fixes are in place ────────────────────────────────────────

describe("Day 65 copy fixes", () => {
  it("the account page no longer says 'sign in' and uses login terminology", () => {
    const src = read("src/app/(dashboard)/account/page.tsx");
    expect(findTermDrift(mod(src, "src/app/(dashboard)/account/page.tsx"))).toEqual(
      [],
    );
    expect(src).toContain("login details");
    expect(src).toContain("you log in with");
  });

  it("the export 401 message says 'log in again', not 'sign in again'", () => {
    const src = read("src/lib/reviews/export-ui.ts");
    expect(src).toContain("Please log in again to export.");
    expect(src).not.toMatch(/sign in again/i);
  });

  it("the invitation errors say 'Log in', not 'Sign in'", () => {
    const src = read("src/lib/company/accept-invitation.ts");
    expect(src).toContain("Log in or create an account");
    expect(src).toContain("Log in with that address");
    // No prose 'sign in' variant remains in this file.
    expect(
      findTermDrift(mod(src, "src/lib/company/accept-invitation.ts")),
    ).toEqual([]);
  });
});

// ── 5. Day 69 friction fix: the UI states the real jury size (six) ───────────

describe("Day 69 juror-count fixes", () => {
  const CHROME = [
    "src/app/layout.tsx",
    "src/app/(dashboard)/review/page.tsx",
    "src/components/review/history-list.tsx",
    "src/components/review/review-form.tsx",
  ] as const;

  it("the four core-flow surfaces no longer say 'five jurors'", () => {
    for (const path of CHROME) {
      const src = read(path);
      expect(
        findJurorCountDrift(mod(src, path)),
        `${path} still states a stale juror count`,
      ).toEqual([]);
      expect(src).not.toMatch(/\bfive jurors\b/i);
    }
  });

  it("the submit page, status, empty state, and meta description say the real count", () => {
    const word = numberWord(JUROR_COUNT); // "six"
    expect(read("src/app/(dashboard)/review/page.tsx")).toContain(
      `the ${word} jurors will each score it`,
    );
    expect(read("src/components/review/review-form.tsx")).toContain(
      `The ${word} jurors are reviewing your content`,
    );
    expect(read("src/components/review/history-list.tsx")).toContain(
      `past the ${word} jurors`,
    );
    expect(read("src/app/layout.tsx")).toMatch(
      new RegExp(`${word} AI juror personas`, "i"),
    );
  });
});
