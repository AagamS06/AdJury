# AdJury — Production Monitoring

> **DailyPlan Day 81 (Week 12 — deploy & launch prep).**
> How **errors** and **key product events** become visible in production.
> Builds on the Day-48 observability layer (redacted structured logging +
> error-monitoring hook). Monitoring credentials live **only** in the Vercel /
> provider dashboards, never in the repo (Rules.md §4).

Run the offline readiness check at any time — it needs no credentials and no
provider:

```bash
npm run monitor:check
```

It prints the monitoring-readiness report (what is verified in-repo vs. what is a
manual provider-wiring step), the key-event catalog, and the two env vars prod
sets. The same checks run in CI via `tests/monitoring.test.ts`.

The DoD — **"errors and key events are visible"** — has two halves, each with a
seam that works offline (a no-op) and a prod adapter you register once:

| Signal | Seam (offline no-op) | Prod adapter |
|---|---|---|
| **Errors** | `setErrorMonitor` in `src/lib/observability/logger.ts` (Day 48) | Sentry/Datadog, using `MONITORING_ERROR_DSN` |
| **Key events** | `setAnalyticsSink` + `trackEvent` in `src/lib/observability/monitoring.ts` | PostHog/Amplitude, using `PRODUCT_ANALYTICS_KEY` |

Both adapters receive the **same redacted record** the app logs — they can never
be handed the user's content, a model prompt/output, or a secret (Rules.md §3/§6).

---

## 1. What is already in place (no credentials)

- **Redacted structured logging.** Every `logError/logWarn/logInfo` call flows
  through the one console sink after redaction (Day 48). The logging audit
  (`logging-audit.ts`) proves no `src/**` file calls `console.*` directly outside
  an inventoried sink, so a failure can never be logged with content/secrets.
- **Error-monitoring hook.** `logger.ts` forwards every `error`-level record to
  the registered `ErrorMonitor`. With none registered it is a no-op; the app runs
  unchanged.
- **Product-analytics seam + key-event catalog.** `trackEvent(name, props)` emits
  a redacted `info` log **and** forwards to the registered `AnalyticsSink`. The
  key events that must be visible are catalogued in `KEY_EVENTS`
  (`src/lib/observability/monitoring.ts`) and each is emitted at a real
  server-side success point:

  | Event | Emitted in |
  |---|---|
  | `account_created` | `src/lib/auth/actions.ts` (signup → first company provisioned) |
  | `company_onboarded` | `src/lib/company/actions.ts` (onboarding completed) |
  | `review_completed` | `src/lib/reviews/create-review.ts` (review persisted) |
  | `invitation_sent` | `src/lib/company/create-invitation.ts` (teammate invited) |

  The Day-81 audit (`monitoring-audit.ts`) reconciles this catalog against the
  real source tree: every catalogued event must be emitted where the catalog says,
  and no `trackEvent(...)` may name an un-catalogued event.

---

## 2. Wire the prod error monitor

1. Create a project in your error-monitoring provider (e.g. Sentry) and copy its
   **DSN** (an ingest endpoint — non-secret by design, but still set it in Vercel,
   not the repo).
2. Set `MONITORING_ERROR_DSN` in the Vercel project env.
3. Register the adapter once, at server startup (e.g. Next.js
   `instrumentation.ts`), mapping the redacted `LogRecord` to the provider:

   ```ts
   import { setErrorMonitor } from "@/lib/observability/logger";
   // import + init your provider SDK with process.env.MONITORING_ERROR_DSN
   setErrorMonitor({
     captureError(record) {
       // record.{level,event,ts,context} is already redacted — forward as-is.
       provider.captureMessage(record.event, { level: "error", extra: record.context });
     },
   });
   ```

Errors are now visible in the provider, with no content or secret ever leaving
the app.

---

## 3. Wire the prod product analytics

1. Create a project in your analytics provider (e.g. PostHog) and copy its
   **public project key**.
2. Set `PRODUCT_ANALYTICS_KEY` in the Vercel project env.
3. Register the sink once, at server startup:

   ```ts
   import { setAnalyticsSink } from "@/lib/observability/monitoring";
   // import + init your provider SDK with process.env.PRODUCT_ANALYTICS_KEY
   setAnalyticsSink({
     capture(event) {
       // event.{name,ts,props} is already redacted — forward as-is.
       provider.capture({ event: event.name, properties: event.props });
     },
   });
   ```

Key events (`KEY_EVENTS`) are now visible in the analytics provider.

---

## 4. Verify

- `npm run monitor:check` — offline readiness + the key-event catalog + the drift
  reconcile. Exits non-zero only on real drift.
- After registering the adapters in a deployed build, trigger each key flow once
  (sign up, onboard, run a review, invite a teammate) and confirm the events land
  in the analytics provider, and force a handled error and confirm it lands in the
  error monitor.

---

## Blocked / needs credentials

This cloud build has **no error-monitoring or analytics provider and no provider
credentials**, so the live wiring itself is a manual operator step:

- creating the provider projects and copying the `MONITORING_ERROR_DSN` /
  `PRODUCT_ANALYTICS_KEY` values;
- setting those two env vars in the Vercel project;
- registering the two adapters (§2–§3) in the deployed build;
- confirming errors + key events appear in the providers (§4).

Everything else — the error-monitoring hook, the product-analytics seam, the
key-event catalog, its emission at real success points, and the drift reconcile —
is fully implemented and offline-provable here (`npm run monitor:check` and
`tests/monitoring.test.ts`). The two env vars are inventoried as **non-secret**
server-side ingest config (`ENV_VAR_POSTURE`, Day 46); a provider that instead
required a true credential would be added as a `secret: true` var and set the same
way (dashboard → Vercel, never the repo).
