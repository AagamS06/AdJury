import { describe, it, expect, vi, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  KEY_EVENTS,
  KEY_EVENT_NAMES,
  MONITORING_ENV,
  keyEventSpec,
  trackEvent,
  setAnalyticsSink,
  getAnalyticsSink,
  monitoringEnvState,
  type AnalyticsEvent,
} from "@/lib/observability/monitoring";
import {
  findTrackedEvents,
  auditKeyEventEmission,
  auditCatalogProps,
  buildMonitoringReadiness,
  reconcileMonitoring,
} from "@/lib/observability/monitoring-audit";
import { REDACTED_KEYS } from "@/lib/observability/logger";
import type { SourceFile } from "@/lib/observability/logging-audit";
import {
  ENV_VAR_POSTURE,
  postureForEnvVar,
} from "@/lib/security/secrets-audit";
import { PROD_ENV_REQUIREMENTS } from "@/lib/deploy/prod-config";

/**
 * Prod monitoring (DailyPlan Day 81, Week 12). Proves the DoD — "errors and key
 * events are visible" — as offline-verifiable invariants: the product-analytics
 * seam redacts like the logger and forwards to the sink, and the key-event
 * catalog reconciles against the real source tree (every event emitted where the
 * catalog says; no un-catalogued emission). Mirrors the Day 43-80 "seam + pure
 * core + static audit over real source + drift guard + planted-bad" shape.
 */

// ── Load every src/**/*.ts(x) file from disk ─────────────────────────────────

const srcDir = fileURLToPath(new URL("../src", import.meta.url));

function loadSrcFiles(): SourceFile[] {
  const out: SourceFile[] = [];
  function walk(dir: string, rel: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = `${dir}/${entry.name}`;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, relPath);
      else if (/\.tsx?$/.test(entry.name))
        out.push({ path: relPath, src: readFileSync(abs, "utf8") });
    }
  }
  walk(srcDir, "");
  return out;
}

const SRC_FILES = loadSrcFiles();
const REAL_EMISSION = auditKeyEventEmission(SRC_FILES);

afterEach(() => {
  setAnalyticsSink(null);
  vi.restoreAllMocks();
});

// ── Part 1: the key-event catalog ────────────────────────────────────────────

describe("monitoring — key-event catalog", () => {
  it("is non-empty with unique names and a source + props for each", () => {
    expect(KEY_EVENTS.length).toBeGreaterThanOrEqual(4);
    const names = KEY_EVENTS.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length); // unique
    expect(KEY_EVENT_NAMES.size).toBe(names.length);
    for (const spec of KEY_EVENTS) {
      expect(spec.source).toMatch(/^lib\/.+\.tsx?$/);
      expect(spec.title.trim().length).toBeGreaterThan(0);
      expect(spec.props.length).toBeGreaterThan(0);
    }
  });

  it("looks up a spec by name", () => {
    expect(keyEventSpec("review_completed")?.source).toBe(
      "lib/reviews/create-review.ts",
    );
    expect(keyEventSpec("not_an_event")).toBeUndefined();
  });

  it("declares no content/secret-shaped prop (can't invite a leak)", () => {
    // The guard is meaningful only if the denylist it checks is real.
    expect(REDACTED_KEYS.has("content")).toBe(true);
    expect(REDACTED_KEYS.has("email")).toBe(true);
    expect(auditCatalogProps()).toEqual([]);
  });
});

// ── Part 2: the product-analytics seam ───────────────────────────────────────

describe("monitoring — trackEvent seam", () => {
  it("redacts content/secret props before logging OR forwarding (Rules.md §3/§6)", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const captured: AnalyticsEvent[] = [];
    setAnalyticsSink({ capture: (e) => captured.push(e) });

    const event = trackEvent("review_completed", {
      companyId: "c-1",
      reviewId: "r-1",
      content: "Buy our miracle cure now — call 555-0100",
      apiKey: "sk-ant-secretshouldnotappear",
      verdict: "pass",
    });

    // IDs/enums pass through; content + credential are redacted.
    expect(event.props.companyId).toBe("c-1");
    expect(event.props.verdict).toBe("pass");
    expect(event.props.content).toBe("[redacted]");
    const blob = JSON.stringify({ event, calls: info.mock.calls, captured });
    expect(blob).not.toContain("miracle cure");
    expect(blob).not.toContain("555-0100");
    expect(blob).not.toContain("secretshouldnotappear");

    // The event was both logged (one info line for this event) and forwarded.
    expect(info.mock.calls.some(([msg]) => msg === "event:review_completed")).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0].name).toBe("review_completed");
  });

  it("round-trips the sink register and clears it with null", () => {
    expect(getAnalyticsSink()).toBeNull();
    const sink = { capture: () => {} };
    setAnalyticsSink(sink);
    expect(getAnalyticsSink()).toBe(sink);
    setAnalyticsSink(null);
    expect(getAnalyticsSink()).toBeNull();
  });

  it("a throwing sink never breaks the caller (the log line still recorded it)", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    setAnalyticsSink({
      capture: () => {
        throw new Error("provider down");
      },
    });
    expect(() => trackEvent("account_created", { userId: "u-1" })).not.toThrow();
  });

  it("is a no-op sink by default (offline build) yet still returns the event", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const event = trackEvent("invitation_sent", { companyId: "c-1", role: "member" });
    expect(event.name).toBe("invitation_sent");
    expect(event.props.role).toBe("member");
  });
});

describe("monitoring — env state (pure, no process.env read)", () => {
  it("reports a provider configured only when its var is a non-blank value", () => {
    expect(
      monitoringEnvState({
        [MONITORING_ENV.errorDsn]: "https://k@o0.ingest.example.com/0",
        [MONITORING_ENV.analyticsKey]: "  ",
      }),
    ).toEqual({ errorMonitorConfigured: true, analyticsConfigured: false });

    expect(monitoringEnvState({})).toEqual({
      errorMonitorConfigured: false,
      analyticsConfigured: false,
    });
  });
});

// ── Part 3: emission audit over the real source tree ─────────────────────────

describe("monitoring audit — key events are emitted where the catalog says", () => {
  it("found a non-trivial source tree to scan", () => {
    expect(SRC_FILES.length).toBeGreaterThan(40);
  });

  it("is clean over the real tree (every catalogued event emitted, no drift)", () => {
    expect(REAL_EMISSION.missingSources).toEqual([]);
    expect(REAL_EMISSION.notEmitted).toEqual([]);
    expect(REAL_EMISSION.undeclaredEmissions).toEqual([]);
    expect(REAL_EMISSION.clean).toBe(true);
  });

  it("each catalog source exists on disk and emits exactly its event", () => {
    for (const spec of KEY_EVENTS) {
      const file = SRC_FILES.find((f) => f.path === spec.source);
      expect(file, `catalog source missing on disk: ${spec.source}`).toBeDefined();
      expect(findTrackedEvents(file!.src)).toContain(spec.name);
    }
  });
});

describe("monitoring audit — scanner catches drift", () => {
  it("finds trackEvent calls and ignores comments + the function definition form", () => {
    expect(findTrackedEvents(`trackEvent("review_completed", { x: 1 })`)).toEqual([
      "review_completed",
    ]);
    expect(findTrackedEvents(`trackEvent('account_created')`)).toEqual([
      "account_created",
    ]);
    // Commented-out calls can't hide or trigger.
    expect(findTrackedEvents(`// trackEvent("sneaky")`)).toEqual([]);
    expect(findTrackedEvents(`/* trackEvent("sneaky") */`)).toEqual([]);
    // The definition signature (no string literal arg) is not a call.
    expect(findTrackedEvents(`export function trackEvent(name: KeyEventName) {}`)).toEqual(
      [],
    );
  });

  it("flags a catalog event whose source file is absent", () => {
    const result = auditKeyEventEmission([]); // no files at all
    expect(result.missingSources.length).toBe(KEY_EVENTS.length);
    expect(result.clean).toBe(false);
  });

  it("flags a catalog event present-but-not-emitted", () => {
    const files: SourceFile[] = KEY_EVENTS.map((spec, i) => ({
      path: spec.source,
      // Strip the emission from exactly one source.
      src: i === 0 ? "export const x = 1;" : `trackEvent("${spec.name}")`,
    }));
    const result = auditKeyEventEmission(files);
    expect(result.notEmitted).toEqual([KEY_EVENTS[0].name].sort());
    expect(result.clean).toBe(false);
  });

  it("flags a trackEvent call for an un-catalogued event name", () => {
    const files: SourceFile[] = [
      ...KEY_EVENTS.map((spec) => ({ path: spec.source, src: `trackEvent("${spec.name}")` })),
      { path: "lib/reviews/new-thing.ts", src: `trackEvent("mystery_event")` },
    ];
    const result = auditKeyEventEmission(files);
    expect(result.undeclaredEmissions).toEqual([
      { path: "lib/reviews/new-thing.ts", name: "mystery_event" },
    ]);
    expect(result.clean).toBe(false);
  });
});

// ── Part 4: readiness + reconcile ────────────────────────────────────────────

describe("monitoring — readiness report", () => {
  const readiness = buildMonitoringReadiness({
    emission: REAL_EMISSION,
    errorMonitorConfigured: false,
    analyticsConfigured: false,
  });

  it("marks the offline items ready and leaves the provider wiring manual", () => {
    expect(readiness.ready).toBe(true);
    expect(readiness.manualSteps).toBe(2); // error-monitor-prod + analytics-prod
    const byId = new Map(readiness.items.map((i) => [i.id, i.status]));
    expect(byId.get("analytics-seam")).toBe("ready");
    expect(byId.get("key-event-emission")).toBe("ready");
    expect(byId.get("error-monitor-seam")).toBe("ready");
    expect(byId.get("error-monitor-prod")).toBe("manual");
    expect(byId.get("analytics-prod")).toBe("manual");
    for (const item of readiness.items) {
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.detail.length).toBeGreaterThan(0);
    }
  });

  it("drops offline readiness when key-event emission drifts", () => {
    const dirty = buildMonitoringReadiness({
      emission: { ...REAL_EMISSION, notEmitted: ["review_completed"], clean: false },
      errorMonitorConfigured: true,
      analyticsConfigured: true,
    });
    expect(dirty.ready).toBe(false);
  });
});

describe("monitoring — reconcile drift guard", () => {
  it("is clean over the real catalog + env inventory", () => {
    const r = reconcileMonitoring({ emission: REAL_EMISSION });
    expect(r.catalogNonEmpty).toBe(true);
    expect(r.emissionClean).toBe(true);
    expect(r.catalogPropsClean).toBe(true);
    expect(r.envDeclared).toBe(true);
    expect(r.envNonSecretServer).toBe(true);
    expect(r.clean).toBe(true);
  });

  it("fails when the emission audit is dirty", () => {
    const r = reconcileMonitoring({
      emission: { ...REAL_EMISSION, missingSources: ["account_created"], clean: false },
    });
    expect(r.clean).toBe(false);
  });
});

// ── Part 5: the monitoring env vars are inventoried as non-secret server config ─

describe("monitoring — env vars tie into the Day-46 inventory & Day-78 prod config", () => {
  it("both monitoring vars are inventoried as server-side, non-secret ingest config", () => {
    for (const name of [MONITORING_ENV.errorDsn, MONITORING_ENV.analyticsKey]) {
      const posture = postureForEnvVar(name);
      expect(posture, `${name} must be inventoried`).toBeDefined();
      expect(posture!.exposure).toBe("server");
      expect(posture!.secret).toBe(false); // a DSN / public key is not a credential
    }
    // Not accidentally counted among the app's real credentials.
    const secretNames = ENV_VAR_POSTURE.filter((e) => e.secret).map((e) => e.name);
    expect(secretNames).not.toContain(MONITORING_ENV.errorDsn);
    expect(secretNames).not.toContain(MONITORING_ENV.analyticsKey);
  });

  it("both appear in the prod env surface on the Vercel surface (recommended)", () => {
    for (const name of [MONITORING_ENV.errorDsn, MONITORING_ENV.analyticsKey]) {
      const req = PROD_ENV_REQUIREMENTS.find((e) => e.name === name);
      expect(req, `${name} must be in the prod env surface`).toBeDefined();
      expect(req!.surface).toBe("vercel");
      expect(req!.need).toBe("recommended");
    }
  });
});
