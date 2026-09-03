# AdJury — Project Memory (Onboarding & Status)

> **Purpose:** The single catch-up doc for anyone (human or AI) joining AdJury. Read **this first** — it tells you what AdJury is, what's done, what's in progress, and what's next, so you don't have to read the whole codebase to get oriented.
>
> **Keep this file current.** Update the status tables at the end of every work session (per [Rules.md](Rules.md) §9).
>
> **Last updated:** 2026-09-02 (Day 6 — Fetch & list endpoints)

---

## 1. What is AdJury? (30-second version)

An **AI content-critique SaaS**. Businesses paste marketing content (ad copy, social posts, emails, landing pages); **five AI "juror" personas** each score and critique it from a different angle, returning per-juror scores, an aggregate score + verdict, flagged issues, and **suggested rewrites**. It's a **review/QA layer**, not a content generator — humans stay in control.

**Core cost mechanic:** ONE cost-efficient model (default **Claude Haiku 4.5**) called with **five different system prompts**, instead of five paid providers.

**The 5 jurors:** Brand Voice Guardian · Compliance & Legal Flagger · Target Audience Fit · SEO / Discoverability · "Would I Stop Scrolling".

**Read next:** [PRD.md](PRD.md) (what & why) → [Architecture.md](Architecture.md) (how it's built) → [Rules.md](Rules.md) (conventions) → [Phases.md](Phases.md) (plan) → [DailyPlan.md](DailyPlan.md) (per-day tasks) → [Design.md](Design.md) (look & feel).

> **🤖 Automated daily build:** a cloud routine runs **every day at 4:30am (Australia/Sydney)** on **Opus 4.8**. Each run executes the **next unchecked day** in [DailyPlan.md](DailyPlan.md) and **opens a PR** (never merges, never touches secrets). Review and merge PRs to advance. Manage/disable at https://claude.ai/code/routines.

---

## 2. Key Facts (don't re-derive these)

- **Owner / dev:** Aagam Shah (aagamshah250506@gmail.com). Solo, ~10 hrs/week, first-year CS (AI) student. Strong Python/C++/JS; building full-stack depth.
- **Timeline:** 12 weeks, 5 phases. Started Week 1 (~late Aug 2026).
- **Recommended stack:** Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui + Supabase (Postgres/Auth/RLS) + one AI provider behind `lib/ai/client.ts`. See [Architecture.md](Architecture.md) §1. *(This is a recommendation the owner can override — confirm before deep work.)*
- **Output contract:** the juror JSON schema in [PRD.md](PRD.md) §7 is the thing everything depends on. Don't break it silently.
- **Constraints that shape decisions:** tight AI budget (one model, caching, rate limits); multi-tenant safety is non-negotiable; enterprise-credible design, not "cutesy."
- **Palette:** Navy `#0A1F44`, Royal Blue `#1E40AF`, Burgundy `#6B1F2A`, Black `#0B0B0F`, White. See [Design.md](Design.md).

---

## 3. Current Status

**Phase:** 1 (Foundation & personas) → **Phase 2** (core review engine) — *first API slice landed.*

### ✅ Done
- Project documentation set authored: PRD, Architecture, Rules, Phases, Design, this Memory doc, and README.
- Core concept, 5-juror definitions, scoring rubric anchors, and JSON output contract specified in [PRD.md](PRD.md).
- Tech stack, data model, folder structure, and AI orchestration flow defined in [Architecture.md](Architecture.md).
- **Project scaffolded** (Next.js 15 + TS + Tailwind): `package.json`, `tsconfig`, `next/tailwind/postcss` configs, `.env.example`, `.gitignore`.
- **Zod juror schema** implemented — `src/lib/schema/juror.ts` (the contract from PRD §7).
- **5 persona system prompts + rubrics** — `src/lib/ai/personas/*` (base + one file per juror).
- **AI orchestrator** — `src/lib/ai/orchestrator.ts`: fan-out to 5 jurors, parse + Zod-validate (retry once), single-juror failures degrade gracefully.
- **Provider-abstracted model client** — `src/lib/ai/client.ts`: Anthropic when `AI_API_KEY` set, deterministic **offline mock** otherwise (so tests/demo run with no key).
- **Scoring & verdict** — `src/lib/scoring.ts`: weighted aggregate + compliance-veto verdict logic.
- **DB migration** — `supabase/migrations/0001_init.sql`: full schema + RLS policies; `seed.sql` dev data.
- **End-to-end proof** — `npm run demo` (sample ad copy → 5 jurors → JSON in console) and `npm test` both green; `npm run typecheck` clean.
- **DB data-access layer (Day 2)** — `src/types/db.ts` (hand-written row types mirroring the migration) and `src/lib/db/queries.ts`: typed helpers for companies, users, brand_profiles, and reviews/persona_scores (`insertReviewWithScores` with rollback, `getReviewById` with tenancy scoping, `listReviewsByCompany`). `scripts/db-smoke.ts` (+ `npm run db:smoke`) inserts and reads back a review against a dev Supabase, or prints manual steps + exits 0 when no keys are present. Unit test for the pure juror→row mapper.
- **Auth foundation (Day 3)** — Supabase email/password auth wired with `@supabase/ssr` (cookie sessions). `src/lib/auth/`: SSR browser + server client factories, `session.ts` `getSessionContext()` (resolves auth user → company + role, server-side, never from the client), `provisioning.ts` `provisionCompanyForNewUser()` (signup creates a `companies` row + first **admin** `users` row with rollback, run via the service-role client to bootstrap past RLS), Zod `schema.ts`, and `actions.ts` server actions (`signInAction`/`signUpAction`/`signOutAction`). `src/middleware.ts` refreshes the session cookie so logins persist (route protection deferred to Day 4). On-brand `/login` + `/signup` pages (`src/app/(auth)/`) using Design.md tokens with labels/focus rings; the landing page shows signed-in state + sign-out. `npm test` now **22 tests** green; `npm run build` compiles.
- **Role-based access (Day 4)** — Route protection in two layers that never trust the client (Rules.md §5). `src/lib/auth/access.ts` is a pure, fully-tested policy module: protected/admin/auth path matchers and `evaluateAccess(principal, {requireAdmin})` returning an allow/deny decision (unauth → `/login`, member on an admin route → `/dashboard`). `src/lib/auth/guard.ts` wraps it for Server Components — `requireSession()` and `requireAdmin()` resolve the real role via `getSessionContext()` and `redirect()` on denial (fails closed if Supabase env is absent). `middleware.ts` now does a coarse gate too (anon → login off protected URLs; signed-in → dashboard off auth pages) while preserving refreshed cookies on redirects; role checks stay server-side since the role lives in the DB, not the token. New `src/app/(dashboard)/` route group: `layout.tsx` (`requireSession`, nav that hides Brand/Team from members), `dashboard/` home (any user), and admin-only `brand/` + `team/` placeholders (each calls `requireAdmin`; full CRUD is Days 23/26). Landing page gained a Dashboard link when signed in. New `tests/auth-access.test.ts` (10 tests) proves the DoD: unauth redirected, member cannot reach admin routes. `npm test` now **32 tests** green; typecheck clean; `npm run build` compiles.
- **Review endpoint (Day 5)** — First Phase 2 API slice: `POST /api/reviews` (`src/app/api/reviews/route.ts`) Zod-validates the body, runs the 5-juror orchestrator, persists `reviews` + `persona_scores`, and returns the composed `ReviewResult`. Identity is tenant-safe (Rules.md §5): `company_id`/`submitted_by` come from `getSessionContext()`, never the body — the client can only send content fields via the new `ReviewRequestSchema` (a `pick` of `ReviewInputSchema`; `brand_context` stays server-side and null until Day 27). The orchestration + error mapping live in a testable core `src/lib/reviews/create-review.ts` (`createReview(body, {session, persist, client?})`) so the route is a thin wrapper that only wires real deps; the write goes through the **service-role client** with an explicit `companyId` because `persona_scores` has no client INSERT policy in the RLS migration. Error handling per Rules.md §6: 401 unauth, 400 bad/empty/oversized input, **502 when every juror fails (nothing persisted)**, 500 on write failure (no false success, logged with redacted context). New `tests/reviews-endpoint.test.ts` (8 tests, offline mock client + injected persist) proves the DoD incl. tenancy-spoof rejection. `npm test` now **40 tests** green; typecheck clean; `npm run build` compiles (`/api/reviews` is a dynamic route).
- **Fetch & list endpoints (Day 6)** — Read side of the reviews API, both company-scoped. `GET /api/reviews/[id]` (`src/app/api/reviews/[id]/route.ts`) returns one review reconstructed from `reviews` + `persona_scores`; `GET /api/reviews` (added to the existing route file) lists the company's reviews newest-first for the history view. Logic lives in a testable core `src/lib/reviews/read-reviews.ts` (`getReviewForCompany`, `listReviewsForCompany`) with the DB reads injected, plus pure row→DTO mappers: `scoreRowToJurorSlot` (the inverse of Day 5's `jurorSlotToScoreRow` — a malformed `ok` row downgrades to an `error` slot so a persisted review never claims a result it can't back up), `reviewWithScoresToPersisted` (composes a `PersistedReview` mirroring `ReviewResult`, minus `model` which the table doesn't store, jurors emitted in canonical persona order), and `reviewRowToSummary` (a thin `ReviewSummary` with no `content_text` — the list doesn't leak content). Tenancy (Rules.md §5): the company is taken from the session and passed explicitly to every query; reads go through the **request-scoped anon client** so RLS is the primary guard (both `reviews` and `persona_scores` have SELECT policies) with the session `companyId` as a second layer. A row that is absent OR another company's reads as **404** (never reveal cross-tenant existence — Rules.md §6); 401 unauth, 500 on query failure (redacted log, generic message). List `limit` is clamped to [1,100]. New `tests/reviews-read.test.ts` (14 tests) proves the DoD incl. the 404-vs-other-company case and session-derived scoping. `npm test` now **54 tests** green; typecheck clean; `npm run build` compiles (`/api/reviews` and `/api/reviews/[id]` are dynamic routes).

### 🚧 In progress / next up (finish Phase 1 → Phase 2)
- [ ] **Owner to add real keys** in `.env.local` (Supabase + `AI_API_KEY`) to run the live model, apply the migration, and exercise signup/login end-to-end against a real Supabase project (the cloud build has no secrets, so auth is code-complete but unverified against a live DB).
- [ ] Light calibration of persona prompts against real model output once keys are in.
- [ ] Continue Phase 2: **Week 1 hardening (Day 7)** — expand endpoint + tenancy tests, light persona-prompt calibration, Week 1 summary — then submission UI, scorecard UI, and review history (Week 2). The Week 2 pages are now well-supported: `POST /api/reviews` (Day 5) backs the submission form, and the Day 6 read core (`getReviewForCompany` → `PersistedReview`, `listReviewsForCompany` → `ReviewSummary[]`) backs the review-detail page (Day 12) and the history list (Day 11); the Day 4 guards (`requireSession`/`requireAdmin`) gate them. Day 27 will wire the company's stored brand guide into the review's `brand_context` (null today).

### ⏭️ Later phases (not started)
- Phase 2 — Core review engine (submit UI, review endpoint, scorecard, history).
- Phase 3 — Multi-tenant & dashboard (teams/roles, brand upload + embedding cache, analytics, export, cost controls, security pass).
- Phase 4 — UI/UX polish (landing page, brand pass, responsive/a11y, user testing).
- Phase 5 — Billing scaffold, pricing, deploy, portfolio writeup, demo video, outreach.

See [Phases.md](Phases.md) for full deliverables and acceptance criteria.

---

## 4. Decisions Log

Record notable choices here so they aren't relitigated. Newest first.

| Date | Decision | Rationale |
|---|---|---|
| 2026-09-02 | **Review reads use the request-scoped anon client (RLS), not the service role** (Day 6) — the mirror of the Day 5 write decision | Unlike writes, both `reviews` and `persona_scores` have SELECT policies, so RLS is the natural primary tenancy guard for reads and no service-role key is needed. The session `companyId` is still passed explicitly to `getReviewById`/`listReviewsByCompany` as defense-in-depth, and an absent/other-company row returns 404 (never reveal cross-tenant existence). The endpoint returns a reconstructed `PersistedReview` (not raw rows) so a stored review renders like a freshly-run one; the list returns a thin `ReviewSummary` that omits `content_text`. |
| 2026-09-01 | **Review writes use the service-role client**, not the request-scoped anon client (Day 5) | The RLS migration gives `persona_scores` a SELECT policy but no INSERT policy, so an anon/authenticated session cannot write scores. The `insertReviewWithScores` path already takes an explicit `companyId`; the endpoint derives it from the session and writes server-side with the service role. Tenancy is enforced by the session, not RLS, on this path. |
| 2026-09-01 | **Endpoint logic factored into `createReview` (injectable deps)** with a thin route wrapper (Day 5) | The route touches `next/headers` (cookies) and service-role env; injecting `{session, persist, client}` lets the whole flow — tenancy derivation, 4xx/502/500 mapping — be unit-tested offline with the mock client, matching the pure-core pattern used for `evaluateAccess`/`jurorSlotToScoreRow`. |
| 2026-08-31 | **Two-layer route protection** (Day 4): middleware does a coarse auth-presence gate; role (admin) checks live in Server Component guards, not middleware | The user's `role` is a DB column, not a JWT claim, so resolving it in Edge middleware would mean a per-request DB read there. Keeping admin authz in `requireAdmin()` (server components) is safer defense-in-depth and matches Rules.md §5 (enforce admin actions server-side). The pure `evaluateAccess` policy is shared and unit-tested so both layers agree. |
| 2026-08-30 | Add **`@supabase/ssr`** for cookie-based auth sessions (Day 3) | Standard, actively-maintained Supabase package for Next.js App Router; removes hand-rolled SSR cookie/session handling so the server can read the session and RLS applies. Sessions live in cookies (not localStorage) so they persist across server renders. |
| 2026-08-30 | Signup provisions company + admin via **service-role client**, not the anon session | RLS's `auth_company_id()` needs an existing `users` row to resolve; the first company + admin rows must bootstrap that state, so they're written server-side with the service role and an explicit (never client-supplied) `userId`. |
| 2026-08-29 | Recommend **Next.js + Supabase** single stack (vs. separate React + Express backend) | Fewer moving parts for a solo dev; one deploy target; Supabase bundles Postgres + Auth + RLS. |
| 2026-08-29 | Default AI model **Claude Haiku 4.5**, provider abstracted | Cost-efficient; matches README's "one cheap/fast model" mechanic; swappable via `lib/ai/client.ts`. |
| 2026-08-29 | **Compliance juror can veto** to `fail` regardless of aggregate | Legal risk should block publishing even if other scores are high. |
| 2026-08-29 | Authored full docs set before writing code | Locks contracts (JSON schema, data model) that everything else depends on. |

---

## 5. Gotchas & Watch-outs

- **Never break the juror JSON contract** without updating [PRD.md](PRD.md) §7, the Zod schema, and the persistence mapping together.
- **Multi-tenancy:** always derive `company_id` from the session server-side; never trust the client. RLS on every tenant table.
- **Secrets:** only `.env.example` is committed; real keys live in `.env.local` and hosting dashboards. AI/service-role keys are server-side only.
- **Cost:** don't fan out to multiple paid providers per review — that defeats the whole point.

---

## 6. How to Update This File

At the end of a session: move finished items from "In progress" to "Done," add anything non-obvious to the Decisions Log, and bump the **Last updated** date. Keep it skimmable — this is the file that saves everyone from reading the whole repo.

---

_Related: [PRD.md](PRD.md) · [Architecture.md](Architecture.md) · [Rules.md](Rules.md) · [Phases.md](Phases.md) · [Design.md](Design.md)_
