# AdJury — Architecture

> **Status:** Draft v1 · **Last updated:** 2026-08-29
> Companion to [PRD.md](PRD.md). Defines the tech stack, app flow, data model, and folder structure.

---

## 1. Tech Stack (recommended)

Chosen for a **solo developer** who wants one cohesive, well-documented stack with minimal moving parts.

| Layer | Choice | Why |
|---|---|---|
| **Framework** | **Next.js 15 (App Router) + TypeScript** | One codebase for UI **and** API routes — no separate backend to deploy or keep in sync. |
| **UI** | **React + Tailwind CSS** | Fast styling; enterprise look achievable via the design tokens in [Design.md](Design.md). |
| **Components** | **shadcn/ui** (Radix under the hood) | Accessible, unstyled-by-default primitives you own in-repo. |
| **DB** | **Postgres via Supabase** | Managed Postgres + Auth + Row-Level Security in one place. |
| **Auth** | **Supabase Auth** | Email/password + roles; integrates with RLS for multi-tenancy. |
| **ORM / DB access** | **Supabase JS client** + SQL migrations (optionally **Drizzle** later) | Keep it simple first; add a typed ORM only if the query layer grows. |
| **AI** | **One cost-efficient model** — default **Claude Haiku 4.5**; provider-abstracted (see [Rules.md](Rules.md)) | Single model, five system prompts. Swappable behind an interface. |
| **Validation** | **Zod** | Validates the juror JSON contract and all API inputs. |
| **Exports** | PDF (`@react-pdf/renderer` or server print) + CSV (hand-rolled) | Enterprise reporting requirement. |
| **Deploy** | **Vercel** (app) + **Supabase** (DB/auth) | Zero-ops hosting that matches the stack. |

> This is a recommendation, not a lock-in. If you'd rather keep frontend and backend separate (React + Node/Express), the data model and flow below are unchanged — only the folder layout differs.

---

## 2. High-Level App Flow

```
┌──────────┐    submit content    ┌───────────────────┐
│  Browser │ ───────────────────► │  Next.js API route │
│  (React) │                      │  /api/reviews      │
└────┬─────┘                      └─────────┬─────────┘
     │                                       │ 1. authz (Supabase session + role)
     │                                       │ 2. load brand_profile (+ cached embedding)
     │                                       │ 3. build 5 persona prompts
     │                                       ▼
     │                             ┌───────────────────┐
     │                             │  AI Orchestrator  │  ── fan-out 5 calls (parallel) ─►  [ AI model ]
     │                             │  (single model,   │  ◄─ 5 structured JSON responses ──
     │                             │   5 system prompts)│
     │                             └─────────┬─────────┘
     │                                       │ 4. validate each juror vs Zod schema (retry once)
     │                                       │ 5. compute aggregate + verdict
     │                                       │ 6. persist review + persona_scores
     │        scorecard JSON                 ▼
     │ ◄───────────────────────────  ┌───────────────┐
     │                               │   Postgres    │
     └── render scorecard UI         └───────────────┘
```

**Steps**
1. **Auth check** — Supabase session; resolve `company_id` and `role`; enforce plan rate limit.
2. **Load brand context** — fetch `brand_profiles` row for the company; reuse cached embedding rather than reprocessing the style guide.
3. **Prompt assembly** — inject content + brand context into each of the 5 persona system prompts.
4. **Fan-out** — call the model 5× (in parallel) via the AI orchestrator. Single provider, five prompts.
5. **Validate** — each response is parsed and validated against the juror JSON schema (Zod). One retry on failure; otherwise mark that juror `error` and continue.
6. **Aggregate** — compute weighted mean + verdict (compliance can veto → `fail`).
7. **Persist** — write one `reviews` row + five `persona_scores` rows.
8. **Render** — return the composed scorecard JSON; the client renders it.

---

## 3. Data Model

Multi-tenant, keyed on `company_id`. All tenant tables are protected by Supabase **Row-Level Security** so a user only sees their own company's rows.

```
companies ──┬── users
            ├── brand_profiles
            └── reviews ──── persona_scores
```

### Tables

```sql
-- companies
id            uuid pk
name          text not null
industry      text
plan_tier     text not null default 'free'   -- free | pro | enterprise
created_at    timestamptz default now()

-- users  (mirrors Supabase auth.users via id)
id            uuid pk references auth.users
company_id    uuid not null references companies(id)
email         text not null
role          text not null default 'member' -- admin | member
created_at    timestamptz default now()

-- brand_profiles
id            uuid pk
company_id    uuid not null references companies(id)
tone_guide_text text
embedding_ref text                            -- pointer/hash to cached embedding
updated_at    timestamptz default now()

-- reviews
id            uuid pk
company_id    uuid not null references companies(id)
submitted_by  uuid not null references users(id)
content_text  text not null
content_type  text not null                   -- ad_copy | social_post | email | landing_page
platform      text
aggregate_score numeric(3,1)
verdict       text                            -- pass | revise | fail
created_at    timestamptz default now()

-- persona_scores
id               uuid pk
review_id        uuid not null references reviews(id) on delete cascade
persona_name     text not null                -- brand_voice_guardian | ...
score            int                          -- 0..10
confidence       text                         -- high | medium | low
feedback_text    text                         -- juror summary
issues_json      jsonb                        -- array of {severity, excerpt, explanation}
suggested_rewrite text
status           text default 'ok'            -- ok | error
```

**Indexes:** `reviews(company_id, created_at desc)`, `persona_scores(review_id)`, `users(company_id)`.

**RLS policy (pattern):** every tenant table exposes rows only where `company_id = auth.jwt() -> company_id` (or via a join to `users`). Admin-only writes on `brand_profiles`.

---

## 4. Folder & File Structure

Next.js App Router layout. Keep AI, DB, and domain logic out of React components.

```
AdJury/
├── PRD.md
├── Architecture.md
├── Rules.md
├── Phases.md
├── Design.md
├── Memory.md
├── README.md
├── .env.example
├── .env.local                # gitignored — never committed
├── package.json
├── next.config.mjs
├── tailwind.config.ts
├── tsconfig.json
│
├── public/                   # static assets, logo, favicons
│
├── supabase/
│   ├── migrations/           # SQL migrations (schema above)
│   └── seed.sql              # sample company/user/brand for dev
│
├── src/
│   ├── app/                  # Next.js routes (App Router)
│   │   ├── layout.tsx
│   │   ├── page.tsx          # landing page
│   │   ├── (auth)/           # login / signup routes
│   │   ├── (dashboard)/
│   │   │   ├── review/       # submit + scorecard UI
│   │   │   ├── history/      # review history
│   │   │   ├── brand/        # brand profile (admin)
│   │   │   └── settings/
│   │   └── api/
│   │       ├── reviews/route.ts      # POST: run a review
│   │       ├── reviews/[id]/route.ts # GET: fetch a review
│   │       └── export/route.ts       # PDF/CSV export
│   │
│   ├── components/           # reusable UI (Scorecard, JurorCard, ...)
│   │   └── ui/               # shadcn/ui primitives
│   │
│   ├── lib/
│   │   ├── ai/
│   │   │   ├── client.ts     # provider-abstracted model client
│   │   │   ├── orchestrator.ts # fan-out 5 jurors, validate, aggregate
│   │   │   └── personas/     # one file per juror: system prompt + rubric
│   │   │       ├── brand-voice.ts
│   │   │       ├── compliance.ts
│   │   │       ├── audience-fit.ts
│   │   │       ├── seo.ts
│   │   │       └── stop-scrolling.ts
│   │   ├── db/
│   │   │   ├── supabase.ts   # server + browser clients
│   │   │   └── queries.ts    # typed data access
│   │   ├── schema/
│   │   │   └── juror.ts      # Zod schema for the JSON contract (PRD §7)
│   │   ├── scoring.ts        # aggregate + verdict logic
│   │   └── rate-limit.ts     # per-plan limits
│   │
│   ├── types/                # shared TypeScript types
│   └── styles/               # globals.css, design tokens
│
└── tests/
    ├── e2e-review.test.ts    # Phase-1 end-to-end: content in → 5 jurors → JSON out
    └── schema.test.ts        # contract validation
```

---

## 5. AI Orchestration Detail

- **Single provider, five prompts.** `lib/ai/personas/*` each export `{ name, systemPrompt, rubric }`. The orchestrator maps over them, calling the same model client.
- **Structured output.** Prompts instruct the model to return only JSON matching the juror schema; responses are parsed and Zod-validated. One retry with a "return valid JSON only" nudge before marking the juror `error`.
- **Brand-voice caching.** Juror 1 needs the style guide. Its embedding/summary is computed once per `brand_profiles` update and reused (keyed by `embedding_ref`) instead of re-reading the full guide every review.
- **Cost control.** Small model + short structured prompts; parallel calls; per-plan rate limits in `lib/rate-limit.ts`; token budget guardrails.
- **Provider abstraction.** `lib/ai/client.ts` exposes one `complete(messages, opts)` function so the model/provider can be swapped without touching persona or route code.

---

## 6. Environments & Deploy

| Env | Where | Notes |
|---|---|---|
| Local | `next dev` + Supabase local or hosted dev project | `.env.local` |
| Preview | Vercel preview deploys per PR | Supabase dev project |
| Prod | Vercel + Supabase prod | Secrets in Vercel/Supabase dashboards, never in repo |

Secrets live only in `.env.local` (gitignored) and the hosting dashboards. `.env.example` documents required keys with placeholder values. See [Rules.md](Rules.md) for the secrets policy.

---

## 7. Security Notes (first pass)

- Row-Level Security on every tenant table (no cross-company reads).
- Server-side authz on all `/api` routes; never trust the client's `company_id`.
- Rate-limit review submissions per plan tier.
- Validate & size-limit all user content before sending to the model.
- No secrets in the client bundle — AI keys used only in server routes.

---

_Related: [PRD.md](PRD.md) · [Rules.md](Rules.md) · [Phases.md](Phases.md) · [Design.md](Design.md)_
