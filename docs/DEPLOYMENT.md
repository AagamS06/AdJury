# AdJury — Deployment & Production Smoke Test

> **DailyPlan Day 79 (Week 12 — deploy & launch prep).**
> How to deploy AdJury to **Vercel** and smoke-test the live deployment.
> Builds on the Day-78 config runbook ([PRODUCTION_SETUP.md](PRODUCTION_SETUP.md));
> secrets live **only** in the Vercel/Supabase dashboards, never in the repo
> (Rules.md §4).

Run the offline readiness check at any time — it needs no credentials and no
deploy:

```bash
npm run deploy:smoke
```

It prints the deploy-readiness report (what is verified in-repo vs. what is a
manual live-deploy step), the deploy progression, and the smoke plan. Given a live
URL it also runs the automatable smoke checks against it:

```bash
SMOKE_BASE_URL=https://<your-deploy-url> npm run deploy:smoke
```

The same checks run in CI via `tests/deploy-plan.test.ts`.

The deploy progression is **Vercel (test) → production → custom domain**.

---

## 1. Before you deploy

Production config must be ready first — see [PRODUCTION_SETUP.md](PRODUCTION_SETUP.md):

- Prod Supabase project created, **all migrations applied in order**, the private
  `creatives` storage bucket created, and RLS verified against the live DB.
- The required env-var values minted in their dashboards (ready to paste into
  Vercel — step 3).

Confirm the repo side is ready:

```bash
npm run prod:check     # Day-78 prod config readiness
npm run deploy:smoke   # Day-79 deploy readiness + smoke plan
npm run build          # the production build compiles
```

---

## 2. Create the Vercel project + preview deploy

AdJury is a standard Next.js 15 App Router app with no custom build config, so
Vercel auto-detects the framework (`next build`, output served from `.next`).

```bash
# From the repo root, with the Vercel CLI:
vercel link        # link this repo to a Vercel project (one-time)
vercel             # build + deploy a PREVIEW (a throwaway public URL)
```

The preview URL is public but points at whatever env you set for the Preview
scope — point it at a **dev/staging** Supabase project, not prod.

---

## 3. Wire the Vercel environment variables

Set the env vars in **Vercel → Project → Settings → Environment Variables**. The
authoritative list (and each var's exposure/secret posture) is the
`PROD_ENV_REQUIREMENTS` inventory in `src/lib/deploy/prod-config.ts`; the required
set and sources are tabulated in [PRODUCTION_SETUP.md §4](PRODUCTION_SETUP.md).

- **Required:** `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (secret).
- **Recommended:** `AI_PROVIDER`, `AI_API_KEY` (secret — blank ⇒ offline mock,
  wrong for a live product), `AI_MODEL`.
- **Optional (billing, once live):** `AI_TEMPERATURE`, `STRIPE_SECRET_KEY`
  (secret), `STRIPE_PRICE_ENTRY_MONTHLY`, `STRIPE_TRIAL_DAYS`,
  `STRIPE_WEBHOOK_SECRET` (secret).

Set Production-scope values to the **prod** Supabase project; set Preview-scope
values to the dev/staging project. Nothing goes in the repo.

---

## 4. Promote to production

Once the preview is healthy **and** the Day-78 prod infra is live (prod Supabase +
migrations + the `creatives` bucket):

```bash
vercel --prod     # promote to the production domain
```

---

## 5. Attach the custom domain

1. Add the domain in **Vercel → Project → Settings → Domains** and follow the DNS
   instructions.
2. Set `NEXT_PUBLIC_APP_URL` (Production scope) to the domain — absolute invite
   links break without it in prod (Day-24 invite flow).
3. Redeploy so the new env value is baked into the build.

---

## 6. Smoke-test the live deployment

The "core flow works" half of the DoD is split into checks a script can run with
no credential and an authenticated walkthrough a human runs.

### Automatable (no credential)

```bash
SMOKE_BASE_URL=https://<your-deploy-url> npm run deploy:smoke
```

For every route on disk this checks, against the live URL:

- **Static public routes** (`/`, `/login`, `/signup`, `/pricing`) — answer `2xx`.
- **Static guarded routes** (`/dashboard`, `/review`, `/history`, `/analytics`,
  `/brand`, `/team`, `/settings`, `/account`, `/onboarding`) — **fail closed**: an
  unauthenticated GET redirects to `/login`. This proves the deploy didn't ship
  with tenancy wide open, not merely that pages render.
- **Dynamic routes** (`/review/[id]`, `/invite/[token]`) need a real id/token, so
  they are part of the authenticated walkthrough below rather than the automated
  probe.

The plan is derived from the real `src/app` route tree (see
`src/lib/deploy/deploy-plan.ts`), so it can't drift from the routes that ship.

### Authenticated core flow (manual)

Walk the end-to-end flow against the live URL with a seeded account, per
[USER_TEST_SCRIPT.md](USER_TEST_SCRIPT.md) (Day 68):

1. Log in → `/login`
2. Submit content and run the six jurors → `/review`
3. Read the returned scorecard (aggregate + verdict + jurors)
4. Open review history → `/history`
5. Open a past review's detail page → `/review/[id]`
6. Export the review (CSV + PDF) → `/api/reviews/[id]/export`
7. View the analytics dashboard → `/analytics`

A live review needs `AI_API_KEY` set in Vercel (otherwise the offline mock
returns a deterministic scorecard — fine for a liveness demo, not a real review).

---

## Blocked / needs credentials

This cloud build has **no** Vercel project, no prod Supabase, and no live keys, so
every step that touches a live deploy — creating the Vercel project, the
preview/prod deploys, wiring the Vercel env, attaching the domain, and the live
smoke run (`SMOKE_BASE_URL=… npm run deploy:smoke`) + the authenticated core-flow
walkthrough — is **manual** and is reported as such by `npm run deploy:smoke`. The
repo-side readiness — the deploy target is a standard Next app Vercel
auto-detects, the smoke plan is well-formed and route-derived, and the Day-78 prod
config is offline-ready — is verified offline and in CI (`tests/deploy-plan.test.ts`).
The live deploy + smoke is a one-time operator step once the Vercel/Supabase prod
projects exist.

---

_Related: [Architecture.md](../Architecture.md) §6 · [Rules.md](../Rules.md) §4 · [DailyPlan.md](../DailyPlan.md) Week 12 · [docs/PRODUCTION_SETUP.md](PRODUCTION_SETUP.md) · [docs/USER_TEST_SCRIPT.md](USER_TEST_SCRIPT.md)_
