/**
 * Observability — redacted structured logging + error-monitoring hooks
 * (DailyPlan Day 48, Week 7 security & cost pass).
 *
 * "Redacted structured logging + error-monitoring hooks.
 *  DoD: errors traceable without leaking content/secrets."
 *
 * Before Day 48, failure logging was ~17 hand-rolled `console.error/​warn` call
 * sites, each assembling its own `{ op, …ids, message }` bag by discipline. That
 * is traceable only as long as every author remembers the discipline, and one
 * future call site logging `err` or the submitted content verbatim would leak it.
 *
 * This module makes the redaction a **property of the sink**, not of each call
 * site: every structured log flows through {@link redactLogContext}, which
 *   1. drops the value of any **content/secret-shaped key** (an allow-by-omission
 *      denylist — IDs/counts/enums pass, content/credentials never do),
 *   2. masks any **secret-shaped value** at any key (reusing the Day-46
 *      `envValueLooksLikeSecret` heuristic — a JWT / `sk-` / high-entropy token),
 *   3. **truncates** over-long strings (a bound against an accidental content
 *      blob), and recurses objects/arrays with a depth cap.
 *
 * The record carries a `level`, an ISO `ts`, the `event` name, and the redacted
 * `context` (op + tenant/review/juror IDs) so a failure is **traceable** — you
 * can find it by event + company + review — without the content ever landing in
 * the logs (Rules.md §3 "no PII harvesting" / §6 "redact user content/secrets").
 *
 * **Error-monitoring hook.** {@link setErrorMonitor} registers a sink (a Sentry/
 * Datadog adapter in production) that receives every `error`-level record — the
 * same redacted record, so the monitor can never receive content/secrets either.
 * The default is offline/no-op, so the app runs with no credential (the adapter
 * is a documented, infra-gated seam — see README "Blocked / needs credentials").
 */

import { envValueLooksLikeSecret } from "@/lib/security/secrets-audit";

// ── Record shape ─────────────────────────────────────────────────────────────

export type LogLevel = "info" | "warn" | "error";

/** A flat bag of structured fields. Values are redacted before they are logged. */
export type LogContext = Record<string, unknown>;

/** A structured, already-redacted log record. */
export interface LogRecord {
  level: LogLevel;
  /** A short, stable event name (e.g. "review persistence failed"). */
  event: string;
  /** ISO-8601 timestamp (UTC). */
  ts: string;
  /** Redacted structured context (IDs, counts, enums — never content/secrets). */
  context: LogContext;
}

// ── Redaction ────────────────────────────────────────────────────────────────

/**
 * Keys whose **value** is dropped regardless of content. Matched case-insensitively
 * against the exact key name (not a substring — so `authUserId` / `reviewId` are
 * NOT caught by `auth` / `id`). This is the content/secret surface the app could
 * plausibly hold: the submitted ad copy, model prompts/outputs, the brand/business
 * guides, credentials, and session material. IDs, counts, scores, enums, and an
 * error `message` are deliberately absent, so they pass through for traceability.
 */
export const REDACTED_KEYS: ReadonlySet<string> = new Set(
  [
    // User content / model I/O
    "content",
    "content_text",
    "contentText",
    "text",
    "body",
    "prompt",
    "prompts",
    "promptText",
    "systemPrompt",
    "userPrompt",
    "messages",
    "completion",
    "output",
    "rawOutput",
    "raw",
    "suggested_rewrite",
    "suggestedRewrite",
    "rewrite",
    "feedback_text",
    "feedbackText",
    "issues",
    "excerpt",
    // Brand / business context (bounded summaries are still context — never log)
    "tone_guide_text",
    "toneGuide",
    "guide",
    "brand_summary",
    "brandSummary",
    "brand_context",
    "brandContext",
    "business_summary",
    "businessSummary",
    "business_context",
    "businessContext",
    // Credentials / session / PII
    "apiKey",
    "api_key",
    "token",
    "tokenHash",
    "accessToken",
    "refreshToken",
    "authorization",
    "password",
    "secret",
    "serviceRoleKey",
    "service_role_key",
    "anonKey",
    "anon_key",
    "cookie",
    "bearer",
    "credential",
    "credentials",
    "jwt",
    "email",
  ].map((k) => k.toLowerCase()),
);

export const REDACTED_VALUE = "[redacted]";
export const REDACTED_SECRET_VALUE = "[redacted:secret]";
export const REDACTED_DEPTH_VALUE = "[redacted:depth]";

/** Strings longer than this are truncated (bounds an accidental content blob). */
export const MAX_LOG_STRING = 512;
/** Recursion depth cap for nested context objects/arrays. */
export const MAX_LOG_DEPTH = 4;
/** Array length cap (bounds a huge collection sneaking into a log line). */
export const MAX_LOG_ARRAY = 50;

function isRedactedKey(key: string): boolean {
  return REDACTED_KEYS.has(key.toLowerCase());
}

/** Truncate + secret-mask a single string value. */
function redactString(value: string): string {
  if (envValueLooksLikeSecret(value)) return REDACTED_SECRET_VALUE;
  if (value.length > MAX_LOG_STRING) {
    return `${value.slice(0, MAX_LOG_STRING)}…(+${value.length - MAX_LOG_STRING} chars)`;
  }
  return value;
}

function redactValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;

  const t = typeof value;
  if (t === "string") return redactString(value as string);
  if (t === "number" || t === "boolean" || t === "bigint") return value;
  if (t === "function" || t === "symbol") return `[${t}]`;

  if (depth >= MAX_LOG_DEPTH) return REDACTED_DEPTH_VALUE;

  // Error → a plain, redactable shape (message can still be truncated/masked).
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
    };
  }

  if (Array.isArray(value)) {
    const out = value
      .slice(0, MAX_LOG_ARRAY)
      .map((v) => redactValue(v, depth + 1));
    if (value.length > MAX_LOG_ARRAY) {
      out.push(`…(+${value.length - MAX_LOG_ARRAY} more)`);
    }
    return out;
  }

  if (t === "object") {
    return redactObject(value as Record<string, unknown>, depth + 1);
  }

  return String(value);
}

function redactObject(
  obj: Record<string, unknown>,
  depth: number,
): LogContext {
  const out: LogContext = {};
  for (const key of Object.keys(obj)) {
    if (isRedactedKey(key)) {
      out[key] = REDACTED_VALUE;
      continue;
    }
    out[key] = redactValue(obj[key], depth);
  }
  return out;
}

/**
 * Redact a log context: drop content/secret-keyed values, mask secret-shaped
 * values anywhere, truncate long strings, and recurse with a depth cap. Pure —
 * returns a fresh object and never mutates the input — so the redaction is
 * unit-testable without a logger.
 */
export function redactLogContext(context: LogContext): LogContext {
  return redactObject(context, 0);
}

/**
 * Normalize an unknown thrown value to a redaction-safe `{ message }` (plus the
 * error class name when available). Replaces the repeated
 * `err instanceof Error ? err.message : "unknown error"` idiom at call sites.
 */
export function errorContext(err: unknown): {
  message: string;
  errorName?: string;
} {
  if (err instanceof Error) {
    return { message: err.message, errorName: err.name };
  }
  return { message: "unknown error" };
}

// ── Error-monitoring hook ────────────────────────────────────────────────────

/**
 * An error-monitoring sink (Sentry/Datadog/… adapter). Receives the SAME redacted
 * record that is logged, so a monitor can never be handed content or secrets.
 */
export interface ErrorMonitor {
  captureError(record: LogRecord): void;
}

let activeMonitor: ErrorMonitor | null = null;

/** Register (or clear, with `null`) the process-wide error monitor. */
export function setErrorMonitor(monitor: ErrorMonitor | null): void {
  activeMonitor = monitor;
}

/** The currently-registered error monitor, or `null` (offline default). */
export function getErrorMonitor(): ErrorMonitor | null {
  return activeMonitor;
}

// ── Emit ─────────────────────────────────────────────────────────────────────

const CONSOLE_METHOD: Record<LogLevel, "info" | "warn" | "error"> = {
  info: "info",
  warn: "warn",
  error: "error",
};

function emit(level: LogLevel, event: string, context?: LogContext): LogRecord {
  const redacted = redactLogContext(context ?? {});
  const record: LogRecord = {
    level,
    event,
    ts: new Date().toISOString(),
    context: redacted,
  };

  // Console sink: the event name + a flat record (context fields at top level so
  // existing `expect(...).objectContaining({ companyId })` assertions still hold).
  // eslint-disable-next-line no-console
  console[CONSOLE_METHOD[level]](event, {
    level: record.level,
    ts: record.ts,
    ...redacted,
  });

  // Error-monitoring hook: forward every error to the registered sink. A monitor
  // must never break the request path, so its failure is swallowed deliberately
  // (the console line above already recorded the original error).
  if (level === "error" && activeMonitor) {
    try {
      activeMonitor.captureError(record);
    } catch {
      // Intentionally ignored — a broken monitor can't be allowed to mask the
      // error it was handed or fail the user's request.
    }
  }

  return record;
}

/** Log an informational structured event (redacted). */
export function logInfo(event: string, context?: LogContext): LogRecord {
  return emit("info", event, context);
}

/** Log a warning structured event (redacted). */
export function logWarn(event: string, context?: LogContext): LogRecord {
  return emit("warn", event, context);
}

/**
 * Log an error structured event (redacted) and forward it to the error monitor.
 * This is the one sink for failure logging across the app — see the module
 * docstring and the logging audit (`logging-audit.ts`).
 */
export function logError(event: string, context?: LogContext): LogRecord {
  return emit("error", event, context);
}
