import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  isServerOnlySpecifier,
  isTypeOnlyImport,
  isClientModule,
  findServerOnlyImportsInClient,
  findUnoptimizedImages,
  findUnboundedListReads,
  auditModule,
  auditPerformance,
  SERVER_ONLY_IMPORT_PREFIXES,
  SERVER_ONLY_PACKAGES,
  NODE_BUILTINS,
  DB_LAYER_PREFIX,
  type SourceModule,
} from "@/lib/performance/performance-audit";
import { MAX_TENANT_LIST_SCAN } from "@/lib/db/queries";

/**
 * Performance audit (DailyPlan Day 67 — Performance pass).
 *
 * "Bundle, image, and query optimizations.
 *  DoD: measurable improvement; no regressions."
 *
 * Part 1 runs the audit over the REAL repo source and proves it clean — the
 * executable form of the DoD (no server-only import in a client bundle, no raw
 * <img>, no unbounded tenant list read). Part 2 proves each scanner genuinely
 * bites a planted hazard AND allows the patterns the app actually uses (a
 * type-only import, a server-action import, a data-URI <img>, a bounded read),
 * so the clean repo in Part 1 is not vacuous. Part 3 pins the helpers. Part 4
 * pins this day's real query fix: the two previously-unbounded reads are bounded.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/** Recursively collect every .ts/.tsx under src/, path repo-relative. */
function loadSrcModules(): SourceModule[] {
  const out: SourceModule[] = [];
  function walk(absDir: string, rel: string): void {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const abs = `${absDir}/${entry.name}`;
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(abs, childRel);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        out.push({ path: childRel, src: readFileSync(abs, "utf8") });
      }
    }
  }
  walk(`${repoRoot}src`, "src");
  return out;
}

// ── 1. The real repo has no performance hazards ────────────────────────────────

describe("performance audit — the real repo is clean", () => {
  const modules = loadSrcModules();

  it("finds no performance hazards anywhere under src/", () => {
    const audit = auditPerformance(modules);
    const report = audit.findings
      .map((f) => `  ${f.path}:${f.line} [${f.kind}] ${f.match} — ${f.detail}`)
      .join("\n");
    expect(audit.clean, `performance hazards found:\n${report}`).toBe(true);
  });

  it("scanned a meaningful number of modules", () => {
    expect(modules.length).toBeGreaterThan(80);
  });

  it("actually exercised each dimension (client module, .tsx, DB layer all present)", () => {
    expect(modules.some((m) => isClientModule(m.src))).toBe(true);
    expect(modules.some((m) => m.path.endsWith(".tsx"))).toBe(true);
    expect(modules.some((m) => m.path.startsWith(DB_LAYER_PREFIX))).toBe(true);
  });

  it("the real client components DO import client-safe helpers (so the scan is non-trivial)", () => {
    // export-button / copy-button import @/lib/observability/logger (pure) — a
    // value import from @/lib that the scanner must NOT flag.
    const clientWithLibImport = modules.filter(
      (m) =>
        isClientModule(m.src) &&
        /from\s*["']@\/lib\//.test(m.src),
    );
    expect(clientWithLibImport.length).toBeGreaterThan(0);
    for (const m of clientWithLibImport) {
      expect(findServerOnlyImportsInClient(m)).toEqual([]);
    }
  });
});

// ── 2. Each scanner bites a planted hazard, and allows real patterns ───────────

describe("bundle scanner — server-only imports in a client module", () => {
  const client = (body: string): SourceModule => ({
    path: "src/components/x.tsx",
    src: `"use client";\n${body}\n`,
  });

  it("flags a client component importing the DB layer", () => {
    const f = findServerOnlyImportsInClient(
      client(`import { listReviewsByCompany } from "@/lib/db/queries";`),
    );
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe("server-import-in-client");
    expect(f[0].match).toBe("@/lib/db/queries");
  });

  it("flags importing the AI client, the Supabase client, the SDK, and a Node built-in", () => {
    expect(
      findServerOnlyImportsInClient(client(`import { complete } from "@/lib/ai/client";`)),
    ).toHaveLength(1);
    expect(
      findServerOnlyImportsInClient(client(`import { createClient } from "@supabase/ssr";`)),
    ).toHaveLength(1);
    expect(
      findServerOnlyImportsInClient(client(`import Anthropic from "@anthropic-ai/sdk";`)),
    ).toHaveLength(1);
    expect(
      findServerOnlyImportsInClient(client(`import { readFileSync } from "node:fs";`)),
    ).toHaveLength(1);
    expect(
      findServerOnlyImportsInClient(client(`import { createHash } from "crypto";`)),
    ).toHaveLength(1);
    expect(
      findServerOnlyImportsInClient(client(`import "server-only";`)),
    ).toHaveLength(1);
  });

  it("does NOT flag a type-only import of a server module (erased at compile time)", () => {
    expect(
      findServerOnlyImportsInClient(
        client(`import type { ReviewRow } from "@/lib/db/queries";`),
      ),
    ).toEqual([]);
    expect(
      findServerOnlyImportsInClient(
        client(`import { type ReviewRow } from "@/lib/db/queries";`),
      ),
    ).toEqual([]);
  });

  it("does NOT flag a server-action import or a client-safe helper", () => {
    // "use server" action modules are the sanctioned client→server seam.
    expect(
      findServerOnlyImportsInClient(
        client(`import { signInAction } from "@/lib/auth/actions";`),
      ),
    ).toEqual([]);
    // Pure client-safe helpers and Next client APIs.
    expect(
      findServerOnlyImportsInClient(
        client(
          `import { MIN_PASSWORD_CHARS } from "@/lib/validation/limits";\n` +
            `import Link from "next/link";\n` +
            `import { usePathname } from "next/navigation";`,
        ),
      ),
    ).toEqual([]);
  });

  it("does NOT flag a server-only import in a NON-client module (a server component/route)", () => {
    const serverModule: SourceModule = {
      path: "src/app/(dashboard)/dashboard/page.tsx",
      src: `import { listUsersByCompany } from "@/lib/db/queries";\n`,
    };
    expect(findServerOnlyImportsInClient(serverModule)).toEqual([]);
  });
});

describe("image scanner — raw <img> should be next/image", () => {
  const tsx = (body: string): SourceModule => ({
    path: "src/components/x.tsx",
    src: body,
  });

  it("flags a raw <img> with a file source", () => {
    const f = findUnoptimizedImages(tsx(`export const A = () => <img src="/logo.png" alt="Logo" />;`));
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe("unoptimized-image");
  });

  it("does NOT flag a data-URI <img>, a spread <img>, or an inline <svg>", () => {
    expect(
      findUnoptimizedImages(tsx(`const A = () => <img src="data:image/png;base64,AAAA" alt="x" />;`)),
    ).toEqual([]);
    expect(findUnoptimizedImages(tsx(`const A = (p) => <img {...p} />;`))).toEqual([]);
    expect(
      findUnoptimizedImages(tsx(`const A = () => <svg viewBox="0 0 10 10"><path d="M0 0" /></svg>;`)),
    ).toEqual([]);
  });

  it("does NOT scan a .ts file (a <img>-shaped token in a string/regex is not JSX)", () => {
    const tsFile: SourceModule = {
      path: "src/lib/ui/semantics-audit.ts",
      src: `const IMG_RE = /<img\\b[^>]*>/g;`,
    };
    expect(findUnoptimizedImages(tsFile)).toEqual([]);
  });
});

describe("query scanner — ordered reads must be bounded", () => {
  const db = (body: string): SourceModule => ({
    path: "src/lib/db/queries.ts",
    src: body,
  });

  it("flags an ordered read with no .limit()", () => {
    const f = findUnboundedListReads(
      db(
        `const { data } = await x.from("users").select("*").eq("company_id", c).order("created_at", { ascending: true });`,
      ),
    );
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe("unbounded-list-read");
  });

  it("does NOT flag an ordered read bounded by .limit(), nor a single-row read", () => {
    expect(
      findUnboundedListReads(
        db(`const { data } = await x.from("r").select("*").order("created_at").limit(50);`),
      ),
    ).toEqual([]);
    expect(
      findUnboundedListReads(
        db(`const { data } = await x.from("r").select("*").order("created_at").maybeSingle();`),
      ),
    ).toEqual([]);
  });

  it("isolates the statement — a neighbour's .limit() does not mask a missing one", () => {
    const f = findUnboundedListReads(
      db(
        `const a = await x.from("r").select("*").order("c").limit(5);\n` +
          `const b = await x.from("u").select("*").order("c");`,
      ),
    );
    expect(f).toHaveLength(1);
    expect(f[0].line).toBe(2);
  });

  it("does NOT scan a file outside the DB layer", () => {
    const notDb: SourceModule = {
      path: "src/lib/reviews/analytics.ts",
      src: `const r = rows.order("c");`,
    };
    expect(findUnboundedListReads(notDb)).toEqual([]);
  });
});

// ── 3. Helpers ─────────────────────────────────────────────────────────────────

describe("performance-audit helpers", () => {
  it("isServerOnlySpecifier classifies packages, prefixes, and node builtins", () => {
    for (const p of SERVER_ONLY_PACKAGES) expect(isServerOnlySpecifier(p)).toBe(true);
    for (const p of SERVER_ONLY_IMPORT_PREFIXES) {
      expect(isServerOnlySpecifier(`${p}something`)).toBe(true);
    }
    for (const b of NODE_BUILTINS) {
      expect(isServerOnlySpecifier(b)).toBe(true);
      expect(isServerOnlySpecifier(`node:${b}`)).toBe(true);
    }
    // Client-safe specifiers.
    expect(isServerOnlySpecifier("@/lib/auth/actions")).toBe(false);
    expect(isServerOnlySpecifier("@/lib/validation/limits")).toBe(false);
    expect(isServerOnlySpecifier("next/link")).toBe(false);
    expect(isServerOnlySpecifier("next/navigation")).toBe(false);
    expect(isServerOnlySpecifier("react")).toBe(false);
  });

  it("isTypeOnlyImport recognizes `import type` and all-type brace clauses", () => {
    expect(isTypeOnlyImport("type", "{ A }")).toBe(true);
    expect(isTypeOnlyImport("", "{ type A, type B }")).toBe(true);
    expect(isTypeOnlyImport("", "{ type A, b }")).toBe(false);
    expect(isTypeOnlyImport("", "{ A }")).toBe(false);
    expect(isTypeOnlyImport("", "Default")).toBe(false);
  });

  it("isClientModule detects the directive, tolerating a leading comment", () => {
    expect(isClientModule(`"use client";\nimport x from "y";`)).toBe(true);
    expect(isClientModule(`'use client';`)).toBe(true);
    expect(isClientModule(`/* header */\n"use client";`)).toBe(true);
    expect(isClientModule(`import x from "y";`)).toBe(false);
    // A "use client" string that is not the leading directive is not a client module.
    expect(isClientModule(`const s = "use client";`)).toBe(false);
  });

  it("auditModule and auditPerformance aggregate across kinds", () => {
    const bad: SourceModule = {
      path: "src/lib/db/x.tsx", // .tsx under db to trip img + query from one file
      src:
        `"use client";\n` +
        `import { q } from "@/lib/db/queries";\n` +
        `const A = () => <img src="/a.png" alt="a" />;\n` +
        `const r = x.from("u").select("*").order("c");\n`,
    };
    const kinds = auditModule(bad).map((f) => f.kind);
    expect(kinds).toContain("server-import-in-client");
    expect(kinds).toContain("unoptimized-image");
    expect(kinds).toContain("unbounded-list-read");

    const audit = auditPerformance([bad]);
    expect(audit.clean).toBe(false);
    expect(audit.findings.length).toBe(kinds.length);
  });
});

// ── 4. This day's real query fix ───────────────────────────────────────────────

describe("Day 67 query fix — tenant list reads are bounded", () => {
  const queriesSrc = readFileSync(
    `${repoRoot}src/lib/db/queries.ts`,
    "utf8",
  );

  it("exposes a documented scan-guard constant well above the stated team size", () => {
    expect(MAX_TENANT_LIST_SCAN).toBe(1000);
  });

  it("listUsersByCompany and listInvitationsByCompany now carry a .limit()", () => {
    const mod: SourceModule = { path: "src/lib/db/queries.ts", src: queriesSrc };
    // The whole DB layer is clean of unbounded ordered reads after the fix.
    expect(findUnboundedListReads(mod)).toEqual([]);
    // And both helpers reference the scan-guard default.
    expect(queriesSrc).toMatch(/listUsersByCompany[\s\S]*?MAX_TENANT_LIST_SCAN/);
    expect(queriesSrc).toMatch(/listInvitationsByCompany[\s\S]*?MAX_TENANT_LIST_SCAN/);
  });
});
