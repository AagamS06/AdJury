import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  findPositiveTabindex,
  findImagesWithoutAlt,
  findMainMissingLandmarkId,
  auditModuleSemantics,
  auditSemantics,
  htmlHasLang,
  auditCorePage,
  auditCorePageStructure,
  verifyAccessibilityAA,
  CORE_PAGES,
  ROOT_LAYOUT_PATH,
  type SourceModule,
  type CorePage,
} from "@/lib/ui/semantics-audit";
import { MAIN_CONTENT_ID } from "@/lib/ui/a11y";

/**
 * Semantics audit (DailyPlan Day 62 — A11y AA verification).
 *
 * "Contrast + semantics to WCAG AA on core flows.
 *  DoD: AA checks pass on core pages."
 *
 * Part 1 runs the whole AA verification over the REAL repo source and proves it
 * is clean — the executable form of the DoD. Part 2 proves each element-level
 * scanner genuinely catches a planted defect (so a clean repo isn't a vacuous
 * pass) and ignores the patterns the app legitimately uses. Part 3 proves the
 * document-language + core-page-structure checks, and Part 4 the drift guards
 * that keep the core-page manifest honest against the real route tree.
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

const mod = (src: string, path = "src/x.tsx"): SourceModule => ({ path, src });

// ── 1. The real app clears WCAG AA ────────────────────────────────────────────

describe("semantics audit — the real app clears WCAG AA", () => {
  const modules = loadSrcModules();

  it("scanned a meaningful number of modules", () => {
    expect(modules.length).toBeGreaterThan(80);
  });

  it("has no element-level semantic defects anywhere under src/", () => {
    const audit = auditSemantics(modules);
    const report = audit.findings
      .map((f) => `  ${f.path}:${f.line} [${f.kind}] ${f.match} — ${f.detail}`)
      .join("\n");
    expect(audit.clean, `semantic defects found:\n${report}`).toBe(true);
  });

  it("every core page resolves to exactly one <h1> and one <main> landmark", () => {
    const audit = auditCorePageStructure(modules);
    const report = audit.failures
      .map((r) => `  ${r.name} (${r.route}): ${r.problems.join("; ")}`)
      .join("\n");
    expect(audit.clean, `core-page structure failures:\n${report}`).toBe(true);
  });

  it("passes the combined AA verification (contrast + semantics + structure)", () => {
    const report = verifyAccessibilityAA({ modules });
    expect(report.passes, `AA verification failed:\n  ${report.problems.join("\n  ")}`).toBe(
      true,
    );
    // Each layer individually, so a regression names the layer that broke.
    expect(report.contrast.passes).toBe(true);
    expect(report.semantics.clean).toBe(true);
    expect(report.structure.clean).toBe(true);
    expect(report.documentLanguage).toBe(true);
    expect(report.skipLinkTargetsLandmark).toBe(true);
  });
});

// ── 2. Each scanner catches a planted defect and allows real patterns ─────────

describe("semantics audit — positive tabindex (WCAG 2.4.3)", () => {
  it("flags a positive tabIndex in JSX-expression and string forms", () => {
    const found = findPositiveTabindex(
      mod('<div tabIndex={3} /><span tabindex="5" />'),
    );
    expect(found.map((f) => f.kind)).toEqual([
      "positive-tabindex",
      "positive-tabindex",
    ]);
    expect(found[0].detail).toContain("2.4.3");
  });

  it("does NOT flag tabIndex 0 or -1 (in-flow / programmatic focus)", () => {
    expect(
      findPositiveTabindex(mod('<div tabIndex={0} /><div tabIndex={-1} />')),
    ).toEqual([]);
    expect(findPositiveTabindex(mod('<div tabindex="-1" />'))).toEqual([]);
  });
});

describe("semantics audit — images without alt (WCAG 1.1.1)", () => {
  it("flags an <img> and a next <Image> with no alt", () => {
    const found = findImagesWithoutAlt(
      mod('<img src="/logo.png" /><Image src={x} width={10} height={10} />'),
    );
    expect(found.map((f) => f.kind)).toEqual([
      "img-missing-alt",
      "img-missing-alt",
    ]);
  });

  it("does NOT flag an image that has alt (incl. empty decorative alt)", () => {
    const found = findImagesWithoutAlt(
      mod('<img src="/a.png" alt="A chart" /><img src="/d.png" alt="" />'),
    );
    expect(found).toEqual([]);
  });

  it("does NOT flag an image whose props are spread (alt may be dynamic)", () => {
    expect(findImagesWithoutAlt(mod("<img {...imgProps} />"))).toEqual([]);
  });
});

describe("semantics audit — main landmark id (WCAG 1.3.1 / 2.4.1)", () => {
  it("flags a <main> that does not carry the shared landmark id", () => {
    const found = findMainMissingLandmarkId(
      mod('<main className="p-4">{children}</main>'),
    );
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe("main-missing-landmark-id");
  });

  it("accepts the constant form and the literal form of the id", () => {
    expect(
      findMainMissingLandmarkId(mod("<main id={MAIN_CONTENT_ID}>x</main>")),
    ).toEqual([]);
    expect(
      findMainMissingLandmarkId(
        mod(`<main id="${MAIN_CONTENT_ID}" className="p-4">x</main>`),
      ),
    ).toEqual([]);
  });

  it("flags a <main> carrying a different id", () => {
    const found = findMainMissingLandmarkId(mod('<main id="content">x</main>'));
    expect(found).toHaveLength(1);
  });
});

describe("semantics audit — comment/string stripping", () => {
  it("ignores tag-shaped tokens in comments but reports a real one's line", () => {
    const src = [
      "line one",
      "// a <main> without the id and tabIndex={9} in a comment are safe",
      '<main className="x">y</main>',
    ].join("\n");
    const found = auditModuleSemantics(mod(src, "src/y.tsx"));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: "main-missing-landmark-id",
      line: 3,
    });
  });
});

// ── 3. Document language + core-page structure ────────────────────────────────

describe("semantics audit — document language (WCAG 3.1.1)", () => {
  it("accepts a literal and a dynamic lang, rejects missing/empty", () => {
    expect(htmlHasLang('<html lang="en"><body /></html>')).toBe(true);
    expect(htmlHasLang("<html lang={locale}><body /></html>")).toBe(true);
    expect(htmlHasLang('<html lang="">x</html>')).toBe(false);
    expect(htmlHasLang("<html><body /></html>")).toBe(false);
    expect(htmlHasLang("<div>no html here</div>")).toBe(false);
  });

  it("the real root layout declares a page language", () => {
    const src = readFileSync(`${repoRoot}${ROOT_LAYOUT_PATH}`, "utf8");
    expect(htmlHasLang(src)).toBe(true);
  });
});

describe("semantics audit — core-page structure check", () => {
  const landmarkMain = `<main id={MAIN_CONTENT_ID}>x</main>`;

  it("passes a page with exactly one h1 and one landmark main", () => {
    const page: CorePage = {
      name: "T",
      route: "/t",
      files: ["src/layout.tsx", "src/page.tsx"],
    };
    const modules = [
      mod(landmarkMain, "src/layout.tsx"),
      mod("<h1>Title</h1>", "src/page.tsx"),
    ];
    const byPath = new Map(modules.map((m) => [m.path, m] as const));
    expect(auditCorePage(page, byPath).passes).toBe(true);
  });

  it("fails a page with no h1, two h1s, or no landmark main", () => {
    const page: CorePage = { name: "T", route: "/t", files: ["src/page.tsx"] };

    const noH1 = new Map([["src/page.tsx", mod(landmarkMain, "src/page.tsx")]]);
    expect(auditCorePage(page, noH1).passes).toBe(false);

    const twoH1 = new Map([
      ["src/page.tsx", mod(`${landmarkMain}<h1>a</h1><h1>b</h1>`, "src/page.tsx")],
    ]);
    const r = auditCorePage(page, twoH1);
    expect(r.passes).toBe(false);
    expect(r.h1Count).toBe(2);

    const noMain = new Map([
      ["src/page.tsx", mod("<h1>Only a heading</h1>", "src/page.tsx")],
    ]);
    expect(auditCorePage(page, noMain).passes).toBe(false);
  });

  it("fails (never passes vacuously) when a composing file is missing", () => {
    const page: CorePage = {
      name: "T",
      route: "/t",
      files: ["src/page.tsx", "src/gone.tsx"],
    };
    const only = new Map([
      [
        "src/page.tsx",
        mod(`${landmarkMain}<h1>Title</h1>`, "src/page.tsx"),
      ],
    ]);
    const r = auditCorePage(page, only);
    expect(r.passes).toBe(false);
    expect(r.missingFiles).toEqual(["src/gone.tsx"]);
  });

  it("flags a <main> present but without the landmark id", () => {
    const page: CorePage = { name: "T", route: "/t", files: ["src/page.tsx"] };
    const byPath = new Map([
      [
        "src/page.tsx",
        mod('<main className="x">y</main><h1>Title</h1>', "src/page.tsx"),
      ],
    ]);
    const r = auditCorePage(page, byPath);
    expect(r.passes).toBe(false);
    expect(r.mainCount).toBe(1);
    expect(r.mainLandmarkCount).toBe(0);
  });
});

// ── 4. The core-page manifest stays honest against the real tree ──────────────

describe("semantics audit — core-page manifest integrity", () => {
  it("every composing file in the manifest exists on disk", () => {
    const missing: string[] = [];
    for (const page of CORE_PAGES) {
      for (const file of page.files) {
        if (!existsSync(`${repoRoot}${file}`)) missing.push(file);
      }
    }
    expect(missing, `manifest references missing files: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("routes and names are unique and non-empty", () => {
    const routes = CORE_PAGES.map((p) => p.route);
    const names = CORE_PAGES.map((p) => p.name);
    expect(new Set(routes).size).toBe(routes.length);
    expect(new Set(names).size).toBe(names.length);
    expect(CORE_PAGES.every((p) => p.name.length > 0 && p.files.length > 0)).toBe(
      true,
    );
  });

  it("covers the core flows (landing, both auth pages, the review loop)", () => {
    const routes = new Set(CORE_PAGES.map((p) => p.route));
    for (const r of ["/", "/login", "/signup", "/review", "/review/[id]", "/history", "/dashboard"]) {
      expect(routes.has(r), `core flow ${r} is not covered`).toBe(true);
    }
  });

  it("MAIN_CONTENT_ID is the shared landmark id the checks look for", () => {
    // A guard so the literal-id branch and the Day-55 constant can't drift.
    expect(MAIN_CONTENT_ID).toBe("main-content");
  });
});
