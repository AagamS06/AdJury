import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  callWithResilience,
  classifyModelError,
  computeBackoffMs,
  DEFAULT_RESILIENCE,
  isRetryable,
  TimeoutError,
  withTimeout,
  type ResilienceOptions,
} from "@/lib/ai/resilience";
import { runReview } from "@/lib/ai/orchestrator";
import type { CompleteArgs, ModelClient } from "@/lib/ai/client";
import {
  PERSONA_NAMES,
  ReviewInputSchema,
  ReviewResultSchema,
} from "@/lib/schema/juror";

/**
 * DailyPlan Day 19 — provider resilience. Proves the timeout + backoff layer
 * (`resilience.ts`) in isolation, then the DoD end-to-end: a simulated provider
 * failure on one juror degrades gracefully while the review still returns.
 */

// The resilience/orchestrator layers log retries + failures; keep test output clean.
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** A fake provider error carrying an HTTP status, like the Anthropic SDK does. */
function statusError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

describe("classifyModelError", () => {
  it("treats a timeout as a retryable timeout", () => {
    const cat = classifyModelError(new TimeoutError(1000));
    expect(cat).toBe("timeout");
    expect(isRetryable(cat)).toBe(true);
  });

  it("treats 429 as a retryable rate limit", () => {
    const cat = classifyModelError(statusError(429));
    expect(cat).toBe("rate_limit");
    expect(isRetryable(cat)).toBe(true);
  });

  it("treats 5xx as retryable network failures", () => {
    for (const status of [500, 502, 503]) {
      const cat = classifyModelError(statusError(status));
      expect(cat).toBe("network");
      expect(isRetryable(cat)).toBe(true);
    }
  });

  it("treats a non-429 4xx as a permanent, non-retryable failure", () => {
    for (const status of [400, 401, 403]) {
      const cat = classifyModelError(statusError(status));
      expect(cat).toBe("permanent");
      expect(isRetryable(cat)).toBe(false);
    }
  });

  it("treats an AbortError as a timeout", () => {
    const err = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(classifyModelError(err)).toBe("timeout");
  });

  it("defaults an unknown error to a retryable network failure", () => {
    expect(classifyModelError(new Error("who knows"))).toBe("network");
    expect(isRetryable(classifyModelError("weird"))).toBe(true);
  });
});

describe("computeBackoffMs", () => {
  const opts = { baseDelayMs: 100, factor: 2, maxDelayMs: 1000, jitter: false };

  it("grows exponentially per attempt when jitter is off", () => {
    expect(computeBackoffMs(0, opts)).toBe(100);
    expect(computeBackoffMs(1, opts)).toBe(200);
    expect(computeBackoffMs(2, opts)).toBe(400);
  });

  it("caps the delay at maxDelayMs", () => {
    expect(computeBackoffMs(10, opts)).toBe(1000);
  });

  it("applies full jitter with an injected random source", () => {
    // random()=0.5 halves the (capped) delay; attempt 1 → 200 × 0.5 = 100.
    expect(computeBackoffMs(1, { ...opts, jitter: true, random: () => 0.5 })).toBe(100);
    // random()=0 collapses to no wait.
    expect(computeBackoffMs(1, { ...opts, jitter: true, random: () => 0 })).toBe(0);
  });

  it("never returns a negative delay", () => {
    expect(computeBackoffMs(-5, opts)).toBeGreaterThanOrEqual(0);
  });
});

describe("withTimeout", () => {
  it("resolves a fast call and clears its timer", async () => {
    const value = await withTimeout(async () => "ok", 1000);
    expect(value).toBe("ok");
  });

  it("aborts and rejects a call that exceeds the budget", async () => {
    let signalled: AbortSignal | undefined;
    const hang = (signal: AbortSignal) =>
      new Promise<string>(() => {
        signalled = signal; // never resolves
      });

    await expect(withTimeout(hang, 5)).rejects.toBeInstanceOf(TimeoutError);
    // The signal handed to the call was aborted on timeout, so a real client
    // would cancel its in-flight request rather than leak it.
    expect(signalled?.aborted).toBe(true);
  });

  it("propagates the call's own rejection unchanged", async () => {
    const boom = async () => {
      throw statusError(400);
    };
    await expect(withTimeout(boom, 1000)).rejects.toMatchObject({ status: 400 });
  });
});

describe("callWithResilience", () => {
  const fast: Partial<ResilienceOptions> = {
    maxAttempts: 3,
    baseDelayMs: 10,
    factor: 2,
    maxDelayMs: 100,
    jitter: false,
    sleep: async () => {}, // don't wait on real time
    timeoutMs: 1000,
  };

  it("returns the first successful result without retrying", async () => {
    const fn = vi.fn(async () => "ok");
    const sleep = vi.fn(async () => {});
    const value = await callWithResilience(fn, { ...fast, sleep });
    expect(value).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries a transient failure with backoff, then succeeds", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw statusError(503);
      return "recovered";
    });
    const sleep = vi.fn(async (_ms: number) => {});
    const onRetry = vi.fn();

    const value = await callWithResilience(fn, { ...fast, sleep, onRetry });

    expect(value).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
    // Two backed-off waits, growing: 10 then 20 (jitter off).
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([10, 20]);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("does not retry a permanent failure", async () => {
    const fn = vi.fn(async () => {
      throw statusError(400);
    });
    const sleep = vi.fn(async () => {});

    await expect(callWithResilience(fn, { ...fast, sleep })).rejects.toMatchObject({
      status: 400,
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("gives up after maxAttempts on a persistent transient failure", async () => {
    const fn = vi.fn(async () => {
      throw statusError(500);
    });
    const sleep = vi.fn(async () => {});

    await expect(
      callWithResilience(fn, { ...fast, maxAttempts: 3, sleep }),
    ).rejects.toMatchObject({ status: 500 });
    expect(fn).toHaveBeenCalledTimes(3); // 1 try + 2 retries
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("retries a real timeout (hung call), then succeeds", async () => {
    let calls = 0;
    const fn = vi.fn((signal: AbortSignal) => {
      calls += 1;
      if (calls === 1) {
        return new Promise<string>((_, reject) => {
          // Reject when the timeout aborts, mimicking a cancelled request.
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }
      return Promise.resolve("ok");
    });
    const sleep = vi.fn(async () => {});

    const value = await callWithResilience(fn, {
      ...fast,
      timeoutMs: 5,
      sleep,
    });
    expect(value).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("ships production defaults", () => {
    expect(DEFAULT_RESILIENCE.maxAttempts).toBeGreaterThanOrEqual(2);
    expect(DEFAULT_RESILIENCE.timeoutMs).toBeGreaterThan(0);
    expect(DEFAULT_RESILIENCE.jitter).toBe(true);
  });
});

describe("runReview provider resilience (DoD: degrade gracefully, still return)", () => {
  const input = ReviewInputSchema.parse({
    content_type: "ad_copy",
    platform: "instagram",
    content_text: "Our tool helps small teams ship on time without the busywork.",
  });

  const noWait: Partial<ResilienceOptions> = {
    maxAttempts: 2,
    baseDelayMs: 1,
    maxDelayMs: 1,
    jitter: false,
    sleep: async () => {},
    timeoutMs: 1000,
  };

  /**
   * A client that behaves like the offline mock for every persona except one,
   * which always throws a transient provider error — simulating one juror's
   * upstream being down while the others are healthy.
   */
  function clientWithOneFailingPersona(failing: (typeof PERSONA_NAMES)[number]): ModelClient {
    return {
      model: "test-model",
      isMock: true,
      async complete(args: CompleteArgs): Promise<string> {
        if (args.persona === failing) throw statusError(503);
        return JSON.stringify({
          persona: args.persona,
          score: 8,
          confidence: "high",
          summary: "Looks solid on this lens.",
          issues: [],
          suggested_rewrite: "No changes needed.",
        });
      },
    };
  }

  it("returns a valid review with the failing juror as an error slot, others ok", async () => {
    const failing = "seo_discoverability" as const;
    const review = await runReview(input, {
      client: clientWithOneFailingPersona(failing),
      resilience: noWait,
    });

    // The composed review still validates against the contract.
    expect(() => ReviewResultSchema.parse(review)).not.toThrow();
    expect(review.jurors).toHaveLength(5);

    const failed = review.jurors.find((j) => j.persona === failing);
    expect(failed?.status).toBe("error");

    const others = review.jurors.filter((j) => j.persona !== failing);
    expect(others.every((j) => j.status === "ok")).toBe(true);

    // The aggregate is computed from the four healthy jurors (all scored 8).
    expect(review.aggregate_score).toBe(8);
    expect(["pass", "revise", "fail"]).toContain(review.verdict);
  });

  it("retries the failing persona before giving up (backoff engaged)", async () => {
    const failing = "stop_scrolling" as const;
    let failingCalls = 0;
    const client: ModelClient = {
      model: "test-model",
      isMock: true,
      async complete(args: CompleteArgs): Promise<string> {
        if (args.persona === failing) {
          failingCalls += 1;
          throw statusError(500);
        }
        return JSON.stringify({
          persona: args.persona,
          score: 7,
          confidence: "medium",
          summary: "ok",
          issues: [],
          suggested_rewrite: "No changes needed.",
        });
      },
    };

    const review = await runReview(input, {
      client,
      resilience: { ...noWait, maxAttempts: 3 },
    });

    // The failing juror was retried up to maxAttempts before degrading.
    expect(failingCalls).toBe(3);
    expect(review.jurors.find((j) => j.persona === failing)?.status).toBe("error");
  });

  it("still returns (502-eligible) when every juror's provider fails", async () => {
    const client: ModelClient = {
      model: "test-model",
      isMock: true,
      async complete(): Promise<string> {
        throw statusError(503);
      },
    };

    const review = await runReview(input, { client, resilience: noWait });
    expect(review.jurors).toHaveLength(5);
    expect(review.jurors.every((j) => j.status === "error")).toBe(true);
    // computeAggregate returns 0 when no juror scored; createReview turns an
    // all-error review into a 502 (proven in the endpoint suite) — here we just
    // confirm the orchestrator itself never throws.
    expect(review.aggregate_score).toBe(0);
  });
});
