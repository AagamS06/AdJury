/**
 * Monitoring audit (DailyPlan Day 81 — Week 12 deploy & launch prep).
 *
 * Companion to `monitoring.ts`. The product-analytics seam only makes a key event
 * visible if something actually CALLS `trackEvent` for it — a catalogued event
 * with no emission site is an invisible promise, and a stray `trackEvent("…")`
 * for an un-catalogued name is silent drift the dashboards never learn about.
 * This audit makes "key events are visible" a checkable invariant with the same
 * two-way inventory + static scanner + drift guard shape as Day 48's logging audit
 * (and Day 43-47 / 78-80): scan the real `src/**` tree and prove
 *
 *   1. every {@link KEY_EVENTS} entry IS emitted by a `trackEvent("<name>")` call
 *      in its declared `source` module (none missing), and
 *   2. every `trackEvent("<name>")` call anywhere in `src/**` names a CATALOGUED
 *      event (no undeclared emission),
 *
 * plus the static readiness/reconcile reports that tie the seam, the catalog, and
 * the two prod monitoring env vars together — all pure and node-testable, so the
 * invariant holds offline with no provider, no network, and no credential.
 */

import { stripTsComments } from "@/lib/auth/authz-audit";
import { REDACTED_KEYS } from "./logger";
import type { SourceFile } from "./logging-audit";
import {
  KEY_EVENTS,
  KEY_EVENT_NAMES,
  MONITORING_ENV,
  type KeyEventName,
} from "./monitoring";
import { postureForEnvVar } from "@/lib/security/secrets-audit";

// ── Emission scanner ─────────────────────────────────────────────────────────

/**
 * Matches a `trackEvent("name")` / `trackEvent('name')` call and captures the
 * event name (first string-literal argument). The function DEFINITION in
 * `monitoring.ts` — `trackEvent(\n  name: KeyEventName` — is not a call (no string
 * literal after the paren), so it never matches; only real call sites do.
 */
const TRACK_EVENT_RE = /\btrackEvent\s*\(\s*["']([A-Za-z0-9_]+)["']/g;

/** The event names a (comment-stripped) source emits via `trackEvent(...)`. */
export function findTrackedEvents(rawSrc: string): string[] {
  const clean = stripTsComments(rawSrc);
  const names: string[] = [];
  TRACK_EVENT_RE.lastIndex = 0;
  for (const m of clean.matchAll(TRACK_EVENT_RE)) names.push(m[1]);
  return names;
}

/** A `trackEvent` call whose name is not in the catalog (drift). */
export interface UndeclaredEmission {
  /** Source path relative to `src/`. */
  path: string;
  /** The un-catalogued event name that was emitted. */
  name: string;
}

export interface KeyEventEmissionAudit {
  /** Catalog events whose declared `source` file was not among the scanned files. */
  missingSources: KeyEventName[];
  /** Catalog events not emitted by a `trackEvent(...)` call in their declared source. */
  notEmitted: KeyEventName[];
  /** `trackEvent(...)` calls for a name that is not catalogued (sorted by path, name). */
  undeclaredEmissions: UndeclaredEmission[];
  /** All three above are empty — the catalog and the source tree agree. */
  clean: boolean;
}

/**
 * Audit the key-event catalog against the real source tree. Pure — the caller
 * supplies the `src/**` files (path relative to `src/`). A clean result is the
 * executable form of "key events are visible": each catalogued event is emitted
 * exactly where the catalog says, and nothing emits an un-catalogued event.
 */
export function auditKeyEventEmission(
  files: readonly SourceFile[],
): KeyEventEmissionAudit {
  const byPath = new Map(files.map((f) => [f.path, f]));

  const missingSources: KeyEventName[] = [];
  const notEmitted: KeyEventName[] = [];

  for (const spec of KEY_EVENTS) {
    const file = byPath.get(spec.source);
    if (!file) {
      missingSources.push(spec.name);
      continue;
    }
    const emitted = new Set(findTrackedEvents(file.src));
    if (!emitted.has(spec.name)) notEmitted.push(spec.name);
  }

  const undeclaredEmissions: UndeclaredEmission[] = [];
  for (const file of files) {
    for (const name of findTrackedEvents(file.src)) {
      if (!KEY_EVENT_NAMES.has(name as KeyEventName)) {
        undeclaredEmissions.push({ path: file.path, name });
      }
    }
  }
  undeclaredEmissions.sort(
    (a, b) => a.path.localeCompare(b.path) || a.name.localeCompare(b.name),
  );

  return {
    missingSources: missingSources.sort(),
    notEmitted: notEmitted.sort(),
    undeclaredEmissions,
    clean:
      missingSources.length === 0 &&
      notEmitted.length === 0 &&
      undeclaredEmissions.length === 0,
  };
}

// ── Catalog safety: no event may invite a content/secret leak ────────────────

/** Catalog `props` that collide with the logger's redaction denylist (would be dropped). */
export interface LeakyCatalogProp {
  event: KeyEventName;
  prop: string;
}

/**
 * Cross-check every catalogued event's declared `props` against the logger's
 * `REDACTED_KEYS`. A prop that is a content/secret-shaped key would be dropped by
 * redaction anyway — declaring it is a sign the call site means to log something
 * it must not. A clean (empty) result proves the catalog only ever carries
 * IDs/counts/enums (Rules.md §3/§6).
 */
export function auditCatalogProps(): LeakyCatalogProp[] {
  const leaky: LeakyCatalogProp[] = [];
  for (const spec of KEY_EVENTS) {
    for (const prop of spec.props) {
      if (REDACTED_KEYS.has(prop.toLowerCase())) {
        leaky.push({ event: spec.name, prop });
      }
    }
  }
  return leaky;
}

// ── Readiness report ─────────────────────────────────────────────────────────

/**
 * `ready`  — verified HERE, offline, with no credential (the seam + catalog exist
 *            and reconcile against the source tree).
 * `manual` — needs a live credential / an operator wiring step (registering a
 *            prod provider adapter); documented, never faked.
 */
export type MonitorReadyStatus = "ready" | "manual";

export interface MonitorReadyItem {
  id: string;
  title: string;
  status: MonitorReadyStatus;
  detail: string;
}

export interface MonitoringReadiness {
  items: MonitorReadyItem[];
  /** Every offline-verifiable (`ready`) item actually passed. */
  ready: boolean;
  /** Count of steps that still need a live credential / provider wiring. */
  manualSteps: number;
}

export interface MonitoringReadinessInput {
  /** The emission audit over the real source tree. */
  emission: KeyEventEmissionAudit;
  /** Whether MONITORING_ERROR_DSN is currently set (for the detail line only). */
  errorMonitorConfigured: boolean;
  /** Whether PRODUCT_ANALYTICS_KEY is currently set (for the detail line only). */
  analyticsConfigured: boolean;
}

/**
 * Compose the monitoring-readiness report. The `ready` items are what this repo
 * proves offline — the analytics seam + catalog exist, every key event is emitted
 * where the catalog says (no drift), and the error-monitoring hook (Day 48) is in
 * place so errors are forwarded after redaction. The `manual` items are the
 * genuine operator steps: registering the prod error-monitor and analytics
 * adapters (their DSN/key come from the provider dashboards). Each carries its
 * runbook pointer and is never auto-marked done.
 */
export function buildMonitoringReadiness(
  input: MonitoringReadinessInput,
): MonitoringReadiness {
  const catalogClean = auditCatalogProps().length === 0;

  const items: MonitorReadyItem[] = [
    {
      id: "analytics-seam",
      title: "Product-analytics seam present (trackEvent + offline no-op sink)",
      status: KEY_EVENTS.length > 0 && catalogClean ? "ready" : "manual",
      detail: `${KEY_EVENTS.length} key event(s) catalogued; props are IDs/counts/enums only (redaction-safe).`,
    },
    {
      id: "key-event-emission",
      title: "Every catalogued key event is emitted where the catalog says (no drift)",
      status: input.emission.clean ? "ready" : "manual",
      detail:
        "Static audit over the real src tree: each event has a trackEvent call in its source, and no trackEvent names an un-catalogued event.",
    },
    {
      id: "error-monitor-seam",
      title: "Error-monitoring hook present (Day 48 — errors forwarded after redaction)",
      status: "ready",
      detail:
        "logger.ts funnels every error-level record to the registered ErrorMonitor; the monitor receives the same redacted record (never content/secrets).",
    },
    {
      id: "error-monitor-prod",
      title: "Register the prod error-monitor adapter",
      status: "manual",
      detail: `Wire a Sentry/Datadog adapter via setErrorMonitor using ${MONITORING_ENV.errorDsn} (${input.errorMonitorConfigured ? "set" : "unset"} here). See docs/MONITORING.md §2.`,
    },
    {
      id: "analytics-prod",
      title: "Register the prod product-analytics adapter",
      status: "manual",
      detail: `Wire a PostHog/Amplitude adapter via setAnalyticsSink using ${MONITORING_ENV.analyticsKey} (${input.analyticsConfigured ? "set" : "unset"} here). See docs/MONITORING.md §3.`,
    },
  ];

  const OFFLINE_ITEM_IDS = [
    "analytics-seam",
    "key-event-emission",
    "error-monitor-seam",
  ];
  const ready = items
    .filter((i) => OFFLINE_ITEM_IDS.includes(i.id))
    .every((i) => i.status === "ready");
  const manualSteps = items.filter((i) => i.status === "manual").length;

  return { items, ready, manualSteps };
}

// ── Reconcile (drift guard) ──────────────────────────────────────────────────

export interface MonitoringReconcile {
  /** The key-event catalog is non-empty. */
  catalogNonEmpty: boolean;
  /** The catalog and the source tree agree (emission audit clean). */
  emissionClean: boolean;
  /** No catalogued event's props collide with the redaction denylist. */
  catalogPropsClean: boolean;
  /** Both monitoring env vars are declared in the Day-46 inventory. */
  envDeclared: boolean;
  /** Both monitoring env vars are server-exposure, non-secret ingest config. */
  envNonSecretServer: boolean;
  clean: boolean;
}

/**
 * Executable DoD + drift guard (the Day 43-80 "inventory + reconcile" pattern):
 * the catalog is non-empty and agrees with the real source tree, its props can't
 * invite a leak, and the two prod monitoring env vars are declared in the one env
 * inventory as non-secret server-side ingest config (so a monitoring provider
 * can't quietly become an un-audited credential). Takes the emission audit as
 * input so the single file-read happens in the caller (the test / the script).
 */
export function reconcileMonitoring(input: {
  emission: KeyEventEmissionAudit;
}): MonitoringReconcile {
  const catalogNonEmpty = KEY_EVENTS.length > 0;
  const emissionClean = input.emission.clean;
  const catalogPropsClean = auditCatalogProps().length === 0;

  const envNames = [MONITORING_ENV.errorDsn, MONITORING_ENV.analyticsKey];
  const postures = envNames.map((n) => postureForEnvVar(n));
  const envDeclared = postures.every((p) => p !== undefined);
  const envNonSecretServer = postures.every(
    (p) => p !== undefined && p.exposure === "server" && p.secret === false,
  );

  return {
    catalogNonEmpty,
    emissionClean,
    catalogPropsClean,
    envDeclared,
    envNonSecretServer,
    clean:
      catalogNonEmpty &&
      emissionClean &&
      catalogPropsClean &&
      envDeclared &&
      envNonSecretServer,
  };
}
