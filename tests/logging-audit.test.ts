import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_CONSOLE_SINKS,
  auditLoggingSurface,
  fileUsesConsole,
  loggingSurfaceClean,
  type SourceFile,
} from "@/lib/observability/logging-audit";

/**
 * Logging audit (DailyPlan Day 48, Week 7). Proves the DoD invariant structurally:
 * no `src/**` file calls `console.*` directly except an inventoried sink, so every
 * failure log flows through the redacting logger. Mirrors the Day 43-47 "scanner
 * over real source + drift guard + planted-bad" shape.
 */

// ── Load every src/**/*.ts(x) file from disk ─────────────────────────────────

const srcDir = fileURLToPath(new URL("../src", import.meta.url));

function loadSrcFiles(): SourceFile[] {
  const out: SourceFile[] = [];
  function walk(dir: string, rel: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = `${dir}/${entry.name}`;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, relPath);
      } else if (/\.tsx?$/.test(entry.name)) {
        out.push({ path: relPath, src: readFileSync(abs, "utf8") });
      }
    }
  }
  walk(srcDir, "");
  return out;
}

const SRC_FILES = loadSrcFiles();

describe("logging audit — real source tree", () => {
  it("found a non-trivial set of source files to scan", () => {
    expect(SRC_FILES.length).toBeGreaterThan(40);
  });

  it("has no unsanctioned console.* call and no stale allowlist entry", () => {
    const result = auditLoggingSurface(SRC_FILES);
    expect(result.unsanctioned).toEqual([]);
    expect(result.staleSinks).toEqual([]);
    expect(loggingSurfaceClean(result)).toBe(true);
  });

  it("every allowlisted sink actually exists on disk and still uses console", () => {
    for (const sink of ALLOWED_CONSOLE_SINKS) {
      const file = SRC_FILES.find((f) => f.path === sink.path);
      expect(file, `allowlisted sink missing on disk: ${sink.path}`).toBeDefined();
      expect(fileUsesConsole(file!.src)).toBe(true);
      expect(sink.reason.length).toBeGreaterThan(20);
    }
  });

  it("the migrated failure-logging modules no longer call console directly", () => {
    const migrated = [
      "lib/ai/orchestrator.ts",
      "lib/reviews/create-review.ts",
      "lib/reviews/read-reviews.ts",
      "lib/reviews/analytics.ts",
      "lib/company/read-team.ts",
      "lib/company/save-brand-profile.ts",
      "lib/company/create-invitation.ts",
      "lib/company/read-invitations.ts",
      "lib/company/accept-invitation.ts",
      "lib/company/update-role.ts",
      "lib/auth/actions.ts",
      "app/(dashboard)/brand/page.tsx",
      "app/(dashboard)/error.tsx",
      "components/review/copy-button.tsx",
      "components/review/export-button.tsx",
    ];
    for (const path of migrated) {
      const file = SRC_FILES.find((f) => f.path === path);
      expect(file, `expected migrated module on disk: ${path}`).toBeDefined();
      expect(fileUsesConsole(file!.src), `${path} still calls console.*`).toBe(false);
    }
  });
});

// ── Scanner behavior (planted-bad + comment handling) ────────────────────────

describe("logging audit — scanner catches drift", () => {
  it("flags a new module that calls console.* directly", () => {
    const result = auditLoggingSurface([
      { path: "lib/reviews/new-thing.ts", src: "export const x = () => console.log('oops');" },
    ]);
    expect(result.unsanctioned).toContain("lib/reviews/new-thing.ts");
    expect(loggingSurfaceClean(result)).toBe(false);
  });

  it("detects the dynamic console[method] form (the logger's own sink)", () => {
    expect(fileUsesConsole('console["error"]("x")')).toBe(true);
    expect(fileUsesConsole("console[method](event, rec)")).toBe(true);
  });

  it("detects console.warn / console.info / console.debug", () => {
    expect(fileUsesConsole("console.warn('x')")).toBe(true);
    expect(fileUsesConsole("console.info('x')")).toBe(true);
    expect(fileUsesConsole("console.debug('x')")).toBe(true);
  });

  it("does not trip on console inside a comment (commented-out code can't hide)", () => {
    expect(fileUsesConsole("// console.log('debug') left behind")).toBe(false);
    expect(fileUsesConsole("/* console.error(secret) */")).toBe(false);
    expect(fileUsesConsole("const c = 1; // uses logError not console")).toBe(false);
  });

  it("reports a stale allowlist entry when a sanctioned sink stops using console", () => {
    // Simulate the invite stub being migrated away (no console left in it).
    const files: SourceFile[] = ALLOWED_CONSOLE_SINKS.map((s) => ({
      path: s.path,
      src:
        s.path === "lib/company/actions.ts"
          ? "export const x = () => logInfo('invite');"
          : "console.error('still here');",
    }));
    const result = auditLoggingSurface(files);
    expect(result.staleSinks).toContain("lib/company/actions.ts");
    expect(result.unsanctioned).toEqual([]);
  });
});
