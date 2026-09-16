/**
 * Provider resilience (DailyPlan Day 19; Architecture.md §5 "provider
 * abstraction"; Rules.md §6 — "AI provider timeout / rate limit → fail the
 * affected juror(s) gracefully; respect provider backoff; surface a retryable
 * error"). Every review fans out to five model calls over the network, so a
 * hung connection or a transient 5xx/429 must not stall or fail the whole
 * review. This module owns two provider-facing concerns, kept pure and
 * node-testable so the orchestrator can wire them without a live model:
 *
 *  1. A per-call TIMEOUT that aborts a model call that runs too long (via an
 *     `AbortSignal` threaded into the client), turning a hang into a bounded,
 *     retryable failure.
 *  2. Exponential BACKOFF with jitter that retries only *transient* provider
 *     failures (timeout, network, 429, 5xx) and never a *permanent* one (a 4xx
 *     such as a bad request or an invalid key — retrying would just burn spend).
 *
 * Timers and randomness are injectable so the retry/backoff logic is
 * deterministic under test. This layer deals only with the *call*; the juror's
 * own "invalid JSON → retry once with a corrective nudge" contract stays in the
 * orchestrator (a nudge can't fix a dead connection).
 */

/** Thrown when a model call exceeds its per-attempt time budget. */
export class TimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`Model call timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Coarse classification of a model-call failure. `timeout`, `rate_limit`, and
 * `network` are transient (worth a backed-off retry); `permanent` is not
 * (a 4xx other than 429 — the request or credentials are wrong). An error with
 * no clear signal is treated as `network` so a genuine transient blip still
 * gets a retry — retries are bounded, so the cost of guessing "transient" is
 * small, whereas failing fast on a recoverable error is worse.
 */
export type ModelErrorCategory =
  | "timeout"
  | "rate_limit"
  | "network"
  | "permanent";

/** True for the categories a backed-off retry can recover from. */
export function isRetryable(category: ModelErrorCategory): boolean {
  return category !== "permanent";
}

/** Pull a numeric HTTP status off an error if the provider SDK attached one. */
function statusOf(err: unknown): number | undefined {
  if (err && typeof err === "object") {
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

/**
 * Classify a failure thrown by the model client so the retry policy can decide
 * whether to back off and try again. Mirrors the Rules.md §6 row for provider
 * timeouts/rate limits.
 */
export function classifyModelError(err: unknown): ModelErrorCategory {
  if (err instanceof TimeoutError) return "timeout";

  const status = statusOf(err);
  if (status !== undefined) {
    if (status === 429) return "rate_limit";
    if (status >= 500) return "network"; // provider-side, transient
    if (status >= 400) return "permanent"; // client-side (bad request / auth)
  }

  // Abort/network-ish signals without a status still deserve a retry.
  const name = err && typeof err === "object" ? (err as { name?: unknown }).name : undefined;
  if (name === "AbortError") return "timeout";

  return "network";
}

/** Options controlling the timeout + backoff behaviour of a resilient call. */
export interface ResilienceOptions {
  /** Per-attempt time budget before the call is aborted (ms). */
  timeoutMs: number;
  /** Total attempts, including the first (so 3 = 1 try + 2 retries). */
  maxAttempts: number;
  /** Delay before the first retry (ms); grows by `factor` each retry. */
  baseDelayMs: number;
  /** Exponential growth factor between retries. */
  factor: number;
  /** Upper bound on any single backoff delay (ms). */
  maxDelayMs: number;
  /** Apply full jitter to each delay (spreads retries; avoids thundering herd). */
  jitter: boolean;
  /** Sleep implementation (injectable so tests don't wait on real time). */
  sleep?: (ms: number) => Promise<void>;
  /** Randomness for jitter (injectable for deterministic tests). */
  random?: () => number;
  /** Observe each retry (redacted, non-throwing) — used by the orchestrator to log. */
  onRetry?: (info: { attempt: number; delayMs: number; category: ModelErrorCategory }) => void;
}

/**
 * Production defaults. A 20s per-call timeout with up to two backed-off retries
 * keeps a stuck juror bounded (worst case it degrades to `error` and the other
 * four still return) without giving up on a recoverable blip.
 */
export const DEFAULT_RESILIENCE: ResilienceOptions = {
  timeoutMs: 20_000,
  maxAttempts: 3,
  baseDelayMs: 300,
  factor: 2,
  maxDelayMs: 4_000,
  jitter: true,
};

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Compute the backoff delay before the retry that follows a given (0-based)
 * failed attempt. Exponential (`base × factor^attempt`), capped at `maxDelayMs`,
 * with optional full jitter (`delay × random()`), and never negative.
 */
export function computeBackoffMs(
  attempt: number,
  opts: Pick<ResilienceOptions, "baseDelayMs" | "factor" | "maxDelayMs" | "jitter" | "random">,
): number {
  const raw = opts.baseDelayMs * Math.pow(opts.factor, Math.max(0, attempt));
  const capped = Math.min(raw, opts.maxDelayMs);
  if (!opts.jitter) return Math.max(0, Math.round(capped));
  const random = opts.random ?? Math.random;
  return Math.max(0, Math.round(capped * random()));
}

/**
 * Run `fn` with a per-attempt timeout. `fn` receives an `AbortSignal` it should
 * thread into the underlying request so a timeout actually cancels the network
 * call (not just the promise). On timeout the signal is aborted and a
 * `TimeoutError` is thrown; the timer is always cleared so nothing leaks.
 */
export function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(timeoutMs));
    }, timeoutMs);
  });

  return Promise.race([fn(controller.signal), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Call a model function with a per-attempt timeout and exponential backoff on
 * transient failures. Retries only when `classifyModelError` says the failure
 * is recoverable and attempts remain; otherwise the last error propagates so
 * the orchestrator can mark that juror `error` (Rules.md §6). Returns the first
 * successful result.
 */
export async function callWithResilience<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  options: Partial<ResilienceOptions> = {},
): Promise<T> {
  const opts: ResilienceOptions = { ...DEFAULT_RESILIENCE, ...options };
  const sleep = opts.sleep ?? realSleep;
  let lastError: unknown = new Error("model call was never attempted");

  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      return await withTimeout(fn, opts.timeoutMs);
    } catch (err) {
      lastError = err;
      const category = classifyModelError(err);
      const isLastAttempt = attempt === opts.maxAttempts - 1;
      if (!isRetryable(category) || isLastAttempt) {
        throw err;
      }
      const delayMs = computeBackoffMs(attempt, opts);
      opts.onRetry?.({ attempt, delayMs, category });
      await sleep(delayMs);
    }
  }

  // Unreachable: the loop either returns or throws. Keeps the type checker happy.
  throw lastError;
}
