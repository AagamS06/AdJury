import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ENV_VAR_POSTURE,
  SECRET_MODULE_PATHS,
  postureForEnvVar,
  exposureFromName,
  parseEnvFile,
  envValueLooksLikeSecret,
  auditEnvExample,
  hasUseClientDirective,
  hasUseServerDirective,
  findLocalImportSpecifiers,
  findServerEnvReads,
  resolveLocalImport,
  buildModuleGraph,
  auditClientBundle,
  auditGitignore,
  type SourceModule,
} from "@/lib/security/secrets-audit";

/**
 * Secrets audit (DailyPlan Day 46 — Week 7 security pass).
 *
 * "Confirm no service-role key or AI key reaches the client bundle;
 *  `.env.example` complete. DoD: secrets server-only; documented."
 *
 * Part 1 reconciles the env-var inventory with the committed `.env.example`.
 * Part 2 walks the REAL module graph from every `"use client"` entry and proves
 * no client-reachable module imports a secret module or reads a server-only env
 * var. Part 3 checks `.gitignore`. Part 4 proves the scanner genuinely catches a
 * bad module / file — otherwise the clean results prove nothing.
 */

// ── Load real repo files ─────────────────────────────────────────────────────

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(`${repoRoot}${rel}`, "utf8");

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
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const srcModules = loadSrcModules();
const graph = buildModuleGraph(srcModules);
const bundle = auditClientBundle(graph);

// ── Part 1: env inventory ⇄ .env.example ─────────────────────────────────────

describe("secrets audit — .env.example completeness", () => {
  const exampleText = read(".env.example");

  it("documents exactly the inventoried env vars (no missing, no stale)", () => {
    const audit = auditEnvExample(exampleText);
    expect(audit.missingFromExample, "inventoried vars absent from .env.example").toEqual([]);
    expect(audit.extraInExample, ".env.example vars absent from the inventory").toEqual([]);
  });

  it("each var's NEXT_PUBLIC_ prefix matches its declared exposure", () => {
    const audit = auditEnvExample(exampleText);
    expect(audit.exposureMismatches).toEqual([]);
    // And spell out the two credentials the DoD names: server-only, no prefix.
    expect(postureForEnvVar("SUPABASE_SERVICE_ROLE_KEY")).toMatchObject({
      exposure: "server",
      secret: true,
    });
    expect(postureForEnvVar("AI_API_KEY")).toMatchObject({
      exposure: "server",
      secret: true,
    });
    expect(exposureFromName("SUPABASE_SERVICE_ROLE_KEY")).toBe("server");
    expect(exposureFromName("AI_API_KEY")).toBe("server");
    expect(exposureFromName("NEXT_PUBLIC_SUPABASE_ANON_KEY")).toBe("public");
  });

  it("commits no real secret values — only placeholders", () => {
    const audit = auditEnvExample(exampleText);
    expect(audit.secretValueLeaks).toEqual([]);
    expect(audit.duplicateKeys).toEqual([]);
  });

  it("the inventory lists exactly the two credentials as secret", () => {
    const secrets = ENV_VAR_POSTURE.filter((e) => e.secret).map((e) => e.name).sort();
    expect(secrets).toEqual(["AI_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"]);
    // Every secret is server-only (a credential can never be NEXT_PUBLIC_).
    for (const e of ENV_VAR_POSTURE) {
      if (e.secret) expect(e.exposure, `${e.name} is server-only`).toBe("server");
    }
  });
});

// ── Part 2: client-bundle secret-leak scan over the real graph ───────────────

describe("secrets audit — no secret reaches the client bundle", () => {
  it("discovers the module graph and the client entries (scanner is not empty)", () => {
    expect(srcModules.length).toBeGreaterThan(40);
    const clientEntries = [...graph.values()].filter((m) => m.isClient);
    expect(clientEntries.length).toBeGreaterThanOrEqual(10);
    // The known secret modules are actually present as graph nodes.
    for (const p of SECRET_MODULE_PATHS) {
      expect(graph.has(p), `${p} is a known module`).toBe(true);
    }
  });

  it("resolves every local import in the graph (no silent gaps)", () => {
    const unresolved = srcModules
      .map((m) => ({ path: m.path, specs: graph.get(m.path)!.unresolved }))
      .filter((m) => m.specs.length > 0);
    expect(unresolved, `unresolved local imports: ${JSON.stringify(unresolved)}`).toEqual([]);
  });

  it("flags NO secret-module import or server env read in the client bundle", () => {
    expect(
      bundle.leaks,
      `client-bundle secret leaks: ${JSON.stringify(bundle.leaks, null, 2)}`,
    ).toEqual([]);
  });

  it("the secret modules are NOT in the client-reachable set", () => {
    for (const p of SECRET_MODULE_PATHS) {
      expect(bundle.reachable, `${p} must not be client-reachable`).not.toContain(p);
    }
  });

  it("server-action modules are reached as boundaries, not bundled", () => {
    // The client forms import @/lib/{auth,company}/actions ("use server"); those
    // are RPC boundaries — present as boundaries, absent from the bundle, so the
    // service-role key they transitively use never ships to the browser.
    expect(bundle.boundaries).toContain("src/lib/company/actions.ts");
    expect(bundle.boundaries).toContain("src/lib/auth/actions.ts");
    for (const b of bundle.boundaries) {
      expect(bundle.reachable, `${b} boundary is not bundled`).not.toContain(b);
    }
  });
});

// ── Part 3: .gitignore keeps real secret files out of the repo ───────────────

describe("secrets audit — .gitignore", () => {
  it("ignores .env.local and the bare .env", () => {
    const audit = auditGitignore(read(".gitignore"));
    expect(audit.ignoresEnvLocal).toBe(true);
    expect(audit.ignoresEnvFile).toBe(true);
  });
});

// ── Part 4: scanner sensitivity (it genuinely rejects bad input) ─────────────

describe("secrets audit — scanner sensitivity", () => {
  it("flags a client module that imports a secret module", () => {
    const bad: SourceModule[] = [
      {
        path: "src/components/evil.tsx",
        src: `"use client";\nimport { serverClient } from "@/lib/db/supabase";\nexport function Evil() { return serverClient(); }`,
      },
      // Minimal stand-ins so the specifier resolves to a known secret module.
      { path: "src/lib/db/supabase.ts", src: `export function serverClient() {}` },
    ];
    const g = buildModuleGraph(bad);
    const result = auditClientBundle(g);
    expect(result.leaks).toHaveLength(1);
    expect(result.leaks[0].path).toBe("src/components/evil.tsx");
    expect(result.leaks[0].secretImports).toEqual(["src/lib/db/supabase.ts"]);
  });

  it("flags a client-reachable module that reads a server-only env var directly", () => {
    const bad: SourceModule[] = [
      {
        path: "src/components/leaky.tsx",
        src: `"use client";\nimport { key } from "@/lib/helper";\nexport const K = key;`,
      },
      {
        path: "src/lib/helper.ts",
        src: `export const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env["AI_API_KEY"];`,
      },
    ];
    const result = auditClientBundle(buildModuleGraph(bad));
    expect(result.leaks).toHaveLength(1);
    expect(result.leaks[0].path).toBe("src/lib/helper.ts");
    expect(result.leaks[0].serverEnvReads).toEqual([
      "AI_API_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]);
  });

  it("does NOT flag a NEXT_PUBLIC_ env read in client code", () => {
    const ok: SourceModule[] = [
      {
        path: "src/components/fine.tsx",
        src: `"use client";\nexport const U = process.env.NEXT_PUBLIC_SUPABASE_URL;`,
      },
    ];
    const result = auditClientBundle(buildModuleGraph(ok));
    expect(result.leaks).toEqual([]);
  });

  it("stops at a 'use server' boundary — the secret behind it is not bundled", () => {
    const mods: SourceModule[] = [
      {
        path: "src/components/form.tsx",
        src: `"use client";\nimport { act } from "@/lib/actions";\nexport function Form() { return act; }`,
      },
      {
        path: "src/lib/actions.ts",
        src: `"use server";\nimport { serverClient } from "@/lib/db/supabase";\nexport async function act() { return serverClient(); }`,
      },
      { path: "src/lib/db/supabase.ts", src: `export function serverClient() {}` },
    ];
    const result = auditClientBundle(buildModuleGraph(mods));
    // The action is a boundary; neither it nor the secret module is bundled, so
    // no leak — even though the action itself imports the secret module.
    expect(result.leaks).toEqual([]);
    expect(result.boundaries).toContain("src/lib/actions.ts");
    expect(result.reachable).not.toContain("src/lib/db/supabase.ts");
  });

  it("envValueLooksLikeSecret: catches real keys, passes placeholders", () => {
    // Real-shaped values.
    expect(envValueLooksLikeSecret("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abc123")).toBe(true);
    expect(envValueLooksLikeSecret("sk-ant-api03-AbCdEf0123456789")).toBe(true);
    expect(envValueLooksLikeSecret("gsk_AbCdEf0123456789xyz")).toBe(true);
    expect(envValueLooksLikeSecret("A".repeat(48))).toBe(true);
    // Placeholders / config values from the real example file.
    expect(envValueLooksLikeSecret("your-service-role-key")).toBe(false);
    expect(envValueLooksLikeSecret("your-anon-key")).toBe(false);
    expect(envValueLooksLikeSecret("https://your-project.supabase.co")).toBe(false);
    expect(envValueLooksLikeSecret("http://localhost:3000")).toBe(false);
    expect(envValueLooksLikeSecret("anthropic")).toBe(false);
    expect(envValueLooksLikeSecret("claude-haiku-4-5")).toBe(false);
    expect(envValueLooksLikeSecret("0.2")).toBe(false);
    expect(envValueLooksLikeSecret("")).toBe(false);
  });

  it("auditEnvExample catches a committed secret, a stale key, and a mislabeled one", () => {
    const bad = [
      "NEXT_PUBLIC_APP_URL=http://localhost:3000",
      "NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig_here_x",
      "SUPABASE_SERVICE_ROLE_KEY=your-service-role-key",
      "AI_PROVIDER=anthropic",
      "AI_API_KEY=",
      "AI_MODEL=claude-haiku-4-5",
      "AI_TEMPERATURE=0.2",
      "LEFTOVER_KEY=something",
    ].join("\n");
    const audit = auditEnvExample(bad);
    // A real JWT committed as the anon-key value is caught.
    expect(audit.secretValueLeaks.map((l) => l.key)).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    // The undeclared key is flagged as stale.
    expect(audit.extraInExample).toContain("LEFTOVER_KEY");
  });

  it("parseEnvFile skips comments/blanks and strips surrounding quotes", () => {
    const parsed = parseEnvFile([
      "# a comment",
      "",
      "FOO=bar",
      '  QUOTED="hello world"  ',
      "NOT_A_PAIR",
    ].join("\n"));
    expect(parsed).toEqual([
      { key: "FOO", value: "bar", line: 3 },
      { key: "QUOTED", value: "hello world", line: 4 },
    ]);
  });

  it("directive detection: recognizes use client / use server past comments", () => {
    expect(hasUseClientDirective(`"use client";\nexport {}`)).toBe(true);
    expect(hasUseClientDirective(`// banner\n"use client";`)).toBe(true);
    expect(hasUseServerDirective(`"use server";`)).toBe(true);
    expect(hasUseClientDirective(`export const x = "use client";`)).toBe(false);
    expect(hasUseServerDirective(`const s = 1;\n"use server";`)).toBe(false);
  });

  it("findLocalImportSpecifiers: only app-owned specifiers, not third-party", () => {
    const src = `
      import React from "react";
      import { x } from "@/lib/x";
      import { y } from "./y";
      import { z } from "../z";
      import type { T } from "@/types/db";
      import Anthropic from "@anthropic-ai/sdk";
      export { a } from "@/lib/a";
    `;
    expect(findLocalImportSpecifiers(src).sort()).toEqual([
      "../z",
      "./y",
      "@/lib/a",
      "@/lib/x",
      "@/types/db",
    ]);
  });

  it("findServerEnvReads: server vars only, public prefix excluded", () => {
    const src = `
      const a = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const b = process.env["AI_API_KEY"];
      const c = process.env.NEXT_PUBLIC_SUPABASE_URL;
    `;
    expect(findServerEnvReads(src).sort()).toEqual(["AI_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"]);
  });

  it("resolveLocalImport: alias, relative, index, and third-party", () => {
    const known = new Set([
      "src/lib/x.ts",
      "src/lib/sub/index.tsx",
      "src/lib/auth/provisioning.ts",
    ]);
    expect(resolveLocalImport("src/app/page.tsx", "@/lib/x", known)).toBe("src/lib/x.ts");
    expect(resolveLocalImport("src/app/page.tsx", "@/lib/sub", known)).toBe("src/lib/sub/index.tsx");
    expect(resolveLocalImport("src/lib/auth/actions.ts", "./provisioning", known)).toBe(
      "src/lib/auth/provisioning.ts",
    );
    expect(resolveLocalImport("src/app/page.tsx", "react", known)).toBeNull();
    expect(resolveLocalImport("src/app/page.tsx", "@/lib/missing", known)).toBeNull();
  });
});
