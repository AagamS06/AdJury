import { describe, it, expect, vi, afterEach } from "vitest";
import {
  redactLogContext,
  errorContext,
  logInfo,
  logWarn,
  logError,
  setErrorMonitor,
  getErrorMonitor,
  REDACTED_VALUE,
  REDACTED_SECRET_VALUE,
  REDACTED_DEPTH_VALUE,
  MAX_LOG_STRING,
  MAX_LOG_ARRAY,
  type LogRecord,
  type ErrorMonitor,
} from "@/lib/observability/logger";

/**
 * Observability (DailyPlan Day 48, Week 7). "Redacted structured logging +
 * error-monitoring hooks. DoD: errors traceable without leaking content/secrets."
 *
 * Part 1 proves the redactor is the trust boundary: content/secret KEYS are
 * dropped, secret-shaped VALUES are masked anywhere, long strings are bounded,
 * and nesting is depth/array capped — so a record is always safe to log.
 * Part 2 proves the structured emit (level/ts + redacted context, context fields
 * kept at the top level for traceability) and that the error-monitoring hook
 * receives the SAME redacted record (never content/secrets) and can never break
 * the caller.
 */

afterEach(() => {
  setErrorMonitor(null);
  vi.restoreAllMocks();
});

// ── Redaction ────────────────────────────────────────────────────────────────

describe("redactLogContext — content/secret keys", () => {
  it("drops the value of every content/secret-shaped key", () => {
    const out = redactLogContext({
      content_text: "Buy our miracle cure now — call 555-0100",
      prompt: "You are juror 1…",
      suggested_rewrite: "A calmer line.",
      brand_summary: "Measured, expert tone.",
      business_context: "A fintech for SMBs.",
      apiKey: "sk-ant-abc",
      token: "bearer-xyz",
      password: "hunter2",
      email: "person@example.com",
      issues: [{ excerpt: "literally the best" }],
    });
    for (const key of Object.keys(out)) {
      expect(out[key]).toBe(REDACTED_VALUE);
    }
    // And none of the original content/secret text survives anywhere.
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("miracle cure");
    expect(serialized).not.toContain("555-0100");
    expect(serialized).not.toContain("sk-ant-abc");
    expect(serialized).not.toContain("person@example.com");
  });

  it("matches denied keys case-insensitively but not as substrings", () => {
    const out = redactLogContext({
      Content_Text: "secret copy",
      PROMPT: "sys",
      // NOT denied: ids/fields that merely contain a denied word as a substring.
      authUserId: "user-1",
      reviewId: "rev-9",
      tokenCount: 42,
    });
    expect(out.Content_Text).toBe(REDACTED_VALUE);
    expect(out.PROMPT).toBe(REDACTED_VALUE);
    expect(out.authUserId).toBe("user-1");
    expect(out.reviewId).toBe("rev-9");
    expect(out.tokenCount).toBe(42);
  });

  it("passes IDs, counts, enums, and an error message through for traceability", () => {
    const out = redactLogContext({
      op: "createReview",
      companyId: "co-1",
      reviewId: "rev-1",
      jurorCount: 6,
      verdict: "revise",
      aggregateScore: 7.2,
      message: "duplicate key value violates unique constraint reviews_pkey",
      isMock: true,
      brandSource: "cache",
    });
    expect(out).toEqual({
      op: "createReview",
      companyId: "co-1",
      reviewId: "rev-1",
      jurorCount: 6,
      verdict: "revise",
      aggregateScore: 7.2,
      message: "duplicate key value violates unique constraint reviews_pkey",
      isMock: true,
      brandSource: "cache",
    });
  });
});

describe("redactLogContext — secret-shaped values", () => {
  it("masks a secret-shaped value under a non-denied key", () => {
    const out = redactLogContext({
      detail: "sk-ant-0123456789abcdefABCDEF",
      note: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM.SflKxwRJSMeKKF2QT4",
      fine: "just a normal message",
    });
    expect(out.detail).toBe(REDACTED_SECRET_VALUE);
    expect(out.note).toBe(REDACTED_SECRET_VALUE);
    expect(out.fine).toBe("just a normal message");
  });

  it("masks a secret-shaped value nested inside an object/array", () => {
    const out = redactLogContext({
      meta: { providerKey: "gsk_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345" },
      list: ["ok", "sk-live-ABCDEFGHIJKLMNOP"],
    });
    expect((out.meta as Record<string, unknown>).providerKey).toBe(
      REDACTED_SECRET_VALUE,
    );
    expect((out.list as unknown[])[1]).toBe(REDACTED_SECRET_VALUE);
    expect((out.list as unknown[])[0]).toBe("ok");
  });
});

describe("redactLogContext — bounds", () => {
  it("truncates a long non-secret string", () => {
    const long = "word ".repeat(300); // 1500 chars, has spaces → not secret-shaped
    const out = redactLogContext({ note: long });
    const val = out.note as string;
    expect(val.length).toBeLessThan(long.length);
    expect(val.startsWith("word word")).toBe(true);
    expect(val).toContain(`(+${long.length - MAX_LOG_STRING} chars)`);
  });

  it("caps a long array and records how many were dropped", () => {
    const big = Array.from({ length: 60 }, (_, i) => i);
    const out = redactLogContext({ items: big });
    const arr = out.items as unknown[];
    expect(arr).toHaveLength(MAX_LOG_ARRAY + 1);
    expect(arr[MAX_LOG_ARRAY]).toBe(`…(+${60 - MAX_LOG_ARRAY} more)`);
  });

  it("stops recursing at the depth cap", () => {
    const out = redactLogContext({
      l0: { l1: { l2: { l3: { l4: { deep: "unreached" } } } } },
    });
    const l3 = ((((out.l0 as Record<string, unknown>).l1 as Record<string, unknown>)
      .l2 as Record<string, unknown>).l3 as Record<string, unknown>);
    expect(l3.l4).toBe(REDACTED_DEPTH_VALUE);
  });

  it("normalizes an Error value to a redactable { name, message }", () => {
    const out = redactLogContext({ cause: new TypeError("boom") });
    expect(out.cause).toEqual({ name: "TypeError", message: "boom" });
  });

  it("passes primitives through and does not mutate the input", () => {
    const input = { n: 1, b: false, z: null as null, u: undefined };
    const out = redactLogContext(input);
    expect(out).toEqual({ n: 1, b: false, z: null, u: undefined });
    // Purity: a denied key in the input is untouched in the original object.
    const withSecret = { prompt: "x", id: "1" };
    redactLogContext(withSecret);
    expect(withSecret.prompt).toBe("x");
  });
});

describe("errorContext", () => {
  it("extracts message + class name from an Error", () => {
    expect(errorContext(new RangeError("out of range"))).toEqual({
      message: "out of range",
      errorName: "RangeError",
    });
  });

  it("falls back to a stable message for a non-Error throw", () => {
    expect(errorContext("string thrown")).toEqual({ message: "unknown error" });
    expect(errorContext(undefined)).toEqual({ message: "unknown error" });
  });
});

// ── Structured emit ──────────────────────────────────────────────────────────

describe("logInfo / logWarn / logError emit", () => {
  it("logs event + a flat record carrying level, ts, and context at the top level", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const record = logError("review persistence failed", {
      op: "createReview",
      companyId: "co-1",
    });

    // Backward-compatible console shape: (event, objectContaining({ companyId })).
    expect(spy).toHaveBeenCalledWith(
      "review persistence failed",
      expect.objectContaining({ companyId: "co-1", op: "createReview" }),
    );
    const [, flat] = spy.mock.calls[0];
    expect((flat as { level: string }).level).toBe("error");
    expect(typeof (flat as { ts: string }).ts).toBe("string");

    // The returned record nests the redacted context.
    expect(record.event).toBe("review persistence failed");
    expect(record.level).toBe("error");
    expect(record.context).toMatchObject({ companyId: "co-1" });
  });

  it("routes each level to its console method", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    logInfo("i", { a: 1 });
    logWarn("w", { a: 1 });
    logError("e", { a: 1 });
    expect(info).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
  });

  it("redacts content/secrets in the emitted record", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("brand profile read failed (failing open)", {
      op: "createReview",
      companyId: "co-1",
      content_text: "Buy our miracle cure now",
    });
    const [, flat] = spy.mock.calls[0];
    expect(JSON.stringify(flat)).not.toContain("miracle cure");
    expect((flat as Record<string, unknown>).content_text).toBe(REDACTED_VALUE);
  });
});

// ── Error-monitoring hook ──────────────────────────────────────────────────────

describe("error-monitoring hook", () => {
  it("forwards every error-level record to the registered monitor", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const captured: LogRecord[] = [];
    const monitor: ErrorMonitor = { captureError: (r) => captured.push(r) };
    setErrorMonitor(monitor);
    expect(getErrorMonitor()).toBe(monitor);

    logError("review list failed", { op: "listReviewsForCompany", companyId: "co-1" });

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      level: "error",
      event: "review list failed",
      context: { companyId: "co-1" },
    });
  });

  it("hands the monitor the REDACTED record (never content/secrets)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const captured: LogRecord[] = [];
    setErrorMonitor({ captureError: (r) => captured.push(r) });

    logError("juror failed", {
      op: "runPersona",
      content_text: "secret ad copy",
      apiKey: "sk-ant-SECRET",
    });

    const serialized = JSON.stringify(captured[0]);
    expect(serialized).not.toContain("secret ad copy");
    expect(serialized).not.toContain("sk-ant-SECRET");
  });

  it("does NOT forward info/warn to the monitor", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const captured: LogRecord[] = [];
    setErrorMonitor({ captureError: (r) => captured.push(r) });
    logInfo("i");
    logWarn("w");
    expect(captured).toHaveLength(0);
  });

  it("swallows a throwing monitor so logging never breaks the request path", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setErrorMonitor({
      captureError: () => {
        throw new Error("monitor is down");
      },
    });
    expect(() => logError("role change failed", { op: "x" })).not.toThrow();
    // The console line (the real record) was still emitted.
    expect(spy).toHaveBeenCalledWith("role change failed", expect.any(Object));
  });

  it("can be cleared with setErrorMonitor(null)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const captured: LogRecord[] = [];
    setErrorMonitor({ captureError: (r) => captured.push(r) });
    setErrorMonitor(null);
    logError("e", {});
    expect(captured).toHaveLength(0);
    expect(getErrorMonitor()).toBeNull();
  });
});
