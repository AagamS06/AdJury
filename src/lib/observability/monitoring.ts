/**
 * Production monitoring — product-analytics event seam + key-event catalog
 * (DailyPlan Day 81 — Week 12 deploy & launch prep).
 *
 * "Error monitoring + basic product analytics in prod.
 *  DoD: errors and key events are visible."
 *
 * Error monitoring already has its seam: `logger.ts` funnels every `error`-level
 * record to the registered {@link import("./logger").ErrorMonitor}, so a prod
 * Sentry/Datadog adapter sees exactly the redacted record that is logged — it can
 * never receive content or secrets (Day 48). This module is the OTHER half of the
 * DoD — "key events are visible" — plus the prod wiring report that ties both to
 * real config.
 *
 * Two things live here:
 *
 *   1. A PRODUCT-ANALYTICS SEAM that mirrors the error-monitoring one exactly.
 *      {@link trackEvent} emits a key product event — "a review completed", "a
 *      company onboarded" — as a redacted structured `info` log (so it is visible
 *      in the logs with no provider at all) AND forwards it to the registered
 *      {@link AnalyticsSink} (a PostHog/Amplitude/… adapter in prod). It routes
 *      through the logger, so the SAME redaction applies: an analytics event can
 *      never carry the user's content, a model prompt/output, or a secret
 *      (Rules.md §3 "no PII harvesting" / §6 "redact user content/secrets"). The
 *      default sink is offline/no-op, so the app runs with no credential — the
 *      adapter is a documented, infra-gated seam (see docs/MONITORING.md).
 *
 *   2. The KEY-EVENT CATALOG ({@link KEY_EVENTS}) — the single source of truth for
 *      WHICH product events must be visible and WHERE each is emitted. It is the
 *      inventory the Day-81 static audit (`monitoring-audit.ts`) reconciles against
 *      the real source tree, so "key events are visible" is a checkable invariant,
 *      not a hope: a catalog event with no emission site fails, and a stray
 *      `trackEvent("…")` for an un-cataloged name fails too (the same two-way drift
 *      guard as Day 48's logging audit).
 *
 * Everything here is pure except the two process-wide sink registers, so the seam
 * and the catalog are node-testable with no provider, no network, and no build.
 */

import { logInfo, type LogContext, type LogRecord } from "./logger";

// ── Key-event vocabulary ─────────────────────────────────────────────────────

/**
 * The product's "what happened" vocabulary — the key lifecycle events a live
 * deployment must be able to see. Deliberately small ("basic product analytics",
 * per the Day-81 goal): the handful of server-side successes that mark real
 * product value being delivered. Extending it means adding a {@link KeyEventSpec}
 * AND a real emission site — the audit enforces both.
 */
export type KeyEventName =
  | "account_created"
  | "company_onboarded"
  | "review_completed"
  | "invitation_sent";

/** One catalogued key event: its name, a human title, and where it is emitted. */
export interface KeyEventSpec {
  name: KeyEventName;
  /** Short human description for the runbook / dashboards. */
  title: string;
  /**
   * The source module that emits this event, path relative to `src/` with POSIX
   * separators (e.g. "lib/reviews/create-review.ts") — matches the audit's file
   * keys so the catalog can be reconciled against the real tree.
   */
  source: string;
  /**
   * The context keys this event is expected to carry — IDs, counts, enums only,
   * never content/secret-shaped keys (the audit cross-checks this against the
   * logger's redaction denylist so a catalog can't invite a leak).
   */
  props: readonly string[];
}

/**
 * The key-event catalog. Each entry names a real server-side success point. The
 * Day-81 audit proves every one is actually emitted by a `trackEvent("<name>")`
 * call in its declared `source`, and that no other `trackEvent` names exist.
 */
export const KEY_EVENTS: readonly KeyEventSpec[] = [
  {
    name: "account_created",
    title: "A new account + its first company were provisioned at signup.",
    source: "lib/auth/actions.ts",
    props: ["op", "userId"],
  },
  {
    name: "company_onboarded",
    title: "An admin completed company onboarding (name, industry, plan).",
    source: "lib/company/actions.ts",
    props: ["op", "companyId", "planTier", "industry"],
  },
  {
    name: "review_completed",
    title: "A content review ran and was persisted (the core product action).",
    source: "lib/reviews/create-review.ts",
    props: ["op", "companyId", "reviewId", "verdict", "aggregateScore", "jurorsOk", "jurorsError", "isMock"],
  },
  {
    name: "invitation_sent",
    title: "An admin invited a teammate to the company.",
    source: "lib/company/create-invitation.ts",
    props: ["op", "companyId", "invitationId", "role"],
  },
];

/** The set of catalogued event names (for the audit's drift check). */
export const KEY_EVENT_NAMES: ReadonlySet<KeyEventName> = new Set(
  KEY_EVENTS.map((e) => e.name),
);

/** The catalog spec for a name, or undefined if not catalogued. */
export function keyEventSpec(name: string): KeyEventSpec | undefined {
  return KEY_EVENTS.find((e) => e.name === name);
}

// ── Product-analytics sink seam ──────────────────────────────────────────────

/** A redacted product-analytics event, as delivered to the sink. */
export interface AnalyticsEvent {
  name: KeyEventName;
  /** ISO-8601 timestamp (UTC), from the underlying log record. */
  ts: string;
  /** Already-redacted properties (IDs/counts/enums — never content/secrets). */
  props: LogContext;
}

/**
 * A product-analytics sink (a PostHog/Amplitude/… adapter). Receives the SAME
 * redacted event that is logged, so a provider can never be handed content or
 * secrets — exactly like the error-monitoring hook in `logger.ts`.
 */
export interface AnalyticsSink {
  capture(event: AnalyticsEvent): void;
}

let activeSink: AnalyticsSink | null = null;

/** Register (or clear, with `null`) the process-wide product-analytics sink. */
export function setAnalyticsSink(sink: AnalyticsSink | null): void {
  activeSink = sink;
}

/** The currently-registered analytics sink, or `null` (offline default). */
export function getAnalyticsSink(): AnalyticsSink | null {
  return activeSink;
}

/**
 * Emit a key product event. It is made visible two ways:
 *   1. a redacted structured `info` log (`event:<name>`) via the one logger sink,
 *      so a failure or a key event is traceable even with no analytics provider;
 *   2. a forward to the registered {@link AnalyticsSink} (a prod adapter), which
 *      receives the already-redacted props.
 *
 * Routing through {@link logInfo} means the logger's redaction is applied
 * identically: the props are stripped of any content/secret-shaped key, long
 * strings truncated, and secret-shaped values masked, before anything is logged
 * or forwarded. A broken analytics sink can never fail the request path — its
 * throw is swallowed (the log line already recorded the event).
 *
 * Call sites pass only IDs, counts, scores, and enums (see each catalog entry's
 * `props`); never the submitted content, a model prompt/output, or a credential.
 */
export function trackEvent(
  name: KeyEventName,
  props: LogContext = {},
): AnalyticsEvent {
  const record: LogRecord = logInfo(`event:${name}`, props);
  const event: AnalyticsEvent = {
    name,
    ts: record.ts,
    props: record.context,
  };
  if (activeSink) {
    try {
      activeSink.capture(event);
    } catch {
      // Intentionally ignored — a broken analytics provider must never mask the
      // event or fail the user's request (the log line above already recorded it).
    }
  }
  return event;
}

// ── Prod monitoring env config (pure) ────────────────────────────────────────

/**
 * The two env vars that wire the prod monitoring providers. Both are inventoried
 * in the Day-46 `ENV_VAR_POSTURE` (the Day-81 reconcile pins that), and both are
 * NON-secret ingest config by provider design — an error-monitoring DSN and a
 * public product-analytics project key — so neither is a credential that could
 * leak. When either is unset the corresponding sink stays the offline no-op.
 */
export const MONITORING_ENV = {
  /** Error-monitoring ingest DSN (Sentry-style). Non-secret by design. */
  errorDsn: "MONITORING_ERROR_DSN",
  /** Product-analytics public project key (PostHog-style). Non-secret by design. */
  analyticsKey: "PRODUCT_ANALYTICS_KEY",
} as const;

export interface MonitoringEnvState {
  /** True when the error-monitoring DSN is set (prod can wire the adapter). */
  errorMonitorConfigured: boolean;
  /** True when the product-analytics key is set (prod can wire the sink). */
  analyticsConfigured: boolean;
}

/**
 * Report which monitoring providers a given env would wire, from a supplied env
 * record (pure — never reads `process.env`, so it is testable and never pulls a
 * server var into a client bundle). A blank/whitespace value counts as unset.
 */
export function monitoringEnvState(
  env: Record<string, string | undefined>,
): MonitoringEnvState {
  const set = (name: string): boolean => (env[name] ?? "").trim().length > 0;
  return {
    errorMonitorConfigured: set(MONITORING_ENV.errorDsn),
    analyticsConfigured: set(MONITORING_ENV.analyticsKey),
  };
}
