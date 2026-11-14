# AdJury — Production Setup Runbook

> **DailyPlan Day 78 (Week 12 — deploy & launch prep).**
> How to wire AdJury for production: **Vercel** (app) + **Supabase** (Postgres,
> Auth, Storage). Secrets live **only** in the Vercel/Supabase dashboards — never
> in the repo (Rules.md §4). This is the config/readiness runbook; the actual
> deploy is Day 79.

Run the offline readiness check at any time — it needs no credentials:

```bash
npm run prod:check
```

It prints the readiness report (what is verified in-repo vs. what is a manual
step) and, when prod Supabase keys are present, probes the live DB to confirm the
migrations are applied. The same checks run in CI via `tests/prod-config.test.ts`.

The deploy progression is **Vercel (test) → custom domain → prod**. This document
covers the config that must be true before any of those.

---

## 1. Overview — what production needs

| Piece | Where | Secret? |
|---|---|---|
| Next.js app | Vercel project | — |
| Postgres + Auth | Supabase prod project | — |
| Media storage (creatives) | Supabase Storage bucket `creatives` (private) | — |
| App env vars | Vercel project → Settings → Environment Variables | some |
| DB schema | `supabase/migrations/*` applied in order | — |

No secret value is ever committed. Each secret is minted in its own dashboard and
pasted into Vercel's environment settings.

---

## 2. Provision prod Supabase + apply all migrations

1. Create a new Supabase project (the **production** project, separate from dev).
2. Apply every migration in `supabase/migrations/`, **in filename order**
   (`0001_…` first). The set is a gapless, consecutively-numbered sequence
   (verified by `npm run prod:check`), so a lexical sort is the apply order:

   ```bash
   # With the Supabase CLI linked to the prod project:
   supabase db push

   # …or apply directly with psql:
   for f in supabase/migrations/*.sql; do
     psql "$PROD_DATABASE_URL" -f "$f"
   done
   ```

3. Migration `0006_rls_audit.sql` hardens `auth_company_id()` to `SECURITY
   DEFINER` with a pinned `search_path` — this is **required** for RLS to work at
   all (without it, tenant reads hit infinite policy recursion). Confirm it
   applied (§5).

---

## 3. Create the media-storage bucket

Uploaded image ads currently pass the creative **inline** per request (Day 15a).
Production adds durable, tenant-scoped object storage:

- **Bucket:** `creatives`
- **Public:** **No** — a public bucket would expose one tenant's creatives to the
  world, breaking multi-tenant safety (Rules.md §5).
- **Object key convention:** `{company_id}/{review_id}/{filename}` — keeps every
  object tenant-scoped.
- **Access:** brokered server-side (signed URLs / the service-role client), scoped
  by `company_id`; uploads size/type-guarded like the inline image guard.

Create it in the Supabase dashboard (**Storage → New bucket**, private) or via the
CLI/SDK. Wiring the upload path into the review flow is later work; this step only
provisions the bucket.

---

## 4. Wire Vercel environment variables

Set these in **Vercel → Project → Settings → Environment Variables** (Production
scope). Values come from the dashboards noted below; **nothing goes in the repo.**

### Required (the app cannot run in prod without these)

| Var | Source | Notes |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Deployment config | The public prod origin (custom domain). |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API | Public. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API | Public; RLS enforces tenancy. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API | **Secret.** Server-only; never the client bundle. |

### Recommended

| Var | Source | Notes |
|---|---|---|
| `AI_PROVIDER` | Deployment config | `anthropic` in v1. |
| `AI_API_KEY` | Anthropic console | **Secret.** Blank ⇒ offline mock (wrong for a live product). |
| `AI_MODEL` | Deployment config | Defaults to `claude-haiku-4-5`. |

### Optional (only once billing goes live — v1 ships the test-mode scaffold)

`AI_TEMPERATURE`, `STRIPE_SECRET_KEY` (secret), `STRIPE_PRICE_ENTRY_MONTHLY`,
`STRIPE_TRIAL_DAYS`, `STRIPE_WEBHOOK_SECRET` (secret).

The full, authoritative list (and each var's exposure/secret posture) is the
`PROD_ENV_REQUIREMENTS` inventory in `src/lib/deploy/prod-config.ts`, derived 1:1
from the Day-46 `ENV_VAR_POSTURE` so it cannot drift from what the app reads.

---

## 5. Verify RLS against the live DB

The committed SQL is statically verified (RLS enabled on every tenant table, every
policy company-scoped, no wildcard policy, the `auth_company_id()` helper
hardened) by `tests/prod-config.test.ts` + `tests/rls-audit.test.ts`. Against the
**live** prod DB, confirm it for real:

1. **Tables + migrations applied** — with prod keys in `.env.local`:

   ```bash
   node --env-file=.env.local --import tsx scripts/prod-config-check.ts
   ```

   It confirms every tenant table exists (companies, users, brand_profiles,
   reviews, persona_scores, invitations).

2. **RLS is ON for every tenant table** — in the Supabase SQL editor:

   ```sql
   select relname, relrowsecurity
   from pg_class
   where relname in (
     'companies','users','brand_profiles','reviews','persona_scores','invitations'
   );
   -- relrowsecurity must be true for all six.
   ```

3. **Policies exist**:

   ```sql
   select tablename, policyname, cmd
   from pg_policies
   where schemaname = 'public'
   order by tablename, policyname;
   ```

4. **`auth_company_id()` is SECURITY DEFINER with a pinned search_path**:

   ```sql
   select proname, prosecdef, proconfig
   from pg_proc
   where proname = 'auth_company_id';
   -- prosecdef = true; proconfig contains search_path=''.
   ```

5. **Behavioural cross-tenant denial** — sign in as a user of company A (anon key)
   and confirm a read of company B's rows returns nothing. This is the live
   complement to the `tests/rls-audit.test.ts` cross-tenant proof.

---

## Blocked / needs credentials

This cloud build has **no** prod Supabase project, no Vercel project, and no live
keys, so steps §2–§5 (create prod Postgres, apply migrations to it, create the
bucket, wire Vercel env, and the live RLS verification) are **manual** and are
reported as such by `npm run prod:check`. The repo-side readiness — the migration
set is apply-ready, RLS is correctly defined in the committed SQL, and
`.env.example` is complete — is verified offline and in CI. The live-DB
verification is a one-time operator step once the prod project exists.

---

_Related: [Architecture.md](../Architecture.md) §6 · [Rules.md](../Rules.md) §4 · [DailyPlan.md](../DailyPlan.md) Week 12 · [docs/USER_TEST_SCRIPT.md](USER_TEST_SCRIPT.md)_
