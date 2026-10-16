/**
 * Logging audit (DailyPlan Day 48 — Week 7 security & cost pass).
 *
 * Companion to `logger.ts`. The redacting logger only protects content/secrets
 * for logs that actually flow through it — a future `console.error(err)` or
 * `console.log(content)` would bypass the redaction entirely. This audit makes
 * that a checkable invariant: **no raw `console.*` may appear in `src/**` except
 * at an explicitly inventoried sink.** A new ad-hoc console call fails the audit
 * until it is either routed through `logError`/`logWarn`/`logInfo` or added to
 * the allowlist with a written reason.
 *
 * Mirrors the Week-7 "inventory + static scanner + drift guard" shape used by
 * Day 43 (`POLICY_POSTURE`), Day 44 (endpoint inventory), Day 45 (audited
 * schemas), Day 46 (env inventory), and Day 47 (`ABUSE_SURFACE_POSTURE`).
 */

import { stripTsComments } from "@/lib/auth/authz-audit";

/** An intentionally-sanctioned raw-`console` sink, with why it is exempt. */
export interface LoggingSink {
  /** Path relative to `src/` with forward slashes, e.g. "lib/ai/cost.ts". */
  path: string;
  /** Why a raw console.* is allowed here instead of the structured logger. */
  reason: string;
}

/**
 * The ONLY `src/**` files permitted to call `console.*` directly. Everything
 * else must log through `logger.ts` so redaction is enforced by construction.
 */
export const ALLOWED_CONSOLE_SINKS: readonly LoggingSink[] = [
  {
    path: "lib/observability/logger.ts",
    reason:
      "The structured logger itself — the single console sink that every " +
      "logError/logWarn/logInfo funnels through after redaction.",
  },
  {
    path: "lib/ai/cost.ts",
    reason:
      "Day-18 redacted usage logger (logReviewUsage): emits only a content-free " +
      "usage record and has its own exact-tested console-info contract.",
  },
  {
    path: "lib/company/actions.ts",
    reason:
      "Deliberate dev-only invitation-email delivery stub — surfaces the invite " +
      "link in the server log while email delivery is stubbed (removed when real " +
      "email ships, see Memory Day 24).",
  },
];

/**
 * Matches a direct console access: `console.error(`, `console . log`, or the
 * dynamic `console[method]` form the logger uses. Deliberately broad so no
 * console reference slips past the scan.
 */
const CONSOLE_RE = /console\s*(?:\.\s*(?:log|info|warn|error|debug|trace)|\[)/;

/** True if the (comment-stripped) source calls `console.*` at least once. */
export function fileUsesConsole(rawSrc: string): boolean {
  return CONSOLE_RE.test(stripTsComments(rawSrc));
}

/** A source file to audit: path relative to `src/` plus its raw contents. */
export interface SourceFile {
  path: string;
  src: string;
}

export interface LoggingAuditResult {
  /** Files using console.* that are NOT an allowlisted sink (must be empty). */
  unsanctioned: string[];
  /** Allowlisted sinks whose file no longer uses console.* (stale entry). */
  staleSinks: string[];
}

/**
 * Audit the given `src/**` files against the console allowlist. Pure — the
 * caller supplies the real file contents — so it is node-testable without a
 * build. Returns the two drift directions: an un-sanctioned console call (a
 * leak risk) and a stale allowlist entry (the exemption is no longer needed).
 */
export function auditLoggingSurface(files: SourceFile[]): LoggingAuditResult {
  const allowed = new Set(ALLOWED_CONSOLE_SINKS.map((s) => s.path));
  const usesConsole = new Set<string>();
  const unsanctioned: string[] = [];

  for (const file of files) {
    if (!fileUsesConsole(file.src)) continue;
    usesConsole.add(file.path);
    if (!allowed.has(file.path)) unsanctioned.push(file.path);
  }

  const staleSinks = [...allowed].filter((p) => !usesConsole.has(p));

  return {
    unsanctioned: unsanctioned.sort(),
    staleSinks: staleSinks.sort(),
  };
}

/** True when the logging surface is clean: no unsanctioned call, no stale sink. */
export function loggingSurfaceClean(result: LoggingAuditResult): boolean {
  return result.unsanctioned.length === 0 && result.staleSinks.length === 0;
}
